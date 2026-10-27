"""W02 / W03 for new entries (PLAN.md §7)."""

import datetime as dt

from app.domain.crosscheck import add_cross_entry_issues
from app.domain.models import DayHeader, DaySheet
from app.domain.writes import ActivityInput, EntryInput, plan_entry
from tests.conftest import make_entry

OCT = dt.date(2026, 10, 1)
CODES = {"03-11-00-00"}
NAMES = ["INB-01", "INB-01 CH", "INC-02", "INH-03"]


def day(n, entries=()):
    header = DayHeader(sheet=str(n), date=dt.date(2026, 10, n), day_type="Normal Day",
                       sheet_no=float(n))  # fmt: skip
    return DaySheet(header=header, block_names=NAMES, entries=list(entries))


def plan(days, n, name, tin, tout, hours=None, **kw):
    e = EntryInput(sheet=str(n), calling_name=name, time_in=tin, time_out=tout, overwrite=True,
                   activities=[ActivityInput(code="03-11-00-00", hours=hours)] if hours else [],
                   **kw)  # fmt: skip
    return plan_entry(e, days[str(n)], CODES, OCT)


def rules_of(p):
    return [i.rule for i in p.issues if i.rule in ("W02", "W03")]


def test_rest_before_and_after(small_snapshot):
    master = small_snapshot.master
    days = {"1": day(1, [make_entry("1", 2, "INC-02", 7.0, 27.0)]),  # out 03:00 on the 2nd
            "2": day(2), "3": day(3, [make_entry("3", 2, "INC-02", 7.0, 19.0)])}  # fmt: skip
    p = plan(days, 2, "INC-02", 7.0, 26.0)  # in 07:00 (4 h after 03:00), out 02:00 (5 h before)
    add_cross_entry_issues([p], days, master)
    msgs = [i.message for i in p.issues if i.rule == "W02"]
    assert msgs == ["Only 4 h rest after day 1 (out 03:00 (+1 day)).",
                    "Only 5 h rest before day 3 (in 07:00)."]  # fmt: skip
    p = plan(days, 2, "INC-02", 11.0, 19.0)
    add_cross_entry_issues([p], days, master)
    assert rules_of(p) == []  # 8 h rest exactly is fine


def test_batch_entries_see_each_other(small_snapshot):
    days = {"1": day(1), "2": day(2)}
    p1 = plan(days, 1, "INC-02", 7.0, 28.0)
    p2 = plan(days, 2, "INC-02", 7.0, 19.0)
    add_cross_entry_issues([p1, p2], days, small_snapshot.master)
    assert rules_of(p1) == ["W02"] and rules_of(p2) == ["W02"]


def test_overlap_same_person(small_snapshot):
    master = small_snapshot.master  # INB-01, INB-01 CH and INH-03 share an ID
    days = {"1": day(1, [make_entry("1", 0, "INB-01", 7.0, 15.0)])}
    p = plan(days, 1, "INB-01 CH", 14.0, 19.0)
    add_cross_entry_issues([p], days, master)
    [w03] = [i for i in p.issues if i.rule == "W03"]
    assert w03.message == "Overlaps INB-01 07:00-15:00 on this sheet (same person)."
    p = plan(days, 1, "INB-01 CH", 15.0, 19.0)  # back to back
    add_cross_entry_issues([p], days, master)
    assert rules_of(p) == []
    p = plan(days, 1, "INC-02", 7.0, 19.0)  # different person
    add_cross_entry_issues([p], days, master)
    assert rules_of(p) == []


def test_replaced_entry_uses_new_times(small_snapshot):
    days = {"1": day(1, [make_entry("1", 0, "INB-01", 7.0, 19.0)])}
    moved = plan(days, 1, "INB-01", 7.0, 12.0)  # INB-01 shortened in the same batch
    other = plan(days, 1, "INB-01 CH", 13.0, 19.0)
    add_cross_entry_issues([moved, other], days, small_snapshot.master)
    assert rules_of(other) == []
