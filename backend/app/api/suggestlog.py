"""The suggestion log: what the entry screen offered and what was kept, one line per entry added.

``Labour Entry Tool/logs/suggestions-YYYY-MM.jsonl`` in the data folder of the PC the tool runs
on; it never leaves that PC. No names: only which rule gave the suggestion, whether it was kept or
typed over, and the keys pressed for the entry. Replay walks the sheet rows; this log shows the
real accuracy of the screen as it is used (crew by crew from the paper sheet).
"""

from __future__ import annotations

import datetime as dt
import json
import threading
from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.config import data_dir

router = APIRouter(prefix="/api/suggest-log")
_lock = threading.Lock()


class Offer(BaseModel):
    tier: str | None = Field(None, max_length=20)  # which rule gave the first suggestion
    prefilled: bool = False  # the box was filled with it
    kept: bool = False  # the entry has it
    rank: int | None = Field(
        None, ge=-1, le=20
    )  # where the entry's value was in the list (-1: not)


class LogLine(BaseModel):
    workbook: str = Field("", max_length=200)
    sheet: str = Field("", max_length=10)
    keys: int = Field(0, ge=0, le=10_000)  # keys pressed in the form for this entry
    worker_keys: int = Field(0, ge=0, le=10_000)  # of them, in the worker box
    ms: int = Field(0, ge=0, le=86_400_000)  # from the first key to Add
    also: int = Field(0, ge=0, le=500)  # "same entry also for" workers
    lines: int = Field(0, ge=0, le=10)  # activity lines in the entry
    time: Offer | None = None
    code: Offer | None = None
    record: Offer | None = None  # a whole record copied from the crew


def log_folder() -> Path:
    return data_dir() / "logs"


def log_file(day: dt.date) -> Path:
    return log_folder() / f"suggestions-{day:%Y-%m}.jsonl"


@router.post("")
def add(line: LogLine) -> dict:
    now = dt.datetime.now()
    record = {"at": now.isoformat(timespec="seconds"), **line.model_dump(exclude_none=True)}
    path = log_file(now.date())
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    return {"ok": True}


def read_lines(days: int, today: dt.date | None = None) -> list[dict]:
    today = today or dt.date.today()
    since = today - dt.timedelta(days=days)
    months = {since.replace(day=1), today.replace(day=1)}
    m = since.replace(day=1)
    while m < today.replace(day=1):
        m = (m + dt.timedelta(days=32)).replace(day=1)
        months.add(m)
    out = []
    for month in sorted(months):
        path = log_file(month)
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(raw)
            except ValueError:
                continue  # a line cut by a crash: skipped
            if str(rec.get("at", ""))[:10] >= since.isoformat():
                out.append(rec)
    return out


def summarise(lines: list[dict]) -> dict:
    def offers(field: str) -> dict:
        tiers: dict[str, dict] = {}
        shown = kept = prefilled = prefill_kept = 0
        for rec in lines:
            o = rec.get(field)
            if not o or not o.get("tier"):
                continue
            t = tiers.setdefault(o["tier"], {"shown": 0, "kept": 0})
            t["shown"] += 1
            t["kept"] += bool(o.get("kept"))
            shown += 1
            kept += bool(o.get("kept"))
            if o.get("prefilled"):
                prefilled += 1
                prefill_kept += bool(o.get("kept"))
        return {
            "shown": shown,
            "kept": kept,
            "prefilled": prefilled,
            "prefill_kept": prefill_kept,
            "tiers": tiers,
        }

    n = len(lines)
    workers = sum(1 + int(r.get("also", 0)) for r in lines)
    return {
        "entries": n,
        "workers": workers,
        "keys_per_entry": round(sum(r.get("keys", 0) for r in lines) / n, 1) if n else None,
        "keys_per_worker": round(sum(r.get("keys", 0) for r in lines) / workers, 1)
        if workers
        else None,
        "worker_keys": round(sum(r.get("worker_keys", 0) for r in lines) / n, 1) if n else None,
        "seconds_per_entry": round(sum(r.get("ms", 0) for r in lines) / n / 1000, 1) if n else None,
        "time": offers("time"),
        "code": offers("code"),
        "record": offers("record"),
        "first": lines[0]["at"] if lines else None,
        "last": lines[-1]["at"] if lines else None,
    }


@router.get("/summary")
def summary(days: int = Query(30, ge=1, le=366)) -> dict:
    return {"days": days, "file": str(log_folder()), **summarise(read_lines(days))}
