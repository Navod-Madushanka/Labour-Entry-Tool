"""Models, the fake adapter, JSON fixtures and the sanitizer."""

import pytest

from app.excel.fake_adapter import FakeAdapter, load_snapshot, save_snapshot
from app.sanitize import sanitize_snapshot
from tests.conftest import make_entry


def test_entry_input_flags():
    assert not make_entry("1", 0, "INB-01").has_input
    assert make_entry("1", 0, "INB-01", remark="x").has_input
    assert make_entry("1", 0, "INB-01", activities=[(None, 3.0)]).has_input
    assert make_entry("1", 0, "INB-01", 7.0, 19.0).is_complete
    assert not make_entry("1", 0, "INB-01", 7.0, "19").is_complete


def test_activity_lines_skip_blank_rows():
    e = make_entry("1", 0, "INB-01", 7.0, 19.0, [("A", 5.0), (None, None), ("B", 6.0)])
    assert [a.code for a in e.activity_lines] == ["A", "B"]


def test_json_roundtrip(tmp_path, small_snapshot):
    path = save_snapshot(small_snapshot, tmp_path / "snap.json")
    assert load_snapshot(path) == small_snapshot


def test_fake_adapter_reads_copies(small_snapshot):
    fa = FakeAdapter(small_snapshot)
    assert fa.day_sheet_names() == ["1"]
    day = fa.read_day("1")
    day.entries.clear()
    assert len(fa.read_day("1").entries) == 2
    assert fa.read_master().workers[0].calling_name == "INB-01"
    with pytest.raises(KeyError):
        fa.read_day("32")


def test_sanitize_replaces_personal_data(small_snapshot):
    s = sanitize_snapshot(small_snapshot)
    w = s.master.workers
    assert s.meta.sanitized
    # names: equal (after spacing/case) -> equal fakes, and no real name left
    assert w[0].name == w[1].name == w[3].name == "Worker 0001"
    assert w[2].name == "Worker 0002"
    # IDs: equality preserved after normalisation, numeric stays numeric
    assert w[0].id_no == w[1].id_no == w[3].id_no == "ID000001"
    assert isinstance(w[2].id_no, float) and w[2].id_no != 12345678.0
    assert w[2].epf == "EPF00001"
    assert w[3].daily_rate is None
    day = s.days[0]
    assert day.header.prepared_by == "Preparer 01"
    assert day.entries[1].remark == "remark 0001"
    assert day.entries[0].remark is None


def test_sanitize_keeps_codes_times_and_does_not_mutate(small_snapshot):
    s = sanitize_snapshot(small_snapshot)
    for a, b in zip(s.master.workers, small_snapshot.master.workers, strict=True):
        assert (a.calling_name, a.employee_code, a.trade_group) == (
            b.calling_name,
            b.employee_code,
            b.trade_group,
        )
    assert s.master.activities == small_snapshot.master.activities
    a, b = s.days[0].entries[1], small_snapshot.days[0].entries[1]
    assert (a.time_in, a.time_out, a.activities, a.additional) == (
        b.time_in,
        b.time_out,
        b.activities,
        b.additional,
    )
    assert small_snapshot.master.workers[0].name == "Alpha One"
    assert small_snapshot.days[0].entries[1].remark == "dinner"


def test_sanitize_is_deterministic(small_snapshot):
    assert sanitize_snapshot(small_snapshot) == sanitize_snapshot(small_snapshot)


def test_sanitize_leaves_errors(small_snapshot):
    small_snapshot.master.workers[2].id_no = "#N/A"
    assert sanitize_snapshot(small_snapshot).master.workers[2].id_no == "#N/A"
