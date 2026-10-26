from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from app.config import TemplateConfig
from app.domain.models import (
    ActivityCode,
    ActivityLine,
    CachedValues,
    DayHeader,
    DaySheet,
    Entry,
    MasterData,
    SnapshotMeta,
    UploadLine,
    WorkbookSnapshot,
    Worker,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = REPO_ROOT / "fixtures"


def make_entry(
    sheet: str,
    block: int,
    calling_name: str,
    time_in=None,
    time_out=None,
    activities: list[tuple] = (),
    additional=None,
    remark=None,
    cached: CachedValues | None = None,
) -> Entry:
    t = TemplateConfig()
    r0 = t.block_row(block)
    lines = [ActivityLine(row=r0 + i) for i in range(5)]
    for i, (code, hours) in enumerate(activities):
        lines[i] = ActivityLine(row=r0 + i, code=code, hours=hours)
    return Entry(
        sheet=sheet,
        block=block,
        row=r0,
        calling_name=calling_name,
        time_in=time_in,
        time_out=time_out,
        activities=lines,
        additional=additional,
        remark=remark,
        cached=cached,
    )


@pytest.fixture
def small_snapshot() -> WorkbookSnapshot:
    """A tiny fake workbook with no real data in it."""
    workers = [
        Worker(row=3, calling_name="INB-01", name="Alpha One", trade_group="Barbender",
               id_no="P1234567", employee_code="X10001"),
        Worker(row=4, calling_name="INB-01 CH", name="Alpha One", trade_group="Carpenter",
               id_no="P1234567", employee_code="X10001"),
        Worker(row=5, calling_name="INC-02", name="Bravo Two", trade_group="Carpenter",
               id_no=12345678.0, employee_code="#N/A", epf="E-77"),
        Worker(row=6, calling_name="INH-03", name="alpha  one", trade_group="Helper",
               id_no="p1234567", employee_code=0.0, daily_rate=2500.0),
    ]  # fmt: skip
    master = MasterData(
        workers=workers,
        activities=[
            ActivityCode(row=3, raw="03-11-00-00"),
            ActivityCode(row=4, raw="03-11-00-00-P"),
            ActivityCode(row=5, raw=" 03-20-00-00-C-8"),
        ],
        day_types=["Normal Day", "Saturday", "Sunday", "Holiday"],
    )
    day1 = DaySheet(
        header=DayHeader(sheet="1", date=dt.date(2026, 10, 1), date_raw=46296.0,
                         day_type="Normal Day", sheet_no=1.0, prepared_by="Clerk A",
                         project="KMTT"),
        block_names=["INB-01", "INB-01 CH", "INC-02", "INH-03"],
        entries=[
            make_entry("1", 0, "INB-01", 7.0, 19.0, [("03-11-00-00", 11.0)],
                       cached=CachedValues(effective=11.0, upload=[UploadLine(row=15, ot=3.0)])),
            make_entry("1", 2, "INC-02", 7.0, 22.0, [("03-11-00-00-P", 13.0)], additional=-1.0,
                       remark="dinner"),
        ],
    )  # fmt: skip
    return WorkbookSnapshot(
        meta=SnapshotMeta(source_name="synthetic.xlsb", read_at=dt.datetime(2026, 10, 26, 12, 0)),
        master=master,
        days=[day1],
    )
