"""``GET /api/health`` and ``GET /api/health.csv`` (PLAN.md §6 Phase 1). Read-only.

The workbook is read from ``config.workbook_file`` through pyxlsb. A full read takes seconds, so
the snapshot is cached until the file's size or modification time changes.
"""

from __future__ import annotations

import datetime as dt
import io
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from app.config import Config
from app.domain.health import HealthReport, run_health
from app.domain.models import WorkbookSnapshot
from app.domain.validators import RULES
from app.health import read_snapshot, write_csv

router = APIRouter(prefix="/api")

HOLIDAYS_HELP = (
    "Comma-separated YYYY-MM-DD dates that replace the config holiday list for this request; "
    "an empty value means no holidays. Leave it out to use config.yaml."
)


class SnapshotCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._key: tuple | None = None
        self._snapshot: WorkbookSnapshot | None = None

    def get(self, path: Path, config: Config) -> WorkbookSnapshot:
        stat = path.stat()
        key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns)
        with self._lock:
            if key != self._key:
                self._snapshot = read_snapshot(path, config.template)
                self._key = key
            return self._snapshot


def _parse_holidays(text: str | None) -> list[dt.date] | None:
    if text is None:
        return None
    try:
        return [dt.date.fromisoformat(p.strip()) for p in text.split(",") if p.strip()]
    except ValueError:
        raise HTTPException(422, f"holidays must be YYYY-MM-DD dates, got {text!r}") from None


def _report(request: Request, holidays: str | None) -> HealthReport:
    config: Config = request.app.state.config
    path = config.workbook_file
    if path is None:
        raise HTTPException(503, "No workbook_file is set in config.yaml.")
    if not path.exists():
        raise HTTPException(404, f"Workbook not found: {path}")
    snapshot = request.app.state.snapshots.get(path, config)
    chosen = _parse_holidays(holidays)
    return run_health(
        snapshot,
        config.month_start,
        config.holidays if chosen is None else chosen,
        config.template,
    )


@router.get("/health", response_model=HealthReport)
def get_health(request: Request, holidays: str | None = Query(None, description=HOLIDAYS_HELP)):
    return _report(request, holidays)


@router.get("/health.csv")
def get_health_csv(
    request: Request, holidays: str | None = Query(None, description=HOLIDAYS_HELP)
) -> Response:
    report = _report(request, holidays)
    buf = io.StringIO()
    write_csv(report, buf)
    name = f"{Path(report.source.source_name).stem}_health.csv"
    return Response(
        "﻿" + buf.getvalue(),  # BOM so Excel opens it as UTF-8
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/rules")
def get_rules() -> dict[str, dict[str, str]]:
    """The validation catalogue (PLAN.md §7): id -> severity and title."""
    return {r.id: {"severity": r.severity, "title": r.title} for r in RULES.values()}
