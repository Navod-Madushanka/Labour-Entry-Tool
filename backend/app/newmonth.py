"""Start the next month's workbook from this one: a folder named after the month, a copy of the
workbook with the name the user chooses, and only the entries cleared.

What is cleared, on every day sheet, in each worker block that has input: Time In and Out
(G:H on the block's first row), the activity lines (J:K, five rows), Additional hours (L) and
Remarks (R): the cells the tool itself writes. What stays: Labour Detail (workers, codes, trades,
the activity list), every formula, the ERP upload columns, the summary and time-card sheets.
Each day sheet then gets the new month's date, day type and sheet number (sheets the new month
does not have, like 31 in November, keep their header and are only cleared).
"""

from __future__ import annotations

import datetime as dt
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from app.carryover import MONTHS, month_of
from app.config import TemplateConfig
from app.domain.models import WorkbookSnapshot
from app.domain.validators import calendar_day_type, intended_date
from app.domain.writes import RangeWrite
from app.excel.grid import date_to_excel_serial

SUFFIXES = (".xlsb", ".json")


def month_label(month: dt.date) -> str:
    return f"{MONTHS[month.month - 1].capitalize()} {month.year}"


def next_month(month: dt.date) -> dt.date:
    return (month.replace(day=28) + dt.timedelta(days=4)).replace(day=1)


def default_name(source_name: str, month: dt.date) -> str:
    """The old name with the new month and year in it ("… October 2026 - INDIAN (2).xlsb" ->
    "… November 2026 - INDIAN.xlsb"); without a month in it, " - November 2026" is added."""
    path = Path(source_name)
    stem = re.sub(r"\s*\(\d+\)\s*$", "", path.stem)  # "(2)" from a downloaded copy
    pattern = re.compile(r"(" + "|".join(MONTHS) + r")(\s*[-_ ]?\s*)(20\d\d)?", re.IGNORECASE)
    m = pattern.search(stem)
    if m:
        old = m.group(1)
        word = MONTHS[month.month - 1]
        if old.isupper():
            word = word.upper()
        elif old[0].isupper():
            word = word.capitalize()
        year = str(month.year) if m.group(3) else ""
        stem = f"{stem[: m.start()]}{word}{m.group(2) or ' '}{year}".rstrip() + stem[m.end() :]
    else:
        stem = f"{stem} - {month_label(month)}"
    return stem + (path.suffix or ".xlsb")


def default_folder(source: Path, month: dt.date) -> Path:
    """A folder named after the month: next to the workbook's folder when that one is itself a
    month folder ("…/October 2026/x.xlsb" -> "…/November 2026"), else inside the workbook's
    folder."""
    parent = source.parent
    base = parent.parent if month_of(parent.name) else parent
    return base / month_label(month)


@dataclass
class SheetPlan:
    sheet: str
    date: dt.date | None  # None: not a day of the new month (header kept, entries cleared)
    day_type: str | None
    clear: list[str] = field(default_factory=list)  # cell ranges to empty
    entries: int = 0


def plan_sheets(snapshot: WorkbookSnapshot, template: TemplateConfig, month: dt.date,
                holidays: list[dt.date]) -> list[SheetPlan]:  # fmt: skip
    """What to clear and which header to write, per day sheet."""
    c = template.cols
    first, last = template.activity_rows
    out = []
    for day in snapshot.days:
        date = intended_date(day.header.sheet, month)
        plan = SheetPlan(sheet=day.header.sheet, date=date,
                         day_type=calendar_day_type(date, holidays) if date else None)  # fmt: skip
        for e in day.entries:
            r = e.row
            plan.clear += [f"{c.time_in}{r}:{c.time_out}{r}",
                           f"{c.activity}{r + first - 1}:{c.hours}{r + last - 1}",
                           f"{c.additional}{r}", f"{c.remarks}{r}"]  # fmt: skip
            plan.entries += 1
        out.append(plan)
    return out


def header_writes(plans: list[SheetPlan], template: TemplateConfig) -> list[RangeWrite]:
    h = template.header
    writes = []
    for p in plans:
        if p.date is None:
            continue
        writes += [
            RangeWrite(sheet=p.sheet, address=h.date, values=[[date_to_excel_serial(p.date)]]),
            RangeWrite(sheet=p.sheet, address=h.day_type, values=[[p.day_type]]),
            RangeWrite(sheet=p.sheet, address=h.sheet_no, values=[[float(p.sheet)]]),
        ]
    return writes


def cleared_snapshot(
    snapshot: WorkbookSnapshot, plans: list[SheetPlan], name: str
) -> WorkbookSnapshot:
    """The practice (.json) version: the same workbook with the entries gone and new headers."""
    by_sheet = {p.sheet: p for p in plans}
    days = []
    for d in snapshot.days:
        p = by_sheet[d.header.sheet]
        header = d.header
        if p.date is not None:
            update = {"date": p.date, "date_raw": date_to_excel_serial(p.date),
                      "day_type": p.day_type, "sheet_no": float(p.sheet)}  # fmt: skip
            header = header.model_copy(update=update)
        days.append(d.model_copy(update={"header": header, "entries": []}))
    now = dt.datetime.now().astimezone()
    meta = snapshot.meta.model_copy(update={"source_name": name, "read_at": now})
    return snapshot.model_copy(update={"days": days, "meta": meta})


def check_target(folder: Path, name: str, source: Path) -> Path:
    """The new file's path; refuses a bad name, another suffix, or a file that is already there."""
    name = name.strip()
    if not name or any(ch in name for ch in '\\/:*?"<>|'):
        raise ValueError('Give a file name without \\ / : * ? " < > |.')
    if Path(name).suffix.lower() != source.suffix.lower():
        name = f"{name}{source.suffix}"
    path = folder / name
    if path.exists():
        raise FileExistsError(f"{path} already exists. Choose another name or folder.")
    if path.resolve() == source.resolve():
        raise ValueError("The new file cannot be the same file as the old one.")
    return path


def copy_workbook(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
