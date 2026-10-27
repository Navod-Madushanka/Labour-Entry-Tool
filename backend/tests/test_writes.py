"""Write planning and the write-time checks E07-E09 (PLAN.md §5.4, §7, §8)."""

import datetime as dt

import pytest

from app.config import TemplateConfig
from app.domain.writes import (
    ActivityInput,
    EntryInput,
    RangeWrite,
    plan_entry,
    same_value,
    unwritable_cells,
    writable_cell,
)

T = TemplateConfig()
OCT = dt.date(2026, 10, 1)
CODES = {"03-11-00-00", "03-11-00-00-P", "03-20-00-00-C-8"}


def entry(name="INB-01 CH", **kw):
    base = dict(sheet="1", calling_name=name, time_in=7.0, time_out=19.0,
                activities=[ActivityInput(code="03-11-00-00", hours=11.0)])  # fmt: skip
    return EntryInput(**{**base, **kw})


def plan(small_snapshot, e):
    return plan_entry(e, small_snapshot.days[0], CODES, OCT, template=T)


def rules_of(p):
    return sorted(i.rule for i in p.issues)


@pytest.mark.parametrize(
    ("cell", "ok"),
    [
        ("G9", True), ("H9", True), ("J9", True), ("K9", True), ("L9", True), ("R9", True),
        ("J13", True), ("K13", True),  # block rows 2-5: activities only
        ("G10", False), ("L10", False), ("R10", False),  # ignored by the formulas
        ("J14", False), ("K15", False),  # ZIDLE / OT rows are locked
        ("I9", False), ("E9", False), ("A9", False), ("M9", False), ("Q15", False),
        ("F3", False), ("H3", False), ("G8", False), ("G3509", False),
        ("G3502", True), ("K3506", True), ("K3507", False),  # last block
    ],
)  # fmt: skip
def test_writable_cells(cell, ok):
    assert writable_cell(T, cell) is ok


def test_unwritable_cells_listed():
    writes = [RangeWrite(sheet="1", address="H9:I9", values=[[19.0, "x"]])]
    assert unwritable_cells(writes, T) == ["1!I9"]


def test_plan_for_empty_block(small_snapshot):
    p = plan(small_snapshot, entry())
    assert p.ok and p.issues == []
    assert (p.block, p.row) == (1, 16)
    assert [(w.address, w.values) for w in p.writes] == [
        ("G16:H16", [[7.0, 19.0]]),
        ("J16:K20", [["03-11-00-00", 11.0], [None, None], [None, None], [None, None],
                     [None, None]]),
        ("L16", [[None]]),
        ("R16", [[None]]),
    ]  # fmt: skip
    assert p.preview.effective == 11 and p.preview.ot == 3
    assert p.changes == {"G16": (None, 7.0), "H16": (None, 19.0), "J16": (None, "03-11-00-00"),
                         "K16": (None, 11.0)}  # fmt: skip


def test_codes_written_trimmed(small_snapshot):
    p = plan(small_snapshot, entry(activities=[ActivityInput(code=" 03-11-00-00 ", hours=11.0)]))
    assert p.writes[1].values[0] == ["03-11-00-00", 11.0]
    assert "M06" in rules_of(p)  # still reported: the user typed spaces


def test_e07_calling_name_must_be_on_the_sheet(small_snapshot):
    p = plan(small_snapshot, entry(name="INB-99"))
    assert rules_of(p) == ["E07"] and p.writes == [] and not p.ok
    day = small_snapshot.days[0]
    day.block_names[3] = "INB-01 CH"  # stale or duplicated map
    assert "is in 2 blocks" in plan(small_snapshot, entry()).issues[0].message


def test_e08_overwrite_needs_confirmation(small_snapshot):
    p = plan(small_snapshot, entry(name="INB-01"))
    assert rules_of(p) == ["E08"]
    assert "G9=7.0" in p.issues[0].message and "J9='03-11-00-00'" in p.issues[0].message
    acts = [ActivityInput(code="03-11-00-00", hours=13.0)]
    p = plan(small_snapshot, entry(name="INB-01", overwrite=True, time_out=21.0, activities=acts))
    assert p.ok
    assert p.changes == {"H9": (19.0, 21.0), "K9": (11.0, 13.0)}


def test_clear_block(small_snapshot):
    clear = EntryInput(sheet="1", calling_name="INC-02", overwrite=True)
    p = plan(small_snapshot, clear)
    assert clear.is_clear and p.ok and p.preview is None
    assert p.changes == {
        "G23": (7.0, None), "H23": (22.0, None), "J23": ("03-11-00-00-P", None),
        "K23": (13.0, None), "L23": (-1.0, None), "R23": ("dinner", None),
    }  # fmt: skip


def test_blocks_and_warnings(small_snapshot):
    p = plan(small_snapshot, entry(time_in=None))
    assert rules_of(p) == ["E01"] and p.blocking and not p.ok
    p = plan(small_snapshot, entry(activities=[ActivityInput(code="99-99-99-99", hours=11.0)]))
    assert rules_of(p) == ["E04"]
    p = plan(
        small_snapshot,
        entry(time_out=22.0, activities=[ActivityInput(code="03-11-00-00", hours=14.0)]),
    )
    assert rules_of(p) == ["W05"] and not p.blocking and not p.ok
    p.input.acknowledged.append("W05")
    assert p.ok


def test_six_activities_blocked(small_snapshot):
    acts = [ActivityInput(code="03-11-00-00", hours=1.0)] * 6
    assert "E06" in rules_of(plan(small_snapshot, entry(activities=acts)))


def test_header_problems_need_acknowledgement(small_snapshot):
    day = small_snapshot.days[0]
    day.header.day_type = "Saturday"  # 1 Oct 2026 is a Thursday
    p = plan(small_snapshot, entry())
    assert rules_of(p) == ["H02"] and not p.ok
    p.input.acknowledged.append("H02")
    assert p.ok
    p.input.acknowledged = ["E04"]  # other BLOCK rules cannot be acknowledged
    assert not p.ok


def test_same_value():
    assert same_value(None, "") and same_value(7, 7.0) and not same_value(7.0, "7")
    assert not same_value(0, None) and not same_value(True, 1.0)
