"""Checking bills against the day sheets (roadmap #8, read-only).

Two things can be compared with what the day sheets say:

* the workbook's own **BP Bill** sheet. Its exact layout is not known yet, so it is found: the
  header row with "Calling Name" (else the column full of calling names), day columns headed 1-31
  (or dates), totals headed "Total days", "Total hours", "Amount", and whether the day cells hold
  hours or day counts (from their values). What was found is shown and can be corrected.
* a **supplier's claim**: one row per worker with Business partner, Calling name, Days billed and
  Hours billed (optional), columns found by their header text.

A day counts for the BP Bill at 6 or more effective hours (``rules.bp_bill_counts_day``).
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from app.domain.codes import cell_text, normalise_code
from app.domain.models import WorkbookSnapshot, as_number
from app.domain.rules import bp_bill_counts_day, canonical_day_type, compute_entry

Grid = dict[tuple[int, int], object]  # (row, col) 1-based -> value
NAME_RE = re.compile(r"^[A-Z]{2,4}-?\d{1,3}(\s+[A-Z]{1,3})?$")


class Layout(BaseModel):
    sheet: str = ""
    header_row: int | None = None
    name_col: int | None = None
    day_cols: dict[int, int] = {}  # day -> column
    total_days_col: int | None = None
    total_hours_col: int | None = None
    amount_col: int | None = None
    bp_col: int | None = None
    mode: Literal["hours", "days"] = "hours"  # what a day cell holds
    notes: list[str] = []

    @property
    def found(self) -> bool:
        return bool(self.name_col and self.day_cols)


def col_letter(c: int | None) -> str:
    if not c:
        return "—"
    out = ""
    while c:
        c, r = divmod(c - 1, 26)
        out = chr(65 + r) + out
    return out


def _text(v: object) -> str:
    return re.sub(r"\s+", " ", cell_text(v)).strip().lower()


def detect(grid: Grid, sheet: str = "BP Bill", month: str | None = None) -> Layout:
    """Find the BP Bill's layout in a grid of its cells."""
    lay = Layout(sheet=sheet)
    rows = sorted({r for r, _ in grid})
    # 1. the header row: "calling name" in the first 40 rows
    for r in rows[:40]:
        for (rr, c), v in grid.items():
            if rr == r and re.search(r"calling\s*name", _text(v)):
                lay.header_row, lay.name_col = r, c
                break
        if lay.header_row:
            break
    if not lay.header_row:  # else the column full of calling names, its header the row above
        counts: dict[int, list[int]] = {}
        for (r, c), v in grid.items():
            if isinstance(v, str) and NAME_RE.match(v.strip().upper()):
                counts.setdefault(c, []).append(r)
        if counts:
            c, rs = max(counts.items(), key=lambda x: len(x[1]))
            if len(rs) >= 3:
                lay.name_col, lay.header_row = c, max(min(rs) - 1, 1)
                lay.notes.append(
                    f"No 'Calling Name' heading: column {col_letter(c)} holds calling names."
                )
    if not lay.header_row:
        lay.notes.append("No header row with 'Calling Name' and no column of calling names found.")
        return lay
    # 2. day columns: headed 1..31 (or dates of the month) in the header row or the 2 rows around
    first = dt.date.fromisoformat(f"{month}-01") if month else None
    for r in (lay.header_row, lay.header_row - 1, lay.header_row + 1, lay.header_row - 2):
        found: dict[int, int] = {}
        for (rr, c), v in grid.items():
            if rr != r or c == lay.name_col:
                continue
            n = as_number(v)
            if isinstance(v, (dt.date, dt.datetime)):
                d = v.date() if isinstance(v, dt.datetime) else v
                if first is None or (d.year, d.month) == (first.year, first.month):
                    found.setdefault(d.day, c)
            elif n is not None and float(n).is_integer() and 1 <= n <= 31:
                found.setdefault(int(n), c)
        if len(found) >= 20:
            lay.day_cols = dict(sorted(found.items()))
            if r != lay.header_row:
                lay.notes.append(
                    f"Day numbers are in row {r}, the names' heading in row {lay.header_row}."
                )
            break
    if not lay.day_cols:
        lay.notes.append("No columns headed with the days 1-31 were found.")
    # 3. totals, amount and business partner by their headings
    for (r, c), v in grid.items():
        if (
            r not in (lay.header_row, lay.header_row - 1, lay.header_row + 1)
            or c in lay.day_cols.values()
        ):
            continue
        t = _text(v)
        if not t:
            continue
        if (
            re.search(r"\b(no\.?\s*of\s*)?days?\b", t)
            and lay.total_days_col is None
            and "rate" not in t
        ):
            lay.total_days_col = c
        elif (
            re.search(r"\bhours?\b|\bhrs\b", t) and lay.total_hours_col is None and "rate" not in t
        ):
            lay.total_hours_col = c
        elif re.search(r"amount|total\s*\(?rs|value|cost", t) and lay.amount_col is None:
            lay.amount_col = c
        elif re.search(r"business\s*partner|\bbp\b|supplier|contractor", t) and lay.bp_col is None:
            lay.bp_col = c
    # 4. what a day cell holds: day counts are 0, 0.5 or 1
    values = [
        as_number(grid.get((r, c)))
        for r in rows
        if r > lay.header_row
        for c in lay.day_cols.values()
    ]
    values = [v for v in values if v]
    if values and all(v in (0.5, 1) for v in values):
        lay.mode = "days"
    return lay


def describe(lay: Layout) -> str:
    if not lay.found:
        return "Layout not found"
    days = list(lay.day_cols)
    holds = "hours" if lay.mode == "hours" else "day counts"
    parts = [
        f"header row {lay.header_row}",
        f"calling names in {col_letter(lay.name_col)}",
        f"days {days[0]}–{days[-1]} in {col_letter(lay.day_cols[days[0]])}"
        f"–{col_letter(lay.day_cols[days[-1]])} ({holds})",
    ]
    if lay.total_days_col:
        parts.append(f"total days in {col_letter(lay.total_days_col)}")
    if lay.total_hours_col:
        parts.append(f"total hours in {col_letter(lay.total_hours_col)}")
    if lay.bp_col:
        parts.append(f"business partner in {col_letter(lay.bp_col)}")
    return ", ".join(parts)


class BillRow(BaseModel):
    name: str
    bp: str = ""
    days: dict[int, float] = {}
    total_days: float | None = None
    total_hours: float | None = None


def read_bill(grid: Grid, lay: Layout) -> dict[str, BillRow]:
    out: dict[str, BillRow] = {}
    if not lay.found:
        return out
    last = max((r for r, _ in grid), default=0)
    for r in range(lay.header_row + 1, last + 1):
        name = cell_text(grid.get((r, lay.name_col))).strip()
        if not name or not NAME_RE.match(name.upper()):
            continue
        row = out.setdefault(name, BillRow(name=name))
        if lay.bp_col:
            row.bp = cell_text(grid.get((r, lay.bp_col))).strip()
        for d, c in lay.day_cols.items():
            v = as_number(grid.get((r, c)))
            if v:
                row.days[d] = row.days.get(d, 0) + v
        if lay.total_days_col:
            row.total_days = as_number(grid.get((r, lay.total_days_col)))
        if lay.total_hours_col:
            row.total_hours = as_number(grid.get((r, lay.total_hours_col)))
    return out


def sheet_days(snapshot: WorkbookSnapshot) -> dict[str, dict[int, float]]:
    """Calling name -> day -> effective hours, from the day sheets."""
    out: dict[str, dict[int, float]] = {}
    for d in snapshot.days:
        try:
            day = int(d.header.sheet)
        except ValueError:
            continue
        day_type = canonical_day_type(d.header.day_type)
        for e in d.entries:
            name = cell_text(e.calling_name).strip()
            c = compute_entry(e, day_type)
            if name and c is not None and c.effective > 0:
                out.setdefault(name, {})[day] = out.get(name, {}).get(day, 0) + c.effective
    return out


class Difference(BaseModel):
    name: str
    day: int | None = None  # None: the worker's total
    bill: float | None
    sheets: float | None
    note: str


def compare_bill(
    bill: dict[str, BillRow], sheets: dict[str, dict[int, float]], lay: Layout
) -> list[Difference]:
    """Worker by worker and day by day, the BP Bill against the day sheets."""
    out: list[Difference] = []
    key = {normalise_code(n): n for n in sheets}
    seen = set()
    for name, row in bill.items():
        mine_name = key.get(normalise_code(name))
        mine = sheets.get(mine_name, {}) if mine_name else {}
        seen.add(mine_name)
        if not mine and (row.days or row.total_days):
            out.append(
                Difference(
                    name=name,
                    bill=row.total_days if row.total_days is not None else len(row.days),
                    sheets=0,
                    note="on the BP Bill, but no hours on the day sheets",
                )
            )
            continue
        for d in sorted(set(row.days) | set(mine)):
            b, h = row.days.get(d), mine.get(d)
            if lay.mode == "hours":
                if abs((b or 0) - (h or 0)) > 0.01:
                    out.append(Difference(name=name, day=d, bill=b, sheets=h, note="hours differ"))
            else:
                counted = 1.0 if h is not None and bp_bill_counts_day(h) else 0.0
                if abs((b or 0) - counted) > 0.01:
                    note = (
                        "counted on the BP Bill, under 6 h on the sheets"
                        if (b or 0) > counted
                        else "6+ h on the sheets, not counted on the BP Bill"
                    )
                    out.append(Difference(name=name, day=d, bill=b, sheets=h, note=note))
        if row.total_days is not None:
            billable = sum(1 for h in mine.values() if bp_bill_counts_day(h))
            if abs(row.total_days - billable) > 0.01:
                out.append(
                    Difference(
                        name=name,
                        bill=row.total_days,
                        sheets=billable,
                        note="total days differ from the days at 6+ h on the sheets",
                    )
                )
    for name, days in sheets.items():
        if name not in seen and any(bp_bill_counts_day(h) for h in days.values()):
            out.append(
                Difference(
                    name=name,
                    bill=None,
                    sheets=sum(1 for h in days.values() if bp_bill_counts_day(h)),
                    note="days at 6+ h on the sheets, not on the BP Bill",
                )
            )
    return out


# --- the supplier's claim ---------------------------------------------------------------------


def _num(v: object) -> float | None:
    """A number from a cell: numbers as they are, text like "3" or "1,250.5" read (CSV)."""
    n = as_number(v)
    if n is not None or not isinstance(v, str):
        return n
    try:
        return float(v.replace(",", "").strip())
    except ValueError:
        return None


class ClaimRow(BaseModel):
    bp: str = ""
    name: str
    days: float | None = None
    hours: float | None = None


def rows_from_file(name: str, data: bytes) -> list[list[object]]:
    """The first sheet of an .xlsx, or a .csv, as rows of values."""
    suffix = Path(name).suffix.lower()
    if suffix == ".csv":
        text = data.decode("utf-8-sig", errors="replace")
        return [list(r) for r in csv.reader(io.StringIO(text))]
    if suffix in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        try:
            return [list(r) for r in wb.worksheets[0].iter_rows(values_only=True)]
        finally:
            wb.close()
    raise ValueError("Send the claim as .xlsx or .csv.")


def read_claim(rows: Iterable[list[object]]) -> list[ClaimRow]:
    rows = list(rows)
    head_at, cols = None, {}
    for i, r in enumerate(rows[:20]):
        found = {}
        for c, v in enumerate(r):
            t = _text(v)
            if (
                re.search(r"calling\s*name|^worker|^emp(loyee)?\s*(no|code)?$|^name$", t)
                and "name" not in found
            ):
                found["name"] = c
            elif re.search(r"partner|\bbp\b|supplier|contractor", t):
                found["bp"] = c
            elif re.search(r"days?", t) and "days" not in found:
                found["days"] = c
            elif re.search(r"hours?|hrs", t) and "hours" not in found:
                found["hours"] = c
        if "name" in found and ("days" in found or "hours" in found):
            head_at, cols = i, found
            break
    if head_at is None:
        raise ValueError(
            "No heading row with Calling name and Days billed (or Hours billed) found."
        )
    out = []
    for r in rows[head_at + 1 :]:

        def cell(k: str, r: list[object] = r) -> object:
            return r[cols[k]] if k in cols and cols[k] < len(r) else None

        name = cell_text(cell("name")).strip()
        if not name:
            continue
        out.append(
            ClaimRow(
                bp=cell_text(cell("bp")).strip(),
                name=name,
                days=_num(cell("days")),
                hours=_num(cell("hours")),
            )
        )
    return out


class ClaimCheck(BaseModel):
    bp: str
    name: str
    billed_days: float | None
    sheet_days: int  # days at 6+ effective hours
    billed_hours: float | None
    sheet_hours: float
    note: str


def compare_claim(
    claim: list[ClaimRow], sheets: dict[str, dict[int, float]], bp_of: dict[str, str]
) -> list[ClaimCheck]:
    """Each billed worker against the day sheets; and workers on the sheets of the billed
    business partner(s) who are not on the claim."""
    key = {normalise_code(n): n for n in sheets}
    out, seen = [], set()
    for c in claim:
        mine_name = key.get(normalise_code(c.name))
        seen.add(mine_name)
        days = sheets.get(mine_name, {}) if mine_name else {}
        billable = sum(1 for h in days.values() if bp_bill_counts_day(h))
        hours = sum(days.values())
        notes = []
        if not days:
            notes.append("billed, but no hours on the day sheets")
        if c.days is not None and c.days > billable + 0.01:
            notes.append(f"{c.days - billable:g} day(s) more than the sheets show at 6+ h")
        elif c.days is not None and c.days < billable - 0.01:
            notes.append(f"{billable - c.days:g} day(s) fewer than the sheets show")
        if c.hours is not None and abs(c.hours - hours) > 0.5:
            notes.append(f"hours differ by {c.hours - hours:+g}")
        out.append(
            ClaimCheck(
                bp=c.bp,
                name=c.name,
                billed_days=c.days,
                sheet_days=billable,
                billed_hours=c.hours,
                sheet_hours=round(hours, 2),
                note="; ".join(notes) or "matches",
            )
        )
    partners = {normalise_code(c.bp) for c in claim if c.bp}
    for name, days in sheets.items():
        if name in seen or not any(bp_bill_counts_day(h) for h in days.values()):
            continue
        if partners and normalise_code(bp_of.get(name, "")) not in partners:
            continue  # another business partner's worker
        out.append(
            ClaimCheck(
                bp=bp_of.get(name, ""),
                name=name,
                billed_days=None,
                sheet_days=sum(1 for h in days.values() if bp_bill_counts_day(h)),
                billed_hours=None,
                sheet_hours=round(sum(days.values()), 2),
                note="on the day sheets, not on the claim",
            )
        )
    return out
