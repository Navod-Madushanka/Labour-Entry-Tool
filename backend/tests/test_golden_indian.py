"""Golden numbers for the INDIAN snapshot of 26 Oct 2026 (PLAN.md Appendix A, Phase 0 "done").

Runs against ``fixtures/private/*INDIAN*.xlsb`` (real file, local only) and/or
``fixtures/sanitized/*indian*.json`` (from scripts/snapshot_fixture.py).
Skipped when neither exists.
"""

from __future__ import annotations

import datetime as dt
import re
from collections import Counter

import pytest

from app.config import TemplateConfig
from app.domain.codes import (
    EmployeeCodeStatus,
    employee_code_status,
    normalise_activity,
    parse_calling_name,
)
from app.domain.models import WorkbookSnapshot, as_number, is_blank
from app.domain.rules import compute_entry, same_hours
from app.excel.fake_adapter import load_snapshot
from app.excel.xlsb_reader import XlsbReader
from tests.conftest import FIXTURES

pytestmark = pytest.mark.golden

PLAN_SHA256 = "89a434ac2846f7bf6de21e42f66463df36a7322b1f2ce6b3ead3bc1fff4d60dd"
T = TemplateConfig()


def _find(folder, suffix):
    if not folder.is_dir():
        return []
    return sorted(
        p for p in folder.iterdir() if p.suffix.lower() == suffix and "indian" in p.name.lower()
    )


_SOURCES = [pytest.param(("xlsb", p), id="xlsb") for p in _find(FIXTURES / "private", ".xlsb")[:1]]
_SOURCES += [
    pytest.param(("json", p), id="sanitized") for p in _find(FIXTURES / "sanitized", ".json")[:1]
]
if not _SOURCES:
    _SOURCES = [
        pytest.param(None, marks=pytest.mark.skip(reason="no INDIAN snapshot in fixtures/"))
    ]


@pytest.fixture(scope="module", params=_SOURCES)
def indian(request) -> WorkbookSnapshot:
    kind, path = request.param
    if kind == "xlsb":
        with XlsbReader(path, T) as reader:
            return reader.snapshot()
    return load_snapshot(path)


def _entries(snap):
    return [(day, e) for day in snap.days for e in day.entries]


def _calendar_day_type(date: dt.date) -> str:
    if date == dt.date(2026, 10, 25):
        return "Holiday"
    return {5: "Saturday", 6: "Sunday"}.get(date.weekday(), "Normal Day")


def test_source_is_planned_snapshot(indian):
    assert indian.meta.source_sha256 == PLAN_SHA256, (
        "golden numbers belong to the 26 Oct 2026 snapshot (PLAN.md §5.1); this file differs"
    )


# --- Labour Detail -----------------------------------------------------------------------------


def test_calling_names(indian):
    names = [w.calling_name for w in indian.master.workers]
    assert len(names) == 248
    prefixes = Counter(re.match(r"[A-Z]+", n.strip()).group() for n in names)
    assert prefixes == {"INB": 85, "INC": 86, "INH": 32, "INM": 37, "INR": 6, "INS": 2}
    roles = {n for n in names if (cn := parse_calling_name(n)) and cn.role}
    assert roles == {"INB-04 CH", "INC-18 C", "INC-22 CH", "INH-04 CH", "INC-46 M"}


def test_employee_codes(indian):
    workers = indian.master.workers
    status = {w.row: employee_code_status(w.employee_code) for w in workers}
    assert Counter(status.values()) == {
        EmployeeCodeStatus.VALID: 210,
        EmployeeCodeStatus.ERROR: 37,
        EmployeeCodeStatus.ZERO: 1,
    }
    valid = [w.employee_code for w in workers if status[w.row] == EmployeeCodeStatus.VALID]
    assert all(re.fullmatch(r"X\d{5}", c) for c in valid)
    assert sorted(r for r, s in status.items() if s == EmployeeCodeStatus.ERROR) == list(
        range(214, 251)
    )
    zero = [w for w in workers if status[w.row] == EmployeeCodeStatus.ZERO]
    assert [(w.row, w.calling_name) for w in zero] == [(193, "INH-21")]


def test_ids(indian):
    workers = indian.master.workers
    assert [w.calling_name for w in workers if is_blank(w.id_no)] == ["INC-46 M"]
    assert sum(isinstance(w.id_no, float) for w in workers) == 3


def test_activity_list(indian):
    acts = indian.master.activities
    assert len(acts) == 309
    assert (acts[0].row, acts[-1].row) == (3, 311)
    counts = Counter(a.code for a in acts)
    assert len(counts) == 306
    assert {c for c, n in counts.items() if n > 1} == {
        "03-31-05-35-P",
        "03-11-00-00-C-8",
        "31-23-23-01-C-1",
    }
    assert [a.row for a in acts if a.raw != a.code] == [290]


def test_day_types(indian):
    assert indian.master.day_types == ["Normal Day", "Saturday", "Sunday", "Holiday"]


# --- Day sheet headers ------------------------------------------------------------------------


def test_headers(indian):
    headers = {d.header.sheet: d.header for d in indian.days}
    assert sorted(headers, key=int) == [str(n) for n in range(1, 32)]
    for n in range(1, 32):
        h = headers[str(n)]
        intended = dt.date(2026, 10, n)
        assert h.date == (dt.date(2026, 10, 15) if n == 16 else intended), f"sheet {n} date"
        expected = {4: "Saturday", 31: "Normal Day"}.get(n, _calendar_day_type(intended))
        assert h.day_type == expected, f"sheet {n} day type"
        assert h.sheet_no == (30 if n == 31 else n), f"sheet {n} F4"


def test_block_order_follows_labour_detail(indian):
    by_row = {w.row: w.calling_name for w in indian.master.workers}
    expected = [by_row.get(T.master_row_for_block(k)) for k in range(T.blocks)]
    for day in indian.days:
        assert day.block_names == expected, f"sheet {day.header.sheet}"


# --- Entries ----------------------------------------------------------------------------------


def test_entry_counts(indian):
    entries = [e for _, e in _entries(indian)]
    assert len(entries) == 4075
    assert sum(e.is_complete for e in entries) == 4074
    assert {int(e.sheet) for e in entries} == set(range(1, 25))
    assert len({e.calling_name for e in entries}) == 228
    lines = [a for e in entries for a in e.activities if not is_blank(a.code)]
    assert len(lines) == 4202
    assert len({normalise_activity(a.code) for a in lines}) == 73


def test_allocation(indian):
    kinds = Counter()
    for day, e in _entries(indian):
        c = compute_entry(e, day.header.day_type)
        if c is None:
            continue
        if same_hours(c.activity_hours, c.effective):
            kinds["full"] += 1
        elif c.activity_hours > c.effective:
            kinds["over"] += 1
        elif same_hours(c.activity_hours, 0):
            kinds["none"] += 1
        else:
            kinds["partial"] += 1
    assert kinds == {"full": 4066, "partial": 5, "none": 2, "over": 1}


def test_rules_match_excel_cache(indian):
    """Phase 0 done: recomputed effective / OT / ZIDLE == Excel's cached values, every entry."""
    checked, mismatches = 0, []
    for day, e in _entries(indian):
        c = compute_entry(e, day.header.day_type)
        if c is None:
            continue
        checked += 1
        upload = {u.row - e.row + 1: u for u in e.cached.upload}
        cached = {
            "effective": as_number(e.cached.effective),
            "zidle": as_number(upload[T.zidle_row].hours),
            "ot": as_number(upload[T.ot_row].ot),
        }
        mine = {"effective": c.effective, "zidle": c.zidle, "ot": c.ot}
        for key, value in mine.items():
            if not same_hours(value, cached[key]):
                mismatches.append((day.header.sheet, e.calling_name, key, value, cached[key]))
    assert checked == 4074
    assert mismatches == [], f"{len(mismatches)} mismatches, first: {mismatches[:20]}"


def test_upload_lines_without_valid_employee(indian):
    by_row = {w.row: w for w in indian.master.workers}
    blank_lines, zero_lines, blank_workers = 0, 0, set()
    for day, e in _entries(indian):
        c = compute_entry(e, day.header.day_type)
        if c is None:
            continue
        lines = sum(not is_blank(a.code) for a in e.activities)
        lines += (not same_hours(c.zidle, 0)) + (c.ot is not None)
        worker = by_row.get(T.master_row_for_block(e.block))
        status = employee_code_status(worker.employee_code if worker else None)
        if status in (EmployeeCodeStatus.ERROR, EmployeeCodeStatus.MISSING):
            blank_lines += lines
            blank_workers.add(e.calling_name)
        elif status == EmployeeCodeStatus.ZERO:
            zero_lines += lines
    assert (blank_lines, len(blank_workers), zero_lines) == (1358, 36, 48)
