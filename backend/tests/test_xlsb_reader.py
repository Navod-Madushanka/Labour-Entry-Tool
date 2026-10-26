"""XlsbReader against a synthetic workbook made by Excel (scripts/make_synthetic_xlsb.py)."""

import datetime as dt

import pytest

from app.domain.rules import compute_entry
from app.excel.xlsb_reader import XlsbReader, _clean, excel_serial_to_date
from tests.conftest import FIXTURES

SYNTHETIC = FIXTURES / "synthetic" / "template_synthetic.xlsb"


def test_clean_values():
    assert _clean("0x2a") == "#N/A"
    assert _clean("0x7") == "#DIV/0!"
    assert _clean("0x63") == "#UNKNOWN!"
    assert _clean("") is None
    assert _clean("INB-01") == "INB-01"
    assert _clean(7.5) == 7.5
    assert _clean(True) is True


def test_excel_serial_to_date():
    assert excel_serial_to_date(46296.0) == dt.date(2026, 10, 1)
    assert excel_serial_to_date(46296.75) == dt.date(2026, 10, 1)
    assert excel_serial_to_date("46296") is None
    assert excel_serial_to_date(True) is None
    assert excel_serial_to_date(0) is None


@pytest.fixture(scope="module")
def reader():
    if not SYNTHETIC.exists():
        pytest.skip("run scripts/make_synthetic_xlsb.py (needs Excel) to create the fixture")
    with XlsbReader(SYNTHETIC) as r:
        yield r


def test_master(reader):
    m = reader.read_master()
    rows = {w.row: w for w in m.workers}
    assert sorted(rows) == [3, 4, 5, 6, 8]
    assert rows[4].calling_name == "INB-01 CH"
    assert rows[5].employee_code == "#N/A"
    assert rows[5].id_no == 12345678.0
    assert rows[6].employee_code == 0.0
    assert rows[8].trade_group == "Masan"
    # activity list stops at the first blank and keeps raw spaces
    assert [a.row for a in m.activities] == [3, 4, 5, 6, 7]
    assert m.activities[2].raw == " 03-20-00-00-C-8"
    assert m.activities[2].code == "03-20-00-00-C-8"
    assert m.day_types == ["Normal Day", "Saturday", "Sunday", "Holiday"]


def test_header(reader):
    h = reader.read_day("4").header
    assert (h.date, h.day_type, h.sheet_no, h.project) == (
        dt.date(2026, 10, 4),
        "Sunday",
        4.0,
        "KMTT",
    )


def test_block_names_follow_labour_detail(reader):
    names = reader.read_day("1").block_names
    assert len(names) == 500
    assert names[:7] == ["INB-01", "INB-01 CH", "INC-02", "INH-03", None, "INM-04", None]
    assert all(n is None for n in names[6:])


def test_entries_and_cached_values(reader):
    day = reader.read_day("1")
    entries = {e.block: e for e in day.entries}
    assert sorted(entries) == [0, 2, 3, 5]

    e = entries[0]
    assert (e.row, e.time_in, e.time_out, e.remark) == (9, 7.0, 19.0, "test remark")
    assert [(a.row, a.code, a.hours) for a in e.activity_lines] == [
        (9, "03-11-00-00", 8.0),
        (10, "03-11-00-00-P", 3.0),
    ]
    assert [u.row for u in e.cached.upload] == list(range(9, 16))
    assert e.cached.effective == 11.0
    assert e.cached.upload[0].employee == "X00001"
    assert (e.cached.upload[5].activity, e.cached.upload[5].hours) == ("ZIDLE", 0.0)
    assert e.cached.upload[6].ot == 3.0

    assert entries[2].additional == -1.0
    assert entries[2].cached.upload[0].employee is None  # IFERROR(...,"") -> blank
    assert entries[3].activities[0].code == " 03-20-00-00-C-8 "
    assert entries[3].activities[0].hours == "13`"  # text kept raw
    assert entries[3].cached.upload[0].employee == 0.0
    assert not entries[5].is_complete


def test_rules_agree_with_cached_stand_in_formulas(reader):
    day = reader.read_day("1")
    for e in day.entries:
        c = compute_entry(e, day.header.day_type)
        if c is None:
            continue
        assert c.effective == e.cached.effective
        assert c.zidle == e.cached.upload[5].hours  # Excel SUM ignored the text "13`" too


def test_overnight_entry_on_day_2(reader):
    (e,) = reader.read_day("2").entries
    assert (e.block, e.calling_name, e.time_out) == (1, "INB-01 CH", 30.0)


def test_snapshot(reader):
    snap = reader.snapshot()
    assert len(snap.days) == 31
    assert len(snap.meta.source_sha256) == 64
    assert sum(len(d.entries) for d in snap.days) == 5


def test_unknown_sheet(reader):
    with pytest.raises(KeyError):
        reader.read_day("SUMMARY ")
