"""Warnings that compare a new entry with other entries (PLAN.md §7): W02 rest between days and
W03 the same person booked twice with overlapping times.

Works on planned entries plus the day sheets around them. An entry being replaced counts with its
new values, and entries in the same batch see each other.
"""

from __future__ import annotations

from collections.abc import Mapping

from app.config import TemplateConfig
from app.domain.health import identities
from app.domain.models import DaySheet, MasterData, as_number
from app.domain.validators import MIN_REST, fmt_hours, fmt_time, make_issue
from app.domain.writes import EntryPlan

Shift = tuple[float, float]  # (In, Out)


def _shift(time_in, time_out) -> Shift | None:
    tin, tout = as_number(time_in), as_number(time_out)
    return (tin, tout) if tin is not None and tout is not None else None


def add_cross_entry_issues(
    plans: list[EntryPlan],
    days: Mapping[str, DaySheet],
    master: MasterData,
    template: TemplateConfig | None = None,
) -> None:
    """Append W02/W03 to each plan with a preview. ``days`` holds the planned sheets and, when
    they exist, the sheets before and after them."""
    t = template or TemplateConfig()
    by_row = {w.row: w for w in master.workers}

    # Every shift known per sheet: block -> (calling name, shift); batch entries override.
    shifts: dict[str, dict[int, tuple[str, Shift]]] = {}
    for sheet, day in days.items():
        shifts[sheet] = {
            e.block: (e.calling_name, s)
            for e in day.entries
            if e.calling_name and (s := _shift(e.time_in, e.time_out)) is not None
        }
    for p in plans:
        if p.block is None:
            continue
        sheet_shifts = shifts.setdefault(p.input.sheet, {})
        s = _shift(p.input.time_in, p.input.time_out)
        if s is None:
            sheet_shifts.pop(p.block, None)  # cleared or incomplete
        else:
            sheet_shifts[p.block] = (p.input.calling_name, s)

    for p in plans:
        if p.preview is None or p.block is None or not p.input.sheet.isdigit():
            continue
        sheet, name, n = p.input.sheet, p.input.calling_name, int(p.input.sheet)
        tin, tout = p.input.time_in, p.input.time_out
        cell_in = f"{t.cols.time_in}{p.row}"

        def issue(rule: str, message: str, sheet=sheet, name=name, cell_in=cell_in):
            return make_issue(rule, message, sheet=sheet, cell=cell_in, calling_name=name)

        # W02: rest after the previous day's shift and before the next day's.
        for other, before in ((str(n - 1), True), (str(n + 1), False)):
            mine = shifts.get(other, {}).get(p.block)
            if mine is None or mine[0] != name:
                continue
            o_in, o_out = mine[1]
            rest = (tin + 24 - o_out) if before else (o_in + 24 - tout)
            if rest < MIN_REST - 1e-9:
                when = (f"after day {other} (out {fmt_time(o_out)})" if before
                        else f"before day {other} (in {fmt_time(o_in)})")  # fmt: skip
                p.issues.append(issue("W02", f"Only {fmt_hours(rest)} h rest {when}."))

        # W03: same person (base code, employee code or ID) with overlapping times this day.
        me = identities(by_row.get(t.master_row_for_block(p.block)), name)
        for block, (other_name, (o_in, o_out)) in sorted(shifts.get(sheet, {}).items()):
            if block == p.block:
                continue
            them = identities(by_row.get(t.master_row_for_block(block)), other_name)
            if me & them and tin < o_out and o_in < tout:
                p.issues.append(
                    issue(
                        "W03",
                        f"Overlaps {other_name} {fmt_time(o_in)}-{fmt_time(o_out)} on this "
                        "sheet (same person).",
                    )
                )
