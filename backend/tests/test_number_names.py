"""Workbooks whose calling names are employee numbers (seen on a real workbook, 17 Nov): Labour
Detail holds the text "1234", the day sheet's formula shows it as the number 1234. Made-up values."""

import datetime as dt

from app.config import TemplateConfig
from app.domain.codes import name_text
from app.domain.health import run_health
from app.domain.models import SnapshotMeta, WorkbookSnapshot
from app.excel.grid import day_from_grid, master_from_grid
from app.excel.refs import col_to_index

T = TemplateConfig()


def test_name_text():
    assert name_text("INB-01") == "INB-01" and name_text(1234.0) == "1234" and name_text(56) == "56"
    assert name_text(0) is None and name_text(0.0) is None  # a reference to a blank cell
    assert name_text(12.5) is None and name_text(None) is None and name_text(True) is None


def _grids():
    mc = T.master_cols
    master = {(T.master_rows[0], col_to_index(mc.calling_name)): "1234",
              (T.master_rows[0] + 1, col_to_index(mc.calling_name)): "567"}  # fmt: skip
    dc = T.cols
    r0 = T.block_row(0)
    day = {(r0, col_to_index(dc.calling_name)): 1234.0, (r0, col_to_index(dc.time_in)): 7.0,
           (r0, col_to_index(dc.time_out)): 17.0,
           (T.block_row(1), col_to_index(dc.calling_name)): 0.0}  # fmt: skip
    return master_from_grid(master, T), day_from_grid("2", day, T)


def test_a_number_on_the_day_sheet_is_the_worker_of_labour_detail():
    master, day = _grids()
    [entry] = day.entries
    assert entry.calling_name == "1234" and entry.calling_name in {w.calling_name for w in master.workers}


def test_number_names_are_not_a_format_problem():
    master, day = _grids()
    snap = WorkbookSnapshot(meta=SnapshotMeta(source_name="x.xlsb", read_at=dt.datetime.now()),
                            master=master, days=[day])  # fmt: skip
    report = run_health(snap, dt.date(2026, 11, 1), [], T)
    assert not [i for i in report.issues if i.rule == "M01"]
