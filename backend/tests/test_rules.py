import pytest

from app.domain import rules
from tests.conftest import make_entry

# PLAN.md §5.5 rule test cases: (In, Out, Add, day type, effective, OT shown)
RULE_CASES = [
    (7, 19, 0, "Normal Day", 11, 3),
    (7, 12, 0, "Normal Day", 5, None),
    (18, 19, 0, "Normal Day", 0, None),
    (18, 23.5, 0, "Normal Day", 3.5, None),
    (7, 22, 0, "Normal Day", 14, 6),
    (7, 22, -1, "Normal Day", 13, 5),
    (7, 22.5, 0, "Normal Day", 13.5, 5.5),
    (7, 30, 0, "Normal Day", 21, 13),
    (7, 19, 0, "Saturday", 11, 5.5),
    (7, 19, 0, "Sunday", 11, 11),
    (7, 19, 0, "Holiday", 11, 11),
]


@pytest.mark.parametrize(("time_in", "time_out", "add", "day_type", "effective", "ot"), RULE_CASES)
def test_plan_rule_table(time_in, time_out, add, day_type, effective, ot):
    c = rules.compute(time_in, time_out, add, day_type)
    assert c.total == time_out - time_in
    assert c.effective == effective
    assert c.ot == ot


def test_lunch_deducted_even_when_shift_starts_after_noon():
    assert rules.effective_hours(13, 17) == 3


def test_out_exactly_22_deducts_lunch_only():
    assert rules.effective_hours(7, 22) == 14
    assert rules.effective_hours(7, 22.25) == 13.25


def test_out_exactly_12_deducts_nothing():
    assert rules.effective_hours(7, 12) == 5
    assert rules.effective_hours(7, 12.25) == 4.25


def test_additional_is_added_before_deductions_like_excel():
    assert rules.effective_hours(7, 23, 1) == 15
    assert rules.effective_hours(7, 19, 7) == 18
    assert rules.effective_hours(7, 11, 1) == 5


def test_ot_raw_kept_when_not_shown():
    c = rules.compute(7, 12, day_type="Normal Day")
    assert c.ot_raw == -3
    assert c.ot is None


def test_zidle_partial_full_and_negative():
    assert rules.zidle_hours(11, [6, 3]) == 2
    assert rules.zidle_hours(11, [11]) == 0
    assert rules.zidle_hours(13, [13, 8]) == -8  # INB-31 day 19 pattern


def test_activity_sum_ignores_text_like_excel_sum():
    assert rules.sum_hours([5, "13`", None, True, 2.5]) == 7.5


def test_day_type_matches_case_insensitive_but_not_trimmed():
    assert rules.canonical_day_type("normal day") == "Normal Day"
    assert rules.canonical_day_type("SATURDAY") == "Saturday"
    assert rules.canonical_day_type("Normal Day ") is None
    assert rules.canonical_day_type(None) is None


def test_unknown_day_type_gives_no_ot():
    c = rules.compute(7, 19, day_type="Workday")
    assert c.ot_raw is None
    assert c.ot is None


def test_compute_entry_uses_rows_1_to_5_and_additional():
    e = make_entry("1", 0, "INB-01", 7.0, 22.0, [("A", 6.0), ("B", 5.0)], additional=-1.0)
    c = rules.compute_entry(e, "Normal Day")
    assert (c.effective, c.ot, c.activity_hours, c.zidle) == (13, 5, 11, 2)


def test_compute_entry_blank_additional_is_zero():
    e = make_entry("1", 0, "INB-01", 7.0, 19.0, [("A", 11.0)])
    assert rules.compute_entry(e, "Saturday").ot == 5.5


@pytest.mark.parametrize(("time_in", "time_out"), [(None, 19.0), (7.0, None), ("7", 19.0)])
def test_compute_entry_incomplete(time_in, time_out):
    e = make_entry("1", 0, "INB-01", time_in, time_out)
    assert rules.compute_entry(e, "Normal Day") is None


@pytest.mark.parametrize(
    ("effective", "day_type", "count"),
    [
        (11, "Normal Day", 1),
        (5.25, "Normal Day", 1),
        (5, "Normal Day", 0.5),
        (3, "Saturday", 1),
        (11, "Sunday", 0),
        (11, "Holiday", 0),
        (11, "?", None),
    ],
)
def test_summary_day_count(effective, day_type, count):
    assert rules.summary_day_count(effective, day_type) == count


def test_bp_bill_day():
    assert rules.bp_bill_counts_day(6)
    assert not rules.bp_bill_counts_day(5.75)


@pytest.mark.parametrize(("value", "ok"), [(7, True), (7.25, True), (22.75, True), (7.1, False)])
def test_quarter_grid(value, ok):
    assert rules.on_quarter_grid(value) is ok


def test_same_hours_treats_blank_as_zero():
    assert rules.same_hours(None, 0.0)
    assert rules.same_hours(3.0, 3.0000000001)
    assert not rules.same_hours(3.0, 3.25)
