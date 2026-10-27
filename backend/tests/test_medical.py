"""Medical leave: a '<base> M' line with N working days (Sundays skipped), In 7, Out 16."""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.audit.backups import BackupManager
from app.audit.store import AuditStore
from app.config import Config
from app.domain.medical import medical_dates, medical_name
from app.domain.models import ActivityCode, DayHeader, DaySheet
from app.excel.fake_adapter import FakeWorkbook
from app.main import create_app
from app.service import EntryService, MedicalRequest

OCT = dt.date(2026, 10, 1)


def test_medical_name():
    assert medical_name("INC-08") == "INC-08 M"
    assert medical_name("INC-08 M") is None and medical_name("nonsense") is None


def test_ten_working_days_skip_sundays():
    d = medical_dates(dt.date(2026, 10, 1), 10, OCT)  # Thu 1 Oct; Sundays 4 and 11
    assert [x.sheet for x in d.days] == ["1", "2", "3", "5", "6", "7", "8", "9", "10", "12"]
    assert [day for day, _ in d.skipped] == [dt.date(2026, 10, 4), dt.date(2026, 10, 11)]


def test_days_past_the_month_and_holidays():
    d = medical_dates(dt.date(2026, 10, 26), 10, OCT, holidays=[dt.date(2026, 10, 27)])
    assert [x.sheet for x in d.days] == ["26", "27", "28", "29", "30", "31"]  # holiday counts
    assert d.later == [
        dt.date(2026, 11, 2),
        dt.date(2026, 11, 3),
        dt.date(2026, 11, 4),
        dt.date(2026, 11, 5),
    ]  # fmt: skip  (Sun 1 Nov skipped)
    d = medical_dates(dt.date(2026, 10, 26), 3, OCT, [dt.date(2026, 10, 27)], skip_holidays=True)
    assert [x.sheet for x in d.days] == ["26", "28", "29"]


@pytest.fixture
def setup(small_snapshot, tmp_path):
    snap = small_snapshot.model_copy(deep=True)
    snap.master.activities.append(ActivityCode(row=6, raw="00-00-10-00"))  # the medical code
    for n in range(2, 6):  # sheets 1-5; 4 Oct is a Sunday, 3 Oct a Saturday
        date = dt.date(2026, 10, n)
        day_type = {5: "Saturday", 6: "Sunday"}.get(date.weekday(), "Normal Day")
        snap.days.append(DaySheet(header=DayHeader(sheet=str(n), date=date, day_type=day_type,
                                                   sheet_no=float(n)),
                                  block_names=list(snap.days[0].block_names)))  # fmt: skip
    fake = FakeWorkbook(snap)
    svc = EntryService(lambda: fake, Config(month="2026-10"), AuditStore(), BackupManager(tmp_path))
    return svc, fake


def test_preview_adds_row_and_flags(setup):
    svc, _ = setup
    plan = svc.medical_preview(MedicalRequest(base="INC-02", start="2", days=3))
    assert (plan.name, plan.row, plan.new_row) == ("INC-02 M", 7, True)
    assert plan.new_row_cells == ["A7", "B7", "C7", "D7", "H7"]  # #N/A code is not copied
    assert [p.input.sheet for p in plan.plans] == ["2", "3", "5"] and plan.skipped == [
        "Sun 04 Oct: Sunday"
    ]
    assert all(p.preview.effective == 8 for p in plan.plans)
    assert [i.rule for i in plan.plans[1].issues] == ["W09"]  # Saturday: 2.5 h OT
    assert "INC-02 has no valid employee code either." in plan.notes
    bad = svc.medical_preview(MedicalRequest(base="INB-01 CH", start="2"))
    assert bad.problems == ["INB-01 CH is not a base calling name (no role suffix allowed)."]


def test_write_reads_back_and_undo_order(setup):
    svc, fake = setup
    req = MedicalRequest(base="INB-01", start="2", days=3, acknowledged={"3": ["W09"]})
    res = svc.medical_leave(req, "Navod")
    assert (
        res.status == "written" and res.row.status == "written" and res.entries.status == "written"
    )
    assert all(r.ok for r in res.entries.readback)
    row = ["INB-01 M", "Alpha One", "Barbender", "P1234567", None, None, "X10001"]
    assert fake.read_range("Labour Detail", "A7:G7") == [row]
    e = next(e for e in fake.read_day("5").entries if e.calling_name == "INB-01 M")
    assert (e.time_in, e.time_out, e.activities[0].code, e.activities[0].hours) == (
        7.0,
        16.0,
        "00-00-10-00",
        8.0,
    )
    assert e.cached.upload[0].employee == "X10001"
    assert svc.undo(res.row.batch_id, "Navod").status == "conflict"  # entries still there
    assert svc.undo(res.entries.batch_id, "Navod").status == "undone"
    assert svc.undo(res.row.batch_id, "Navod").status == "undone"
    assert fake.read_range("Labour Detail", "A7:G7") == [[None] * 7]


def test_existing_medical_line_is_reused(setup):
    svc, _ = setup
    svc.medical_leave(MedicalRequest(base="INB-01", start="2", days=1), "Navod")
    plan = svc.medical_preview(MedicalRequest(base="INB-01", start="5", days=1))
    assert (plan.row, plan.new_row) == (7, False)


def test_unconfirmed_warning_writes_nothing(setup):
    svc, fake = setup
    res = svc.medical_leave(MedicalRequest(base="INB-01", start="2", days=3), "Navod")  # W09 on 3
    assert res.status == "rejected" and fake.batches == []
    assert not any(w.calling_name == "INB-01 M" for w in fake.read_master().workers)


def test_api(setup):
    svc, _ = setup
    with TestClient(create_app(Config(month="2026-10"), service_factory=lambda cfg: svc)) as c:
        body = {"base": "INB-01", "start": "5", "days": 1}
        plan = c.post("/api/medical/preview", json=body).json()
        assert plan["name"] == "INB-01 M" and plan["plans"][0]["ok"]
        assert c.post("/api/medical", json={**body, "user": "Navod"}).status_code == 422  # approve
        res = c.post("/api/medical", json={**body, "user": "Navod", "approve": True}).json()
        assert res["status"] == "written" and res["row"]["written"]["A7"] == [None, "INB-01 M"]
