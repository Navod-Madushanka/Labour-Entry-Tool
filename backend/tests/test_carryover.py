"""Previous month carry-over: the file next to this one, its last days as sheets 0, -1, …;
made-up workbooks only."""

from __future__ import annotations

import datetime as dt

from app.carryover import kind_of, month_of, previous_days, previous_workbook
from app.config import TemplateConfig
from app.domain.models import DayHeader, DaySheet, MasterData, SnapshotMeta, WorkbookSnapshot
from app.excel.fake_adapter import save_snapshot
from tests.conftest import make_entry


def snap(month: int, filled: list[int]) -> WorkbookSnapshot:
    days = []
    for d in range(1, 31):
        date = dt.date(2026, month, d)
        entries = (
            [make_entry(str(d), 0, "A-01", 7.0, 19.0 + month % 2, [("03-11-00-00", None)])]
            if d in filled
            else []
        )
        days.append(DaySheet(header=DayHeader(sheet=str(d), date=date, day_type="Normal Day", sheet_no=float(d)),  # noqa: E501
                             block_names=["A-01"], entries=entries))  # fmt: skip
    meta = SnapshotMeta(source_name="x", read_at=dt.datetime(2026, 11, 1, tzinfo=dt.UTC))
    return WorkbookSnapshot(
        meta=meta, master=MasterData(workers=[], activities=[], day_types=[]), days=days
    )


def test_names():
    assert kind_of("Labour Entry Sheet October 2026 - INDIAN (2).xlsb") == kind_of(
        "Labour Entry Sheet September 2026 - INDIAN.xlsb"
    )
    assert kind_of("Labour Entry Sheet October 2026 - INDIAN.xlsb") != kind_of(
        "Labour Entry Sheet September 2026 - SUB CONTRACT.xlsb"
    )
    assert month_of("Labour Entry Sheet October 2026 - INDIAN.xlsb") == dt.date(2026, 10, 1)
    assert month_of("Book1.xlsb") is None


def test_previous_file_and_last_days(tmp_path):
    oct_ = save_snapshot(
        snap(10, [1, 2]), tmp_path / "Labour Entry Sheet October 2026 - INDIAN.json"
    )
    sep = save_snapshot(
        snap(9, [25, 26, 28, 29]), tmp_path / "Labour Entry Sheet September 2026 - INDIAN.json"
    )
    save_snapshot(
        snap(9, [30]), tmp_path / "Labour Entry Sheet September 2026 - SUB CONTRACT.json"
    )  # other kind
    save_snapshot(
        snap(8, [30]), tmp_path / "Labour Entry Sheet August 2026 - INDIAN.json"
    )  # too old
    assert previous_workbook(oct_) == sep
    assert previous_workbook(sep) is not None and "August" in previous_workbook(sep).name
    assert previous_workbook(tmp_path / "Labour Entry Sheet March 2026 - INDIAN.json") is None
    assert previous_workbook(None) is None
    days = previous_days(sep, TemplateConfig(), days=3)
    assert [d.header.sheet for d in days] == ["0", "-1", "-2"]  # 29, 28, 26 (27 had nobody)
    assert [d.header.date.day for d in days] == [29, 28, 26]
    assert all(e.sheet == d.header.sheet for d in days for e in d.entries)
