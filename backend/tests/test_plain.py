"""Problems in plain words for Excel users (app/domain/plain.py)."""

import pytest

from app.domain.models import Issue
from app.domain.plain import explain
from app.domain.validators import RULES, make_issue

JARGON = ("ZIDLE", "ERP", "effective", "block", "E0", "W0", "H0", "M0")


def issue(rule, message, **kw):
    return make_issue(rule, message, **kw)


@pytest.mark.parametrize(
    ("rule", "message", "kw", "title", "bits"),
    [
        ("E01", "In is blank but the block has other input.",
         {"sheet": "7", "cell": "G240", "calling_name": "INB-33"},
         "Time In is empty", ["Sheet 7, row 240, Time In column (cell G240), worker INB-33"]),
        ("E03", "Hours typed as text ('13`'). Excel cannot add it, so the day's ZIDLE line "
         "disappears.", {"sheet": "15", "cell": "K1129"}, "Hours typed wrongly", ["“13`”"]),
        ("E05", "Activities total 21 h but effective is 13 h: Excel books ZIDLE -8 h.",
         {"sheet": "19", "cell": "K226"}, "More activity hours than hours worked",
         ["add up to 21 h", "only give 13 h"]),
        ("H01", "Dated 2026-10-15, expected 2026-10-16. Every ERP line from this sheet carries "
         "the wrong date. 208 worker-days, 2547 h effective.", {"sheet": "16", "cell": "F3"},
         "Wrong date at the top of the sheet",
         ["15 Oct 2026", "16 Oct 2026", "the date at the top"]),
        ("H02", "Day type 'Normal Day' on a Saturday.", {"sheet": "31", "cell": "H3"},
         "Wrong day type at the top of the sheet", ["says Normal Day", "change it to Saturday"]),
        ("H02", "Day type marked Holiday, but 2026-10-25 is not in the holiday list (a Sunday).",
         {"sheet": "25", "cell": "H3"}, "Day type says Holiday", ["Keep as holiday"]),
        ("M02", "Employee code shows #N/A (broken lookup formula).",
         {"sheet": "Labour Detail", "cell": "G193"}, "Employee code missing or wrong",
         ["Labour Detail sheet, row 193, Employee code column", "could not find the code"]),
        ("W02", "Out 06:00 (+1 day) on day 15, in again 07:00 on day 16: 1 h rest.",
         {"sheet": "15", "cell": "H9"}, "Short rest between two days",
         ["06:00 next morning", "only 1 hour of rest"]),
        ("W03", "INB-59 07:00-21:00 and INR-09 07:00-00:00 (+1 day) overlap (same ID).",
         {"sheet": "6", "cell": "G1465"}, "Same person entered twice at the same time",
         ["INR-09 (07:00 to 00:00 next morning)"]),
        ("W03", "INB-01 CH 07:00-19:00 and INB-01 07:00-12:00 overlap (same base code).",
         {"sheet": "1"}, "Same person entered twice at the same time", ["INB-01 CH (07:00"]),
        ("W07", "48 upload lines on 24 day(s) go to the ERP with employee 0.",
         {"sheet": "Labour Detail", "cell": "G193"}, "No employee code", ["48 of their"]),
    ],
)  # fmt: skip
def test_explain(rule, message, kw, title, bits):
    p = explain(issue(rule, message, **kw))
    assert p.title == title
    text = " ".join([p.where, p.what, p.fix])
    for bit in bits:
        assert bit in text
    for word in JARGON:
        assert word not in p.what + p.fix


def test_every_rule_has_words():
    for rule in RULES:
        p = explain(Issue(rule=rule, severity=RULES[rule].severity, message="Something odd."))
        assert p.title and p.what and p.fix
