"""Rolling snapshots: whole copies of each open workbook, kept by the tool (recovery option 2).

The change log (app/recovery.py) knows every cell the tool pushed, but not what was typed straight
into Excel. These copies cover that too: every SNAP_EVERY minutes, when the workbook has changed
since the last copy (the tool wrote to it, it was saved, or Excel holds unsaved changes), a full
copy is saved with Excel's "save a copy" (the open workbook, its name and its saved state are not
touched) into the tool's data folder:

    Labour Entry Tool/snapshots/<workbook>/<workbook>_YYYYMMDD-HHMMSS.xlsb

Kept: the newest KEEP_LAST copies, plus the newest copy of each of the last KEEP_DAYS days, and
never more than MAX_MB per workbook (the oldest go first). Taken only while the Excel thread is
free (never in the middle of a push or a read), in the same background loop as the automatic
save. The switch and the list are in Recover… (on unless turned off).
"""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

from pydantic import BaseModel

from app.config import data_dir
from app.recovery import _MARKS

KEY = "snapshots"  # in the settings file: {"on": bool}
SNAP_EVERY = 10 * 60.0  # seconds
KEEP_LAST = 12  # about two hours of working time
KEEP_DAYS = 14
MAX_MB = 400  # per workbook


class Snapshot(BaseModel):
    file: str
    at: str  # ISO time it was taken
    size_mb: float


def folder() -> Path:
    return data_dir() / "snapshots"


def book_dir(workbook: str) -> Path:
    """One folder per workbook file (its recovered copy shares it): a safe folder name."""
    stem = re.sub(r"\s+", " ", _MARKS.sub("", Path(workbook or "").stem)).strip()
    safe = re.sub(r"[^\w .()-]+", "_", stem).strip() or "workbook"
    return folder() / safe[:80]


def enabled(app) -> bool:
    return app.state.session.settings.get_key(KEY).get("on", True) is not False


def set_enabled(app, on: bool) -> None:
    app.state.session.settings.set_key(KEY, on=on)


def take(service) -> Path:
    """A copy of the workbook now (on the Excel thread)."""
    wb = service.workbook
    name = Path(wb.name)
    d = book_dir(wb.name)
    d.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    path = d / f"{name.stem}_{stamp}{name.suffix}"
    wb.save_copy(path)
    if not path.exists():
        raise OSError(f"the copy was not made: {path}")
    service.snapshot_at = dt.datetime.now().astimezone()
    prune(d)
    return path


def listing(workbook: str) -> list[Snapshot]:
    """The copies of this workbook, newest first."""
    d = book_dir(workbook)
    if not d.is_dir():
        return []
    files = sorted((p for p in d.iterdir() if p.is_file()), key=lambda p: p.stat().st_mtime, reverse=True)
    return [
        Snapshot(file=p.name, size_mb=round(p.stat().st_size / 1e6, 1),
                 at=dt.datetime.fromtimestamp(p.stat().st_mtime).astimezone().isoformat(timespec="seconds"))
        for p in files
    ]  # fmt: skip


def prune(d: Path, now: dt.datetime | None = None) -> list[Path]:
    """Keep the newest KEEP_LAST, the newest of each of the last KEEP_DAYS days, within MAX_MB."""
    now = now or dt.datetime.now()
    files = sorted((p for p in d.iterdir() if p.is_file()), key=lambda p: p.stat().st_mtime, reverse=True)
    keep: list[Path] = files[:KEEP_LAST]
    days_seen: set[dt.date] = set()
    for p in files:
        day = dt.datetime.fromtimestamp(p.stat().st_mtime).date()
        if (now.date() - day).days < KEEP_DAYS and day not in days_seen:
            days_seen.add(day)
            if p not in keep:
                keep.append(p)
    keep.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    total, kept = 0.0, set()
    for p in keep:  # newest first, within the size limit (the newest is always kept)
        size = p.stat().st_size / 1e6
        if kept and total + size > MAX_MB:
            continue
        total += size
        kept.add(p)
    gone = [p for p in files if p not in kept]
    for p in gone:
        try:
            p.unlink()
        except OSError:
            pass
    return gone


def resolve(workbook: str, file: str) -> Path:
    """A listed copy by its file name (nothing outside the workbook's snapshot folder)."""
    d = book_dir(workbook)
    p = (d / file).resolve()
    if p.parent != d.resolve() or not p.is_file():
        raise FileNotFoundError(file)
    return p
