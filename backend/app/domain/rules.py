"""Pure functions that mirror the workbook's formulas (PLAN.md §5.5).

Mirror Excel exactly, quirks included; warnings about the quirks live in ``validators``.
Times are decimal hours (7.5 = 07:30); an overnight Out is written past 24 (30 = 06:00 next day).
"""

from __future__ import annotations

from collections.abc import Iterable

from app.domain.models import CellValue, Computed, Entry, as_number

NORMAL_DAY = "Normal Day"
SATURDAY = "Saturday"
SUNDAY = "Sunday"
HOLIDAY = "Holiday"
DAY_TYPES = (NORMAL_DAY, SATURDAY, SUNDAY, HOLIDAY)

# Hours before OT starts, per day type.
OT_THRESHOLD = {NORMAL_DAY: 8.0, SATURDAY: 5.5, SUNDAY: 0.0, HOLIDAY: 0.0}

LUNCH_AFTER = 12.0  # Out > 12 -> 1 h lunch deducted (even when In >= 12)
DINNER_AFTER = 22.0  # Out > 22 -> 2 h deducted (lunch + dinner); Out == 22 deducts only lunch

EPS = 1e-9


def canonical_day_type(value: CellValue) -> str | None:
    """Match a header day type like an Excel ``=`` comparison does (case-insensitive, no trim).

    Returns the canonical spelling, or None when it is none of the four day types.
    """
    if not isinstance(value, str):
        return None
    for day_type in DAY_TYPES:
        if value.casefold() == day_type.casefold():
            return day_type
    return None


def total_hours(time_in: float, time_out: float) -> float:
    return time_out - time_in


def effective_hours(time_in: float, time_out: float, additional: float = 0.0) -> float:
    if time_out > DINNER_AFTER:
        return (time_out - time_in) - 2 + additional
    if time_out > LUNCH_AFTER:
        return (time_out - time_in + additional) - 1
    return time_out - time_in + additional


def ot_hours(effective: float, day_type: CellValue) -> float | None:
    """effective minus the day type's threshold (may be <= 0; shown only when > 0).

    None for a day type that is not one of the four: the workbook's behaviour there is
    unverified, and H02 blocks writes to such a sheet anyway.
    """
    canonical = canonical_day_type(day_type)
    if canonical is None:
        return None
    return effective - OT_THRESHOLD[canonical]


def sum_hours(values: Iterable[CellValue]) -> float:
    """Excel SUM over a range: numbers count, text/booleans/blanks are ignored."""
    return sum(n for v in values if (n := as_number(v)) is not None)


def zidle_hours(effective: float, activity_hours: Iterable[CellValue]) -> float:
    """Unallocated hours (block row 6). Can go negative when activities exceed effective."""
    return effective - sum_hours(activity_hours)


def compute(
    time_in: float,
    time_out: float,
    additional: float = 0.0,
    day_type: CellValue = NORMAL_DAY,
    activity_hours: Iterable[CellValue] = (),
) -> Computed:
    effective = effective_hours(time_in, time_out, additional)
    allocated = sum_hours(activity_hours)
    return Computed(
        total=total_hours(time_in, time_out),
        effective=effective,
        ot_raw=ot_hours(effective, day_type),
        activity_hours=allocated,
        zidle=effective - allocated,
    )


def compute_entry(entry: Entry, day_type: CellValue) -> Computed | None:
    """Computed values for an entry read from a sheet; None unless In and Out are numbers."""
    time_in, time_out = as_number(entry.time_in), as_number(entry.time_out)
    if time_in is None or time_out is None:
        return None
    return compute(
        time_in,
        time_out,
        additional=as_number(entry.additional) or 0.0,
        day_type=day_type,
        activity_hours=[a.hours for a in entry.activities],
    )


# --- Roll-ups (read-only, display) -----------------------------------------------------------


def summary_day_count(effective: float, day_type: CellValue) -> float | None:
    """SUMMARY sheet day count for a worker-day that has an entry.

    Normal Day: 1 if effective > 5 else 0.5; Saturday: 1; Sunday/Holiday: 0.
    """
    canonical = canonical_day_type(day_type)
    if canonical is None:
        return None
    if canonical == NORMAL_DAY:
        return 1.0 if effective > 5 else 0.5
    if canonical == SATURDAY:
        return 1.0
    return 0.0


def bp_bill_counts_day(effective: float) -> bool:
    """BP Bill counts a day at effective >= 6."""
    return effective >= 6


# --- Grid -----------------------------------------------------------------------------------


def on_quarter_grid(value: float) -> bool:
    return abs(value * 4 - round(value * 4)) < EPS


def same_hours(a: float | None, b: float | None) -> bool:
    """Compare two hour values, treating None as 0 (a blank formula result)."""
    return abs((a or 0.0) - (b or 0.0)) < 1e-6
