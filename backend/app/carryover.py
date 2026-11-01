"""The previous month's last days, so suggestions and the day builder work on the 1st as well.

Monthly workbooks of one kind sit side by side ("… October 2026 - INDIAN.xlsb", "… September
2026 - INDIAN.xlsb"). The previous month's file is looked for next to the open one; only its last
day sheets with entries are read (a few seconds, once: cached until the file changes). They are
handed out as sheets 0, -1, -2, … (the previous month's last day is sheet 0).
"""

from __future__ import annotations

import datetime as dt
import re
import threading
from pathlib import Path

from app.config import TemplateConfig
from app.domain.models import DaySheet

MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]  # fmt: skip
CARRY_DAYS = 7
SUFFIXES = (".xlsb", ".json")
_cache: dict[tuple[str, float], list[DaySheet]] = {}
_lock = threading.Lock()


def month_of(name: str) -> dt.date | None:
    low = name.lower()
    for i, m in enumerate(MONTHS):
        if m in low and (y := re.search(r"20\d\d", low)):
            return dt.date(int(y.group()), i + 1, 1)
    return None


def kind_of(name: str) -> str:
    """The workbook name without its month and year: books of one kind follow month to month."""
    low = Path(name).stem.lower()
    low = re.sub("|".join(MONTHS), "", low)
    low = re.sub(r"20\d\d|\(\d+\)|[^a-z]+", " ", low)
    return " ".join(low.split())


def previous_workbook(path: Path | None) -> Path | None:
    """The previous month's workbook of the same kind in the same folder, if there is one."""
    if path is None or not path.parent.is_dir():
        return None
    month = month_of(path.name)
    if month is None:
        return None
    want = (month - dt.timedelta(days=1)).replace(day=1)
    kind = kind_of(path.name)
    found = [
        p for p in path.parent.iterdir()
        if p.suffix.lower() in SUFFIXES and not p.name.startswith("~$") and p != path
        and month_of(p.name) == want and kind_of(p.name) == kind
    ]  # fmt: skip
    return max(found, key=lambda p: p.stat().st_mtime) if found else None


def previous_days(path: Path, template: TemplateConfig, days: int = CARRY_DAYS) -> list[DaySheet]:
    """The last ``days`` day sheets with entries of ``path``, renumbered 0, -1, -2, …"""
    key = (str(path), path.stat().st_mtime)
    with _lock:
        if key in _cache:
            return _cache[key]
    sheets = _read_last(path, template, days)
    out = [
        d.model_copy(update={
            "header": d.header.model_copy(update={"sheet": str(-i)}),
            "entries": [e.model_copy(update={"sheet": str(-i)}) for e in d.entries],
        })
        for i, d in enumerate(sheets)
    ]  # fmt: skip
    with _lock:
        _cache.clear()  # one previous month at a time is plenty
        _cache[key] = out
    return out


def _read_last(path: Path, template: TemplateConfig, days: int) -> list[DaySheet]:
    """Newest first: day sheets with entries, from the end of the month back."""
    if path.suffix.lower() == ".json":
        from app.excel.fake_adapter import load_snapshot

        snap = load_snapshot(path)
        ordered = sorted(snap.days, key=lambda d: _num(d.header.sheet), reverse=True)
        return [d for d in ordered if d.entries][:days]
    from app.excel.xlsb_reader import XlsbReader

    out: list[DaySheet] = []
    with XlsbReader(path, template) as reader:
        for name in sorted(reader.day_sheet_names(), key=_num, reverse=True):
            day = reader.read_day(name)
            if day.entries:
                out.append(day)
            if len(out) >= days:
                break
    return out


def _num(sheet: str) -> int:
    try:
        return int(sheet)
    except ValueError:
        return -1
