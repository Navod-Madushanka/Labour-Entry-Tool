"""Place suffixes in activity codes.

An activity code is a MasterFormat-style work code of four 2-digit pairs, sometimes followed by a
suffix for where on site the work is done: ``03-11-00-00-P`` is formwork at the place "P". What
each suffix means is project-specific (one project's "P" is the parking area), so nothing here
knows any suffix: they are read from the workbook's activity list, and the office names them once
on the start page (stored per project, app/books.py).
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable

from pydantic import BaseModel

from app.domain.codes import normalise_activity
from app.domain.models import DaySheet

PAIR = re.compile(r"\d\d")
# The place key of codes with no ending (03-11-00-00): no ending is not "no place", it is the
# project's own (often the main building); the office names it like any ending. "_" can never be
# a real ending (those are letters and numbers).
NO_ENDING = "_"


def place_suffix(code: object) -> str | None:
    """``03-11-00-00-C-8`` -> ``C-8``; ``03-44-13-15-05-A`` -> ``A`` (extra number pairs are
    finer detail, not a place); None for a code without one."""
    text = normalise_activity(code) if isinstance(code, str) else None
    if not text:  # not text, or only spaces (a blank cell in the activity list)
        return None
    parts = text.split("-")
    if len(parts) < 5 or not all(PAIR.fullmatch(p) for p in parts[:4]):
        return None
    rest = parts[4:]
    while rest and rest[0].isdigit():
        rest = rest[1:]
    return "-".join(rest) or None


def place_key(code: object) -> str | None:
    """The key a code's place is named under: its ending, ``NO_ENDING`` for a work code with none
    (``03-11-00-00``), None for something that is not a work code."""
    if (suffix := place_suffix(code)) is not None:
        return suffix
    text = normalise_activity(code) if isinstance(code, str) else None
    if not text:
        return None
    parts = text.split("-")
    return NO_ENDING if len(parts) >= 4 and all(PAIR.fullmatch(p) for p in parts[:4]) else None


def work_part(code: str) -> str:
    """The code without its place: ``03-11-00-00-C-8`` -> ``03-11-00-00``."""
    suffix = place_suffix(code)
    text = normalise_activity(code) or ""
    return text[: -len(suffix) - 1] if suffix else text


class Place(BaseModel):
    suffix: str  # the ending, or NO_ENDING for codes with none
    name: str = ""  # what the office called it ("" = not named)
    codes: int  # activity-list codes with this suffix
    used: int = 0  # entry lines this month with it
    example: str  # one code with it


def find_places(
    activities: Iterable[str], days: Iterable[DaySheet], names: dict[str, str]
) -> list[Place]:
    """Every suffix in the activity list, the most used first."""
    codes: dict[str, list[str]] = {}
    for code in activities:
        if key := place_key(code):
            codes.setdefault(key, []).append(code)
    used = Counter(
        place_key(line.code) for day in days for e in day.entries for line in e.activity_lines
    )
    places = [
        Place(suffix=s, name=names.get(s, ""), codes=len(c), used=used[s], example=c[0])
        for s, c in codes.items()
    ]
    # endings named by hand that no code in the list has yet (added ahead of new codes)
    places += [
        Place(suffix=s, name=n, codes=0, used=used[s],
              example="03-11-00-00" if s == NO_ENDING else f"03-11-00-00-{s}")
        for s, n in names.items()
        if s not in codes and n
    ]
    return sorted(places, key=lambda p: (-p.used, -p.codes, p.suffix))
