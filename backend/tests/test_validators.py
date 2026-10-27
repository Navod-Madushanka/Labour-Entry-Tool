"""Entry and header checks (PLAN.md §7)."""

import datetime as dt

import pytest

from app.domain.models import DayHeader
from app.domain.validators import RULES, calendar_day_type, check_entry, check_header, fmt_time
from tests.conftest import make_entry

CODES = {"03-11-00-00", "03-11-00-00-P"}
OCT = dt.date(2026, 10, 1)


def rules_of(issues):
    return sorted(i.rule for i in issues)


def check(*args, day_type="Normal Day", **kw):
    return check_entry(make_entry("1", 0, "INB-01", *args, **kw), day_type, CODES)


def test_clean_entry_has_no_issues():
    assert check(7.0, 19.0, [("03-11-00-00", 11.0)]) == []


def test_issue_fields_point_at_the_cell():
    [issue] = check(None, 19.0, [("03-11-00-00", 11.0)])
    assert (issue.rule, issue.severity, issue.sheet, issue.cell, issue.calling_name) == (
        "E01", "BLOCK", "1", "G9", "INB-01",
    )  # fmt: skip


@pytest.mark.parametrize(
    ("time_in", "time_out", "expected"),
    [
        (7.0, None, ["E01"]),
        ("7", 19.0, ["E03"]),
        (19.0, 7.0, ["E02", "W06"]),
        (7.0, 31.5, ["E02", "W01", "W08"]),  # no activities: all effective hours go to ZIDLE
        (7.1, 19.0, ["E03", "W08"]),
    ],
)
def test_time_checks(time_in, time_out, expected):
    assert rules_of(check(time_in, time_out, remark="x")) == expected


@pytest.mark.parametrize(
    ("activities", "expected"),
    [
        ([("03-11-00-00", "13`")], ["E03"]),  # INC-74 day 15
        ([("03-11-00-00", None)], ["E03", "W08"]),  # INB-17 day 15
        ([("03-11-00-00", 0.1)], ["E03", "W08"]),
        ([("03-11-00-00", -1.0)], ["E03", "W08"]),
        ([(None, 11.0)], ["E04"]),
        ([("99-99-99-99", 11.0)], ["E04"]),
        ([(" 03-11-00-00 ", 11.0)], ["M06"]),  # INC-41 day 16
        ([("03-11-00-00", 13.0), ("03-11-00-00-P", 8.0)], ["E05"]),  # INB-31 day 19
        ([("03-11-00-00", 6.0)], ["W08"]),
    ],
)
def test_activity_checks(activities, expected):
    assert rules_of(check(7.0, 19.0, activities)) == expected


def test_text_hours_message_says_zidle_disappears():
    [issue] = check(7.0, 21.0, [("03-11-00-00", "13`")])
    assert "ZIDLE line disappears" in issue.message


def test_more_than_five_lines():
    e = make_entry("1", 0, "INB-01", 7.0, 19.0, [("03-11-00-00", 1.0)] * 5)
    e.activities.append(e.activities[0].model_copy(update={"row": 14}))
    assert "E06" in rules_of(check_entry(e, "Normal Day", CODES))


def test_warnings():
    assert rules_of(check(7.0, 27.0, [("03-11-00-00", 18.0)])) == ["W01"]
    assert rules_of(check(7.0, 21.0, [("03-11-00-00", 14.0)], additional=1.0)) == ["W04"]
    assert check(7.0, 21.0, [("03-11-00-00", 14.0)], additional=1.0, remark="late") == []
    assert rules_of(check(7.0, 22.0, [("03-11-00-00", 14.0)])) == ["W05"]
    # Staff enter -1 on 7->22 shifts; that is the usual fix, so no W05 (W04 still wants a remark).
    assert rules_of(check(7.0, 22.0, [("03-11-00-00", 13.0)], additional=-1.0)) == ["W04"]
    assert rules_of(check(12.0, 19.0, [("03-11-00-00", 6.0)])) == ["W06"]


def test_e05_mentions_negative_zidle():
    [issue] = check(7.0, 22.0, [("03-11-00-00", 21.0)], additional=-1.0, remark="x")
    assert issue.rule == "E05" and "ZIDLE -8" in issue.message


def test_every_rule_used_is_catalogued():
    assert {"E01", "E05", "W08", "H01", "M06"} <= set(RULES)


def test_fmt_time():
    assert fmt_time(7.5) == "07:30"
    assert fmt_time(30) == "06:00 (+1 day)"
    assert fmt_time(24) == "00:00 (+1 day)"


# --- Headers --------------------------------------------------------------------------------


def header(sheet, date, day_type, sheet_no=None):
    return DayHeader(sheet=sheet, date=date, day_type=day_type, sheet_no=sheet_no or float(sheet))


def test_calendar_day_type():
    assert calendar_day_type(dt.date(2026, 10, 3), []) == "Saturday"
    assert calendar_day_type(dt.date(2026, 10, 4), []) == "Sunday"
    assert calendar_day_type(dt.date(2026, 10, 5), []) == "Normal Day"
    assert calendar_day_type(dt.date(2026, 10, 5), [dt.date(2026, 10, 5)]) == "Holiday"


def test_correct_header_passes():
    assert check_header(header("1", dt.date(2026, 10, 1), "Normal Day"), OCT) == []
    assert check_header(header("4", dt.date(2026, 10, 4), "sunday"), OCT) == []  # like Excel's =


def test_header_problems():
    # Sheet 16 dated the 15th (INDIAN); sheet 4 Saturday on a Sunday; sheet 31 F4 = 30.
    assert rules_of(check_header(header("16", dt.date(2026, 10, 15), "Normal Day"), OCT)) == ["H01"]
    assert rules_of(check_header(header("4", dt.date(2026, 10, 4), "Saturday"), OCT)) == ["H02"]
    issues = check_header(header("31", dt.date(2026, 10, 31), "Normal Day", 30.0), OCT)
    assert rules_of(issues) == ["H02", "H03"]
    assert issues[0].suggestion == "Set H3 to Saturday."


def test_holidays_are_editable():
    sheet25 = header("25", dt.date(2026, 10, 25), "Holiday")
    assert check_header(sheet25, OCT, [dt.date(2026, 10, 25)]) == []
    [issue] = check_header(sheet25, OCT, [])
    assert issue.rule == "H02" and "holiday list" in issue.message
    assert "config.yaml" in issue.suggestion
    # A listed holiday must say Holiday.
    [issue] = check_header(
        header("5", dt.date(2026, 10, 5), "Normal Day"), OCT, [dt.date(2026, 10, 5)]
    )
    assert issue.suggestion == "Set H3 to Holiday."


def test_blank_header_and_short_month():
    issues = check_header(DayHeader(sheet="2"), OCT)
    assert rules_of(issues) == ["H01", "H02", "H03"]
    assert check_header(DayHeader(sheet="31"), dt.date(2026, 11, 1)) == []  # no 31 Nov
