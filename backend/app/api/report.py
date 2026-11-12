"""Sharing with the PM and QS (roadmap #10): the evening report written to a (shared) folder, and
the same report read-only at ``/viewer`` for colleagues on the office network when that is on.

Settings (``report`` in the settings file): folder, time (HH:MM), enabled, rupees (off: no costs
in the report), lan (serve /viewer to other PCs; takes effect at the next start of the tool).
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.books import workbook_kind
from app.report import Context, build_report

router = APIRouter()
log = logging.getLogger("labour.report")
KEY = "report"
LOCAL = {"127.0.0.1", "::1", "localhost", "testclient"}


class ReportSettings(BaseModel):
    folder: str = Field("", max_length=500)  # e.g. \\\\server\\share\\Labour reports
    time: str = Field("18:30", pattern=r"^\d{1,2}:\d{2}$")
    enabled: bool = False
    rupees: bool = False  # costs at standard rates in the report (off by default)
    lan: bool = False  # colleagues open /viewer from their PCs (next start of the tool)


class ReportState(ReportSettings):
    last_at: str | None = None
    last_file: str | None = None
    last_error: str | None = None
    lan_active: bool = False  # this run of the tool listens on the network
    viewer_url: str | None = None


def _settings(app) -> ReportSettings:
    saved = app.state.session.settings.get_key(KEY)
    return ReportSettings(**{k: v for k, v in saved.items() if k in ReportSettings.model_fields})


def _state(app) -> ReportState:
    saved = app.state.session.settings.get_key(KEY)
    port = app.state.config.server.port
    return ReportState(
        **_settings(app).model_dump(),
        last_at=saved.get("last_at"),
        last_file=saved.get("last_file"),
        last_error=saved.get("last_error"),
        lan_active=bool(getattr(app.state, "lan_active", False)),
        viewer_url=f"http://{getattr(app.state, 'lan_name', 'localhost')}:{port}/viewer",
    )  # fmt: skip


async def render(app) -> tuple[str, str]:
    """The report HTML for the workbook open now, and its kind (for the file name)."""
    session = app.state.session
    book = session.book
    if book is None:
        raise HTTPException(409, "No workbook is open in the tool.")
    service = app.state.get_service()
    config = app.state.config
    path = Path(book.path) if book.path else None
    if path is not None and path.suffix.lower() == ".xlsb" and path.exists():
        from app.excel.xlsb_reader import XlsbReader

        def read():
            with XlsbReader(path) as reader:
                return reader.snapshot()

        snapshot = await asyncio.to_thread(read)
    else:
        from app.api.entries import run_service

        class _Req:  # run_service wants a request; only .app is used
            def __init__(self, app):
                self.app = app

        snapshot = await run_service(_Req(app), lambda s: s.snapshot())
    from app.domain.losttime import CAUSES

    settings = _settings(app)
    ctx = Context(
        workbook=book.name, month=config.month, holidays=list(config.holidays),
        trade_letters=service.trade_letters, descriptions=config.descriptions, places=config.places,
        rates=config.rates if settings.rupees and config.rates else None,
        lost=service.audit.lost(book.name), causes={c.id: c.label for c in CAUSES},
        limits={"week_hours": 60, **(config.limits or {})},
    )  # fmt: skip
    if ctx.rates:  # resolved like the master view (Labour Detail's own rates when chosen)
        ctx.rates = service._rates(snapshot.master)
    return build_report(snapshot, ctx), workbook_kind(book.name)


async def write_report(app) -> Path:
    settings = _settings(app)
    if not settings.folder.strip():
        raise HTTPException(422, "Choose the folder the report goes to first.")
    folder = Path(settings.folder.strip())
    text, kind = await render(app)
    today = dt.date.today()
    name = re.sub(r"[^\w .-]", "", f"Labour report {kind}").strip()
    saved = app.state.session.settings
    try:
        folder.mkdir(parents=True, exist_ok=True)
        dated = folder / f"{name} {today:%Y-%m-%d}.html"
        dated.write_text(text, encoding="utf-8")
        (folder / f"{name} latest.html").write_text(text, encoding="utf-8")
    except OSError as exc:
        saved.set_key(KEY, last_error=f"{dt.datetime.now():%d %b %H:%M}: {exc}")
        raise HTTPException(422, f"Could not write to {folder}: {exc}") from exc
    saved.set_key(
        KEY,
        last_at=dt.datetime.now().isoformat(timespec="minutes"),
        last_file=str(dated),
        last_error=None,
        last_day=today.isoformat(),
    )
    return dated


async def scheduler(app, every: float = 60) -> None:
    """Every minute: once the evening time has passed, write today's report (once a day)."""
    while True:
        await asyncio.sleep(every)
        try:
            s = _settings(app)
            if not (s.enabled and s.folder.strip()) or app.state.session.book is None:
                continue
            h, m = (int(x) for x in s.time.split(":"))
            now = dt.datetime.now()
            done = app.state.session.settings.get_key(KEY).get("last_day")
            if (now.hour, now.minute) >= (h, m) and done != now.date().isoformat():
                path = await write_report(app)
                log.info("evening report written: %s", path)
        except Exception as exc:  # never stop the loop; the page shows the last error
            log.warning("evening report not written: %s", exc)
            when = f"{dt.datetime.now():%d %b %H:%M}"
            app.state.session.settings.set_key(
                KEY, last_error=f"{when}: {exc}", last_day=dt.date.today().isoformat()
            )


@router.get("/api/report/settings", response_model=ReportState)
def get_settings(request: Request) -> ReportState:
    return _state(request.app)


@router.post("/api/report/settings", response_model=ReportState)
def set_settings(body: ReportSettings, request: Request) -> ReportState:
    h, m = (int(x) for x in body.time.split(":"))
    if not (0 <= h < 24 and 0 <= m < 60):
        raise HTTPException(422, "The time is HH:MM, e.g. 18:30.")
    request.app.state.session.settings.set_key(KEY, **body.model_dump())
    return _state(request.app)


@router.post("/api/report/write", response_model=ReportState)
async def write_now(request: Request) -> ReportState:
    await write_report(request.app)
    return _state(request.app)


@router.get("/viewer", response_class=HTMLResponse, include_in_schema=False)
async def viewer(request: Request) -> HTMLResponse:
    """The report, live and read-only: for colleagues on the network (when that is on) and as
    a preview on this PC."""
    host = request.client.host if request.client else ""
    if host not in LOCAL and not _settings(request.app).lan:
        raise HTTPException(403, "Viewing from other PCs is switched off.")
    text, _ = await render(request.app)
    return HTMLResponse(text, headers={"Cache-Control": "no-store"})
