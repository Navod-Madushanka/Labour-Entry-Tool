"""Automatic save, done by the tool itself (not by the page in the browser).

The page used to save a few seconds after a push, but only while it was open and noticed the
write: a write the page did not follow (medical leave, codes, a time card) waited for its status
check, which pauses while the tool is behind Excel, and nothing typed straight into Excel was ever
saved. A PC that froze then lost that work. Now, for every workbook open in the tool:

- a few seconds after the tool has written to it, the workbook is saved;
- every two minutes, if Excel says the workbook has unsaved changes (typed in Excel, too), it is
  saved;
- only while the Excel thread is free (never in the middle of a push or a read); Excel busy (a
  cell being edited, a dialog open): tried again half a minute later, and the status says why.

The switch is the one beside "Save Excel file" ("Auto-save"); it is kept in the tool's settings,
so it works even with the page closed. The backup made before the first write of the session is
not touched.
"""

from __future__ import annotations

import asyncio
import logging
import time

log = logging.getLogger("labour.autosave")

KEY = "autosave"  # in the settings file: {"on": bool}
AFTER_WRITE = 4.0  # seconds after the tool's write
EXCEL_EVERY = 120.0  # seconds between asking Excel whether it holds unsaved changes
RETRY = 30.0  # seconds after a save that did not happen
TICK = 2.0
SAVE_WAIT = 90.0  # seconds a save may take (a big .xlsb on a slow PC)


def enabled(app) -> bool:
    return app.state.session.settings.get_key(KEY).get("on", True) is not False


def set_enabled(app, on: bool) -> None:
    app.state.session.settings.set_key(KEY, on=on)


def services(app) -> list:
    """Every workbook open in the tool (each has its own service)."""
    out = {id(b.service): b.service for b in app.state.session.books.values() if b.service is not None}
    if app.state.has_service():
        svc = app.state.get_service()
        out.setdefault(id(svc), svc)
    return list(out.values())


async def tick(app, state: dict) -> None:
    """One look at every open workbook: save it where it is due, and take a snapshot (a whole
    copy, app/snapshots.py) where one is due."""
    from app import snapshots

    saving, copying = enabled(app), snapshots.enabled(app)
    if not (saving or copying) or app.state.excel_disabled is not None:
        return
    worker = app.state.get_worker()
    now = time.monotonic()
    for svc in services(app):
        if worker.busy_for() > 0 or worker.waiting:
            return  # a push or a read is running: never in between
        key = id(svc)
        if saving and now >= state.get(("retry", key), 0.0):
            await _save_if_due(svc, worker, state, key, now)
        if copying and svc.mode == "live" and now >= state.get(("snap", key), 0.0):
            await _snapshot_if_changed(svc, worker, state, key, now)


async def _save_if_due(svc, worker, state: dict, key: int, now: float) -> None:
    due = svc.unsaved and now - svc.last_write >= AFTER_WRITE
    if not due and svc.mode == "live" and now - state.get(("asked", key), 0.0) >= EXCEL_EVERY:
        state[("asked", key)] = now
        try:
            due = await asyncio.wait_for(worker.run(svc.excel_has_changes), 10)
        except Exception:  # Excel busy or gone: asked again next time
            due = False
    if not due:
        return
    try:
        await asyncio.wait_for(worker.run(svc.save), SAVE_WAIT)
        log.info("saved the workbook automatically")
    except Exception as exc:  # Excel busy (a cell being edited, a dialog), or gone
        svc.save_note = f"Auto-save waiting: {exc}"[:300]
        state[("retry", key)] = now + RETRY
        log.info("automatic save put off: %s", exc)


async def _snapshot_if_changed(svc, worker, state: dict, key: int, now: float) -> None:
    """A whole copy every few minutes, only when something changed since the last one: the tool
    wrote, the workbook was saved, or Excel holds unsaved changes (typed in Excel)."""
    from app import snapshots

    state[("snap", key)] = now + snapshots.SNAP_EVERY  # looked at most this often
    last = state.get(("snap_write", key), 0.0)
    changed = svc.last_write > last or (
        svc.saved_at is not None and (svc.snapshot_at is None or svc.saved_at > svc.snapshot_at)
    )
    if not changed:
        try:
            changed = await asyncio.wait_for(worker.run(svc.excel_has_changes), 10)
        except Exception:
            changed = False
    if not changed:
        return
    try:
        path = await asyncio.wait_for(worker.run(snapshots.take, svc), SAVE_WAIT)
        state[("snap_write", key)] = time.monotonic()
        svc.snapshot_note = None
        log.info("snapshot %s", path.name)
    except Exception as exc:  # Excel busy: tried again soon
        state[("snap", key)] = now + RETRY
        svc.snapshot_note = f"Copy waiting: {exc}"[:300]
        log.info("snapshot put off: %s", exc)


async def run(app) -> None:
    state: dict = {}
    while True:
        await asyncio.sleep(TICK)
        try:
            await tick(app, state)
        except Exception as exc:  # never stop the loop
            log.warning("automatic save: %s", exc)
