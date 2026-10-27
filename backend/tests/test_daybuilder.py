"""Day builder: crews carried from the previous days, attendance defaults, Sunday shift."""

import datetime as dt

from app.domain.daybuilder import build_day, typical_shift
from app.domain.models import DayHeader, DaySheet
from tests.conftest import FIXTURES, make_entry

NAMES = ["A-01", "A-02", "A-03", "A-04", "A-05", "A-06"]


def day(n, entries, day_type=None):
    date = dt.date(2026, 10, n)
    day_type = day_type or {5: "Saturday", 6: "Sunday"}.get(date.weekday(), "Normal Day")
    header = DayHeader(sheet=str(n), date=date, day_type=day_type, sheet_no=float(n))
    return DaySheet(header=header, block_names=NAMES, entries=entries)


def e(n, block, tin, tout, code="03-11-00-00", hours=None):
    return make_entry(str(n), block, NAMES[block], tin, tout, [(code, hours)])


def test_crews_from_yesterday_and_ticks():
    days = {
        "6": day(6, [e(6, 4, 7.0, 21.0)]),  # A-05: 3 days back -> unticked
        "7": day(7, [e(7, 2, 7.0, 19.0, "X")]),  # A-03: 2 days back -> ticked
        "8": day(8, [e(8, 0, 7.0, 21.0), e(8, 1, 7.0, 21.0), e(8, 3, 7.0, 16.0)]),
    }
    b = build_day(day(9, [e(9, 3, 7.0, 21.0)]), days)  # A-04 already entered on 9
    shifts = [(c.time_in, c.time_out, [a.code for a in c.activities]) for c in b.crews]
    assert shifts == [(7.0, 21.0, ["03-11-00-00"]), (7.0, 19.0, ["X"])]
    members = [[(m.calling_name, m.ticked, m.from_sheet) for m in c.members] for c in b.crews]
    assert members == [[("A-01", True, "8"), ("A-02", True, "8"), ("A-05", False, "6")],
                       [("A-03", True, "7")]]  # fmt: skip
    assert (b.candidates, b.ticked, b.already_entered) == (4, 3, 1)
    assert b.crews[0].activities[0].hours is None  # hours follow In/Out


def test_multi_activity_hours_are_kept():
    two = make_entry("8", 0, "A-01", 7.0, 19.0, [("P", 6.0), ("Q", 5.0)])
    b = build_day(day(9, []), {"8": day(8, [two])})
    assert [(a.code, a.hours) for a in b.crews[0].activities] == [("P", 6.0), ("Q", 5.0)]


def test_unusable_entries_are_not_carried():
    bad = [make_entry("8", 0, "A-01", None, 19.0, [("P", 11.0)]),  # no In
           make_entry("8", 1, "A-02", 7.0, 19.0, [("P", "13`")]),  # text hours in a 2-line
           make_entry("8", 2, "A-03", 7.0, 19.0)]  # no activity  # fmt: skip
    bad[1].activities[1].code, bad[1].activities[1].hours = "Q", 1.0
    assert build_day(day(9, []), {"8": day(8, bad)}).crews == []


def test_sunday_uses_previous_sunday_and_its_shift():
    days = {
        "3": day(3, [e(3, 0, 7.0, 21.0), e(3, 1, 7.0, 21.0)]),  # Saturday 3 Oct
        "4": day(4, [e(4, 1, 7.0, 16.0), e(4, 2, 7.0, 16.0)]),  # Sunday 4 Oct
        "10": day(10, [e(10, 0, 7.0, 21.0), e(10, 1, 7.0, 21.0), e(10, 3, 7.0, 19.0)]),
    }
    b = build_day(day(11, []), days)  # Sunday 11 Oct
    assert b.sunday_shift == (7.0, 16.0)
    ticked = {m.calling_name: m.ticked for c in b.crews for m in c.members}
    assert ticked == {"A-01": False, "A-02": True, "A-03": True, "A-04": False}
    assert {(c.time_in, c.time_out) for c in b.crews} == {(7.0, 16.0)}
    assert typical_shift(days, "Saturday") == (7.0, 21.0)  # 3 and 10 Oct are Saturdays
    assert typical_shift(days, "Normal Day") is None


def test_only_workers_on_the_target_sheet():
    target = day(9, [])
    target.block_names = ["A-01"]
    b = build_day(target, {"8": day(8, [e(8, 0, 7.0, 21.0), e(8, 1, 7.0, 21.0)])})
    assert [m.calling_name for c in b.crews for m in c.members] == ["A-01"]


# --- golden: replay October (anonymised snapshot or real workbook) ------------------------------


def test_replay_october():
    import pytest

    json = sorted((FIXTURES / "sanitized").glob("*indian*.json"))
    xlsb = sorted((FIXTURES / "private").glob("*INDIAN*.xlsb"))
    if json:
        from app.excel.fake_adapter import load_snapshot

        snap = load_snapshot(json[0])
    elif xlsb:
        from app.excel.xlsb_reader import XlsbReader

        with XlsbReader(xlsb[0]) as r:
            snap = r.snapshot()
    else:
        pytest.skip("no INDIAN snapshot")
    days = {d.header.sheet: d for d in snap.days}
    proposed = came = right_ticks = all_ticks = 0
    for n in range(2, 25):
        target = days[str(n)].model_copy(deep=True)
        real = {x.calling_name for x in target.entries}
        target.entries = []
        b = build_day(target, days)
        names = {m.calling_name: m.ticked for c in b.crews for m in c.members}
        proposed += len(real & set(names))
        came += len(real)
        right_ticks += sum(t == (m in real) for m, t in names.items())
        all_ticks += len(names)
    assert proposed / came > 0.97  # 98%: almost nobody to type from scratch
    assert right_ticks / all_ticks > 0.75  # 78% of attendance ticks right by default
