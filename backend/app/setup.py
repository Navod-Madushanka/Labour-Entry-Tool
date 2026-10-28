"""The start page's logic: which month a workbook is for, and the checks run before data entry.

The start page (``api/setup.py``) walks the user through: choose the workbook, health check, fix
what the tool can fix, then these readiness checks, then entry.
"""

from __future__ import annotations

import calendar
import datetime as dt
import re
import tempfile
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from app.domain.codes import employee_code_status
from app.domain.medical import DEFAULT_ACTIVITY
from app.domain.models import WorkbookSnapshot
from app.domain.rules import compute_entry, same_hours
from app.domain.validators import check_header

MONTHS = {name.casefold(): i for i, name in enumerate(calendar.month_name) if name}
MONTHS |= {name.casefold(): i for i, name in enumerate(calendar.month_abbr) if name}


class MonthGuess(BaseModel):
    month: str | None  # YYYY-MM
    source: Literal["file name", "sheet dates", "none"]
    note: str | None = None  # file name and sheet dates disagree


def month_from_name(name: str) -> str | None:
    """'Labour Entry Sheet October 2026 - INDIAN (2).xlsb' -> '2026-10'."""
    for m in re.finditer(r"([A-Za-z]{3,9})[\s_.-]*(20\d\d)", name):
        if (month := MONTHS.get(m.group(1).casefold())) is not None:
            return f"{m.group(2)}-{month:02d}"
    return None


def month_from_dates(snapshot: WorkbookSnapshot) -> str | None:
    counts = Counter(f"{d.header.date:%Y-%m}" for d in snapshot.days if d.header.date)
    return counts.most_common(1)[0][0] if counts else None


def guess_month(name: str, snapshot: WorkbookSnapshot) -> MonthGuess:
    """The file name wins (sheet dates are often last month's until the office updates them;
    the health check then flags them and offers the fix)."""
    by_name, by_dates = month_from_name(name), month_from_dates(snapshot)
    if by_name:
        note = None
        if by_dates and by_dates != by_name:
            note = (
                f"The file name says {_label(by_name)} but most sheet dates are in "
                f"{_label(by_dates)}. Using {_label(by_name)}."
            )
        return MonthGuess(month=by_name, source="file name", note=note)
    if by_dates:
        return MonthGuess(month=by_dates, source="sheet dates")
    return MonthGuess(month=None, source="none")


def _label(month: str) -> str:
    year, m = month.split("-")
    return f"{calendar.month_name[int(m)]} {year}"


# --- readiness ---------------------------------------------------------------------------------


class Check(BaseModel):
    id: str
    status: Literal["ok", "warn", "fail"]
    title: str
    detail: str


class Readiness(BaseModel):
    checks: list[Check]
    ready: bool  # no check failed
    next_sheet: str | None  # where entry should start


def next_sheet(snapshot: WorkbookSnapshot) -> str | None:
    """The sheet after the last one with entries (the first sheet for a new month)."""
    sheets = [d.header.sheet for d in snapshot.days]
    used = [d.header.sheet for d in snapshot.days if d.entries]
    if not sheets:
        return None
    if not used:
        return sheets[0]
    i = sheets.index(used[-1])
    return sheets[min(i + 1, len(sheets) - 1)]


def writable_dir(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=path):
            pass
        return True
    except OSError:
        return False


def readiness(
    snapshot: WorkbookSnapshot,
    month_start: dt.date,
    holidays: Sequence[dt.date],
    template,
    mode: str,
    backup_dir: Path,
    crews: tuple[int, int] | None = None,  # (workers, crews) the day builder proposes
) -> Readiness:
    checks: list[Check] = []

    def add(id: str, status: str, title: str, detail: str) -> None:
        checks.append(Check(id=id, status=status, title=title, detail=detail))

    where = "the workbook open in Excel" if mode == "live" else "a practice copy (Excel untouched)"
    add("workbook", "ok", "Workbook", f"{snapshot.meta.source_name}: entries go into {where}.")

    sheets = [d.header.sheet for d in snapshot.days]
    add(
        "month",
        "ok" if sheets else "fail",
        "Month",
        f"{month_start:%B %Y}, {len(sheets)} day sheets." if sheets else "No day sheets found.",
    )

    header = [
        i for d in snapshot.days for i in check_header(d.header, month_start, holidays, template)
    ]
    wrong = sorted({i.sheet for i in header if i.rule in ("H01", "H02")}, key=_sheet_key)
    if wrong:
        add(
            "headers",
            "fail",
            "Sheet dates and day types",
            f"Sheets {', '.join(wrong)} still have a wrong date or day type: overtime would be "
            "worked out wrongly. Fix them in the previous step.",
        )
    else:
        add(
            "headers",
            "ok",
            "Sheet dates and day types",
            "Every sheet has the right date and day type, so overtime comes out right.",
        )

    workers = snapshot.master.workers
    no_code = [w for w in workers if employee_code_status(w.employee_code) != "valid"]
    add(
        "workers",
        "ok" if workers else "fail",
        "Workers",
        f"{len(workers)} workers in Labour Detail: search by calling name works."
        if workers
        else "No workers in Labour Detail.",
    )
    if no_code:
        names = ", ".join(w.calling_name for w in no_code[:6]) + (" …" if len(no_code) > 6 else "")
        add(
            "codes",
            "warn",
            "Employee codes",
            f"{len(no_code)} workers have no valid code ({names}). Their hours can be entered, "
            "but their ERP upload lines stay blank until a code is added.",
        )
    else:
        add("codes", "ok", "Employee codes", "Every worker has an employee code.")

    codes = {a.code for a in snapshot.master.activities}
    add(
        "activities",
        "ok" if codes else "fail",
        "Activity codes",
        f"{len(codes)} codes in the list: suggestions and the code check work."
        if codes
        else "The activity list in Labour Detail is empty.",
    )
    add(
        "medical",
        "ok" if DEFAULT_ACTIVITY in codes else "warn",
        "Medical leave",
        f"Medical code {DEFAULT_ACTIVITY} is in the list."
        if DEFAULT_ACTIVITY in codes
        else f"Medical code {DEFAULT_ACTIVITY} is not in the activity list.",
    )

    total = agree = 0
    for d in snapshot.days:
        for e in d.entries:
            got = compute_entry(e, d.header.day_type)
            if got is None or e.cached is None or not isinstance(e.cached.effective, float):
                continue
            total += 1
            agree += same_hours(got.effective, e.cached.effective)
    if total == 0:
        add("formulas", "ok", "Excel formulas", "No entries yet to compare with Excel.")
    else:
        add(
            "formulas",
            "ok" if agree == total else "warn",
            "Excel formulas",
            f"The tool's hours agree with Excel's on {agree} of {total} entries."
            + ("" if agree == total else " The rest are listed in the health check."),
        )

    start = next_sheet(snapshot)
    if crews and crews[0]:
        add(
            "daybuilder",
            "ok",
            "Start day from previous days",
            f"Ready for sheet {start}: {crews[0]} workers in {crews[1]} crews from the last days.",
        )
    else:
        add(
            "daybuilder",
            "ok",
            "Start day from previous days",
            "Nothing to copy yet; it works once earlier days have entries.",
        )

    ok = writable_dir(backup_dir)
    add(
        "backups",
        "ok" if ok else "fail",
        "Backups",
        f"A copy is saved in {backup_dir} before the first write."
        if ok
        else f"Cannot write to the backup folder {backup_dir}.",
    )

    return Readiness(checks=checks, ready=all(c.status != "fail" for c in checks), next_sheet=start)


def _sheet_key(sheet: str | None) -> tuple[int, str]:
    return (int(sheet), "") if sheet and sheet.isdigit() else (10**6, sheet or "")
