"""Day builder: start a day sheet from the previous days (patterns in the October INDIAN data).

- 84% of a day's workers also worked the day before; 82% of entries are identical to at least 5
  others that day (crews), and a crew mostly changes together (Out and/or activity, almost
  never In). So: carry each worker's last entry forward (up to ``window`` days back), group
  identical ones into crews, and let the user edit a crew once and untick absentees.
- Attendance defaults: worked 1-2 days ago -> ticked (85% / 64% came back); 3 days -> unticked
  (55%). Sundays: the previous Sunday's workers are ticked (only 55% of Saturday's come), with
  the shift most used on Sundays (07:00-16:00 in October).
- Hours: 100% of entries book all effective hours, so single-activity crews leave hours to be
  computed from In/Out.

Pure: works on day sheets the service passes in.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping

from pydantic import BaseModel, Field

from app.domain import rules
from app.domain.codes import normalise_activity
from app.domain.models import DaySheet, Entry, as_number

DEFAULT_WINDOW = 3
TICK_GAP = 2  # last worked this many days ago or less: ticked by default


class CrewActivity(BaseModel):
    code: str
    hours: float | None = None  # None: all effective hours (single-activity crews)


class CrewMember(BaseModel):
    calling_name: str
    from_sheet: str  # where the carried entry comes from
    ticked: bool


class Crew(BaseModel):
    time_in: float
    time_out: float
    activities: list[CrewActivity]
    members: list[CrewMember]


class DayBuild(BaseModel):
    sheet: str
    day_type: str | None
    window: int
    sunday_shift: tuple[float, float] | None = None  # applied to every crew on a Sunday
    crews: list[Crew] = Field(default_factory=list)
    already_entered: int = 0
    candidates: int = 0
    ticked: int = 0


def _shift(e: Entry) -> tuple[float, float] | None:
    tin, tout = as_number(e.time_in), as_number(e.time_out)
    return (tin, tout) if tin is not None and tout is not None else None


def _activities(e: Entry) -> list[CrewActivity] | None:
    lines = [a for a in e.activities if normalise_activity(a.code)]
    if not lines:
        return None
    if len(lines) == 1:
        return [CrewActivity(code=normalise_activity(lines[0].code))]
    acts = []
    for a in lines:
        hours = as_number(a.hours)
        if hours is None:
            return None  # text hours etc.: not something to copy
        acts.append(CrewActivity(code=normalise_activity(a.code), hours=hours))
    return acts


def typical_shift(days: Mapping[str, DaySheet], day_type: str) -> tuple[float, float] | None:
    """The (In, Out) most used on days of this type among the given sheets."""
    counts: Counter[tuple[float, float]] = Counter()
    for day in days.values():
        if rules.canonical_day_type(day.header.day_type) == day_type:
            counts.update(s for e in day.entries if (s := _shift(e)) is not None)
    return counts.most_common(1)[0][0] if counts else None


def build_day(
    target: DaySheet, days: Mapping[str, DaySheet], window: int = DEFAULT_WINDOW
) -> DayBuild:
    """Crews for ``target`` from the sheets before it. ``days``: sheet name -> day sheet; it should
    hold at least the ``window`` sheets before the target and, for a Sunday, the one 7 back."""
    sheet = target.header.sheet
    n = int(sheet)
    day_type = rules.canonical_day_type(target.header.day_type)
    sunday = day_type == rules.SUNDAY
    out = DayBuild(sheet=sheet, day_type=day_type, window=window)
    entered = {e.calling_name for e in target.entries}
    out.already_entered = len(entered)
    on_target = set(target.block_names) - {None}

    # Each worker's most recent usable entry within the window.
    last: dict[str, tuple[int, Entry]] = {}
    for gap in range(window, 0, -1):  # oldest first, so newer entries overwrite
        day = days.get(str(n - gap))
        for e in day.entries if day else []:
            if e.calling_name and _shift(e) and _activities(e):
                last[e.calling_name] = (gap, e)
    previous_sunday = days.get(str(n - 7)) if sunday else None
    sunday_names = {e.calling_name for e in previous_sunday.entries} if previous_sunday else set()
    if sunday:
        out.sunday_shift = typical_shift(days, rules.SUNDAY)
        for e in previous_sunday.entries if previous_sunday else []:
            if e.calling_name and e.calling_name not in last and _shift(e) and _activities(e):
                last[e.calling_name] = (7, e)

    groups: dict[tuple, list[CrewMember]] = defaultdict(list)
    shape: dict[tuple, tuple[tuple[float, float], list[CrewActivity]]] = {}
    for name, (gap, e) in last.items():
        if name in entered or name not in on_target:
            continue
        shift = out.sunday_shift if sunday and out.sunday_shift else _shift(e)
        acts = _activities(e)
        ticked = name in sunday_names if sunday else gap <= TICK_GAP
        key = (shift, tuple((a.code, a.hours) for a in acts))
        groups[key].append(CrewMember(calling_name=name, from_sheet=str(n - gap), ticked=ticked))
        shape[key] = (shift, acts)
    order = {name: i for i, name in enumerate(target.block_names) if name}
    for key, members in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        (tin, tout), acts = shape[key]
        members.sort(key=lambda m: order.get(m.calling_name, 10**6))
        out.crews.append(Crew(time_in=tin, time_out=tout, activities=acts, members=members))
    out.candidates = sum(len(c.members) for c in out.crews)
    out.ticked = sum(m.ticked for c in out.crews for m in c.members)
    return out
