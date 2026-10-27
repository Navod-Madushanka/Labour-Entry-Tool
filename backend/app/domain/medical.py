"""Medical leave (office practice): the worker gets a medical line ``<base> M`` (e.g. ``INC-08 M``)
with N working days, Sundays skipped, each In 7, Out 16 on the medical activity code.

Pure date planning; the service adds the Labour Detail row and writes the entries.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Collection

from pydantic import BaseModel, Field

from app.domain.codes import parse_calling_name

MEDICAL_ROLE = "M"
DEFAULT_DAYS = 10
DEFAULT_IN, DEFAULT_OUT = 7.0, 16.0
DEFAULT_ACTIVITY = "00-00-10-00"


class MedicalDay(BaseModel):
    date: dt.date
    sheet: str | None  # None when the date is not in this workbook's month


class MedicalDates(BaseModel):
    days: list[MedicalDay] = Field(default_factory=list)  # in this month
    later: list[dt.date] = Field(default_factory=list)  # for next month's workbook
    skipped: list[tuple[dt.date, str]] = Field(default_factory=list)  # (date, why)


def medical_name(base: str) -> str | None:
    """'INC-08' -> 'INC-08 M'; None for a calling name that already has a role suffix."""
    parsed = parse_calling_name(base)
    if parsed is None or parsed.role:
        return None
    return f"{parsed.base} {MEDICAL_ROLE}"


def medical_dates(
    start: dt.date,
    count: int,
    month_start: dt.date,
    holidays: Collection[dt.date] = (),
    skip_holidays: bool = False,
) -> MedicalDates:
    """``count`` working days from ``start``: Sundays never count; holidays only when asked."""
    out = MedicalDates()
    day = start
    while len(out.days) + len(out.later) < count:
        if day.weekday() == 6:
            out.skipped.append((day, "Sunday"))
        elif skip_holidays and day in holidays:
            out.skipped.append((day, "holiday"))
        elif (day.year, day.month) == (month_start.year, month_start.month):
            out.days.append(MedicalDay(date=day, sheet=str(day.day)))
        elif day > month_start:
            out.later.append(day)
        day += dt.timedelta(days=1)
    return out
