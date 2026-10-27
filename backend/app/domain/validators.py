"""Validation catalogue (PLAN.md §7): checks on one entry and one day-sheet header.

Pure functions over the models; they never change values. The health check runs them over a whole
workbook, and the entry UI (Phase 3) runs them on a single entry before it is queued. Checks that
need more than one entry (W02 rest, W03 overlap, W07 per worker) and master-data checks live in
``health``. The write-time checks E07-E09 live in ``writes``.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Collection, Iterable
from dataclasses import dataclass

from app.config import TemplateConfig
from app.domain import rules
from app.domain.codes import cell_text, normalise_activity
from app.domain.models import (
    CellValue,
    Computed,
    DayHeader,
    Entry,
    Issue,
    Severity,
    as_number,
    is_blank,
)

EFFECTIVE_LIMIT = 16.0  # W01
MIN_REST = 8.0  # W02


@dataclass(frozen=True)
class Rule:
    id: str
    severity: Severity
    title: str


# Severity of the M rules is the tool's choice (the plan gives none): WARN when it reaches the ERP
# upload or identity, INFO for spelling and list hygiene.
RULES: dict[str, Rule] = {
    r.id: r
    for r in [
        Rule("E01", "BLOCK", "In and Out both required"),
        Rule("E02", "BLOCK", "Out must be after In, within 24 h"),
        Rule("E03", "BLOCK", "Times and hours on the 15-minute grid, hours numeric > 0"),
        Rule("E04", "BLOCK", "Activity code not in the activity list"),
        Rule("E05", "BLOCK", "Activity hours exceed effective hours"),
        Rule("E06", "BLOCK", "More than 5 activity lines"),
        Rule("E07", "BLOCK", "Calling name not found in one block of the sheet"),
        Rule("E08", "BLOCK", "Block already has input (overwrite not confirmed)"),
        Rule("E09", "BLOCK", "Write outside the input cells"),
        Rule("W01", "WARN", "Effective hours over 16"),
        Rule("W02", "WARN", "Less than 8 h rest before the next day's shift"),
        Rule("W03", "WARN", "Same person booked twice with overlapping times"),
        Rule("W04", "WARN", "Additional hours without a remark"),
        Rule("W05", "WARN", "Out exactly 22:00 (Excel deducts lunch only)"),
        Rule("W06", "WARN", "In at or after 12:00 (Excel still deducts lunch)"),
        Rule("W07", "WARN", "No valid employee code: ERP upload lines go out blank"),
        Rule("W08", "INFO", "Unallocated hours go to ZIDLE"),
        Rule("H01", "BLOCK", "Sheet date does not match the sheet number"),
        Rule("H02", "BLOCK", "Day type does not match the calendar"),
        Rule("H03", "WARN", "Sheet number (F4) does not match the sheet"),
        Rule("M01", "WARN", "Calling name format, spaces or duplicates"),
        Rule("M02", "WARN", "Employee code missing, broken or shared"),
        Rule("M03", "WARN", "One ID under different names, or one person with two codes"),
        Rule("M04", "INFO", "Trade group spelling"),
        Rule("M05", "INFO", "Activity list duplicates or stray spaces"),
        Rule("M06", "WARN", "Typed activity code has stray spaces"),
        Rule("R01", "WARN", "Registration calling name: format or duplicate"),
        Rule("R02", "WARN", "Registration employee code or ID used twice"),
        Rule("R03", "INFO", "Designation or trade group spelling"),
        Rule("R04", "WARN", "NIC number: format, date of birth or gender mismatch"),
        Rule("R05", "WARN", "Registration dates: unreadable, mixed formats or under 18"),
        Rule("R06", "INFO", "Calling-name list and registration differ"),
    ]
}


def make_issue(rule: str, message: str, **where: str | None) -> Issue:
    return Issue(rule=rule, severity=RULES[rule].severity, message=message, **where)


def fmt_hours(value: float) -> str:
    """7.5 -> '7.5', 11.0 -> '11'."""
    return f"{value:g}"


def fmt_time(value: float) -> str:
    """Decimal hours as a clock time: 7.5 -> '07:30', 30 -> '06:00 (+1 day)'."""
    minutes = round(value * 60)
    days, minutes = divmod(minutes, 24 * 60)
    text = f"{minutes // 60:02d}:{minutes % 60:02d}"
    return f"{text} (+{days} day)" if days else text


# --- One entry -------------------------------------------------------------------------------


def _cell(template: TemplateConfig, col: str, row: int) -> str:
    return f"{getattr(template.cols, col)}{row}"


def check_entry(
    entry: Entry,
    day_type: CellValue,
    activity_codes: Collection[str],
    template: TemplateConfig | None = None,
) -> list[Issue]:
    """E01-E06, W01, W04-W06, W08 and M06 for one entry.

    ``activity_codes`` holds the trimmed codes of the activity list (E04 matches trimmed).
    """
    t = template or TemplateConfig()
    sheet, name, r = entry.sheet, entry.calling_name, entry.row

    def issue(rule: str, message: str, col: str, row: int = r) -> Issue:
        return make_issue(rule, message, sheet=sheet, cell=_cell(t, col, row), calling_name=name)

    issues: list[Issue] = []
    time_in, time_out = as_number(entry.time_in), as_number(entry.time_out)

    # E01: In and Out both required when anything else is entered.
    for col, value, number, label in (
        ("time_in", entry.time_in, time_in, "In"),
        ("time_out", entry.time_out, time_out, "Out"),
    ):
        if is_blank(value):
            issues.append(issue("E01", f"{label} is blank but the block has other input.", col))
        elif number is None:
            issues.append(issue("E03", f"{label} is text ({cell_text(value)!r}), not a time.", col))

    # E02 / E03 on the times.
    if time_in is not None and time_out is not None and not time_in < time_out <= time_in + 24:
        issues.append(
            issue(
                "E02",
                f"In {fmt_hours(time_in)}, Out {fmt_hours(time_out)}: Out must be after In "
                "and at most 24 h later (overnight Out is written past 24).",
                "time_out",
            )
        )
    for col, number in (("time_in", time_in), ("time_out", time_out)):
        if number is not None and not rules.on_quarter_grid(number):
            issues.append(issue("E03", f"{fmt_hours(number)} is not on the 15-minute grid.", col))
    additional = as_number(entry.additional)
    if not is_blank(entry.additional) and additional is None:
        issues.append(
            issue(
                "E03", f"Additional hours is text ({cell_text(entry.additional)!r}).", "additional"
            )
        )
    elif additional is not None and not rules.on_quarter_grid(additional):
        issues.append(
            issue("E03", f"Additional hours {fmt_hours(additional)} off the grid.", "additional")
        )

    # Activity lines: E03 hours, E04 / M06 codes, E06 count.
    lines = entry.activity_lines
    for line in lines:
        hours = as_number(line.hours)
        if is_blank(line.code):
            issues.append(
                issue("E04", "Hours entered without an activity code.", "activity", line.row)
            )
        else:
            code = normalise_activity(line.code)
            if code not in activity_codes:
                issues.append(
                    issue(
                        "E04",
                        f"Activity {code!r} is not in the activity list.",
                        "activity",
                        line.row,
                    )
                )
            elif cell_text(line.code) != code:
                issues.append(
                    issue(
                        "M06",
                        f"Activity {cell_text(line.code)!r} has stray spaces; the ERP line gets "
                        "them too.",
                        "activity",
                        line.row,
                    )
                )
        if is_blank(line.hours):
            issues.append(issue("E03", "Activity has no hours.", "hours", line.row))
        elif hours is None:
            effect = (
                "Excel reads it as a number, but enter it as one"
                if rules.arith_value(line.hours) is not None
                else "Excel cannot add it, so the day's ZIDLE line disappears"
            )
            issues.append(
                issue(
                    "E03",
                    f"Hours typed as text ({cell_text(line.hours)!r}). {effect}.",
                    "hours",
                    line.row,
                )
            )
        elif hours <= 0 or not rules.on_quarter_grid(hours):
            issues.append(
                issue(
                    "E03",
                    f"Hours {fmt_hours(hours)} must be > 0 on the 15-minute grid.",
                    "hours",
                    line.row,
                )
            )
    if len(lines) > t.activity_rows[1] - t.activity_rows[0] + 1:
        issues.append(issue("E06", f"{len(lines)} activity lines; the block has 5.", "activity"))

    computed = rules.compute_entry(entry, day_type)
    if computed is not None:
        issues += _check_computed(entry, computed, issue)
    return issues


def _check_computed(entry: Entry, c: Computed, issue) -> list[Issue]:
    time_in, time_out = as_number(entry.time_in), as_number(entry.time_out)
    out: list[Issue] = []
    eff = fmt_hours(c.effective)

    if c.activity_hours > 0 and c.activity_hours > c.effective + rules.EPS:
        out.append(
            issue(
                "E05",
                f"Activities total {fmt_hours(c.activity_hours)} h but effective is {eff} h: "
                f"Excel books ZIDLE {fmt_hours(c.zidle or 0)} h.",
                "hours",
            )
        )
    elif c.zidle is not None and c.zidle > rules.EPS:
        out.append(
            issue(
                "W08",
                f"{fmt_hours(c.zidle)} of {eff} effective hours are not allocated (ZIDLE).",
                "hours",
            )
        )
    if c.effective > EFFECTIVE_LIMIT:
        out.append(
            issue(
                "W01",
                f"Effective {eff} h ({fmt_time(time_in)}-{fmt_time(time_out)}).",
                "effective",
            )
        )
    additional = as_number(entry.additional) or 0.0
    if additional != 0 and is_blank(entry.remark):
        out.append(
            issue("W04", f"Additional hours {fmt_hours(additional)} with no remark.", "remarks")
        )
    if time_out == rules.DINNER_AFTER and additional != -1:
        out.append(
            issue(
                "W05",
                "Out is exactly 22:00, so Excel deducts only the lunch hour. Staff usually enter "
                "-1 as additional hours here; check whether dinner was taken.",
                "time_out",
            )
        )
    if time_in is not None and time_in >= rules.LUNCH_AFTER:
        out.append(
            issue(
                "W06",
                f"In {fmt_time(time_in)}: Excel still deducts a lunch hour (effective {eff} h).",
                "time_in",
            )
        )
    return out


# --- Day-sheet header ------------------------------------------------------------------------


def calendar_day_type(date: dt.date, holidays: Iterable[dt.date]) -> str:
    if date in set(holidays):
        return rules.HOLIDAY
    return {5: rules.SATURDAY, 6: rules.SUNDAY}.get(date.weekday(), rules.NORMAL_DAY)


def intended_date(sheet: str, month_start: dt.date) -> dt.date | None:
    """Sheet n is day n of the month; None when the month has no such day (e.g. sheet 31)."""
    try:
        return month_start.replace(day=int(sheet))
    except ValueError:
        return None


def check_header(
    header: DayHeader,
    month_start: dt.date,
    holidays: Iterable[dt.date] = (),
    template: TemplateConfig | None = None,
) -> list[Issue]:
    """H01-H03 for one day sheet."""
    t = template or TemplateConfig()
    sheet = header.sheet
    issues: list[Issue] = []
    expected = intended_date(sheet, month_start)

    if expected is None:
        return issues  # e.g. sheet 31 in a 30-day month: not a day of this month
    if header.date != expected:
        shown = header.date.isoformat() if header.date else cell_text(header.date_raw) or "blank"
        issues.append(
            make_issue(
                "H01",
                f"Dated {shown}, expected {expected.isoformat()}. Every ERP line from this "
                "sheet carries the wrong date.",
                sheet=sheet,
                cell=t.header.date,
                suggestion=f"Set {t.header.date} to {expected.isoformat()}.",
            )
        )

    want = calendar_day_type(expected, holidays)
    got = rules.canonical_day_type(header.day_type)
    if got != want:
        weekday = expected.strftime("%A")
        if got == rules.HOLIDAY:
            why = (
                f"marked Holiday, but {expected.isoformat()} is not in the holiday list "
                f"(a {weekday})"
            )
            fix = f"If it is a holiday, add {expected.isoformat()} to holidays in config.yaml."
        else:
            shown = cell_text(header.day_type) or "blank"
            why = f"{shown!r} on a {weekday}" + (" (holiday list)" if want == rules.HOLIDAY else "")
            fix = f"Set {t.header.day_type} to {want}."
        issues.append(
            make_issue(
                "H02", f"Day type {why}.", sheet=sheet, cell=t.header.day_type, suggestion=fix
            )
        )

    if as_number(header.sheet_no) != float(sheet):
        issues.append(
            make_issue(
                "H03",
                f"Sheet no. is {cell_text(header.sheet_no) or 'blank'}, expected {sheet}.",
                sheet=sheet,
                cell=t.header.sheet_no,
                suggestion=f"Set {t.header.sheet_no} to {sheet}.",
            )
        )
    return issues
