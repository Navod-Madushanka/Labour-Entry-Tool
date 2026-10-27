"""Live-workbook API on the fake workbook (Phase 2)."""

import pytest
from fastapi.testclient import TestClient

from app.audit.backups import BackupManager
from app.audit.store import AuditStore
from app.config import Config
from app.excel.adapter import NotConnectedError
from app.excel.fake_adapter import FakeWorkbook
from app.main import create_app
from app.service import EntryService

ENTRY = {"sheet": "1", "calling_name": "INB-01 CH", "time_in": 7, "time_out": 19,
         "activities": [{"code": "03-11-00-00", "hours": 11}],
         "acknowledged": ["W03"]}  # same person as INB-01, who works 7-19 that day  # fmt: skip


@pytest.fixture
def fake(small_snapshot):
    return FakeWorkbook(small_snapshot)


@pytest.fixture
def client(fake, tmp_path):
    def factory(config):
        return EntryService(lambda: fake, config, AuditStore(), BackupManager(tmp_path / "b"))

    with TestClient(create_app(Config(month="2026-10"), service_factory=factory)) as c:
        yield c


def test_status(client, fake):
    body = client.get("/api/status").json()
    assert body == {"connected": True, "mode": "live", "workbook": fake.name, "error": None,
                    "unsaved_changes": False, "backup": None}  # fmt: skip


def test_preview_writes_nothing(client, fake):
    res = client.post("/api/preview", json={"entries": [ENTRY]})
    [plan] = res.json()["plans"]
    assert plan["ok"] and plan["preview"]["effective"] == 11 and plan["row"] == 16
    assert plan["changes"]["G16"] == [None, 7.0]
    assert fake.batches == []


def test_commit_undo_save(client, fake):
    res = client.post("/api/entries", json={"user": "Navod", "entries": [ENTRY]}).json()
    assert res["status"] == "written" and res["readback"][0]["ok"]
    assert fake.read_range("1", "G16:H16") == [[7.0, 19.0]]
    [batch] = client.get("/api/batches").json()
    assert (batch["id"], batch["user"], batch["cells"]) == (res["batch_id"], "Navod", 4)
    assert client.get("/api/status").json()["unsaved_changes"] is True

    undo = client.post(f"/api/batches/{res['batch_id']}/undo", json={"user": "Navod"}).json()
    assert undo["status"] == "undone"
    assert fake.read_range("1", "G16:H16") == [[None, None]]

    assert client.post("/api/save").json() == {"saved": True} and fake.saves == 1
    assert client.get("/api/status").json()["unsaved_changes"] is False


def test_rejected_and_dry_run(client, fake):
    bad = {**ENTRY, "calling_name": "INB-01"}  # has input already: E08
    res = client.post("/api/entries", json={"user": "Navod", "entries": [bad]}).json()
    assert res["status"] == "rejected" and res["plans"][0]["blocking"][0]["rule"] == "E08"
    res = client.post("/api/entries", json={"user": "Navod", "entries": [ENTRY], "dry_run": True})
    assert res.json()["status"] == "dry_run" and fake.batches == []


def test_validation_errors(client):
    assert client.post("/api/entries", json={"user": "", "entries": [ENTRY]}).status_code == 422
    assert client.post("/api/entries", json={"user": "x", "entries": []}).status_code == 422
    assert (
        client.post("/api/preview", json={"entries": [{**ENTRY, "sheet": "32"}]}).status_code == 422
    )


def test_excel_not_open(tmp_path):
    def connect():
        raise NotConnectedError("No open workbook matches 'Labour Entry Sheet *'.")

    def factory(config):
        return EntryService(connect, config, AuditStore(), BackupManager(tmp_path))

    with TestClient(create_app(Config(month="2026-10"), service_factory=factory)) as c:
        status = c.get("/api/status").json()
        assert not status["connected"] and "No open workbook" in status["error"]
        res = c.post("/api/preview", json={"entries": [ENTRY]})
        assert res.status_code == 503 and "No open workbook" in res.json()["detail"]


def test_excel_switched_off():
    config = Config(month="2026-10", excel={"enabled": False})
    with TestClient(create_app(config)) as c:
        assert c.get("/api/status").json()["connected"] is False
        assert c.post("/api/preview", json={"entries": [ENTRY]}).status_code == 503


def test_busy_excel_is_a_conflict(client, fake):
    fake.busy_failures = 1
    res = client.post("/api/entries", json={"user": "Navod", "entries": [ENTRY]}).json()
    assert res["status"] == "failed" and "busy" in res["error"]


def test_master_and_day(client, fake):
    m = client.get("/api/master").json()
    assert m["workbook"] == fake.name and m["sheets"] == ["1"] and m["month"] == "2026-10"
    assert [w["calling_name"] for w in m["workers"]] == ["INB-01", "INB-01 CH", "INC-02", "INH-03"]
    w = m["workers"][2]
    assert (w["block"], w["code_status"], w["person"]) == (2, "error", "INC02")
    assert m["activities"] == ["03-11-00-00", "03-11-00-00-P", "03-20-00-00-C-8"]

    d = client.get("/api/days/1").json()
    assert d["expected_date"] == "2026-10-01" and d["expected_day_type"] == "Normal Day"
    assert d["header_issues"] == []
    assert [(v["entry"]["calling_name"], v["computed"]["effective"]) for v in d["entries"]] == [
        ("INB-01", 11.0), ("INC-02", 13.0),
    ]  # fmt: skip
    assert [i["rule"] for i in d["entries"][1]["issues"]] == []  # -1 with a remark: fine
    assert client.get("/api/days/9").status_code == 422


def test_day_view_refreshes_after_a_write(client):
    assert len(client.get("/api/days/1").json()["entries"]) == 2
    client.post("/api/entries", json={"user": "Navod", "entries": [ENTRY]})
    assert len(client.get("/api/days/1").json()["entries"]) == 3


def test_preview_has_day_counts(client):
    [plan] = client.post("/api/preview", json={"entries": [ENTRY]}).json()["plans"]
    assert (plan["day_count"], plan["bp_day"]) == (1.0, True)


def test_header_fix_needs_approval(client, fake):
    fake.grids["1"][(3, 8)] = "Sunday"
    body = {"user": "Navod", "fields": ["day_type"]}
    assert client.post("/api/days/1/header-fix", json=body).status_code == 422
    res = client.post("/api/days/1/header-fix", json={**body, "approve": True}).json()
    assert res["status"] == "written" and res["changes"] == {"H3": ["Sunday", "Normal Day"]}
    bad = {**body, "fields": ["remarks"], "approve": True}
    assert client.post("/api/days/1/header-fix", json=bad).status_code == 422


def test_demo_mode(tmp_path, small_snapshot):
    from app.excel.fake_adapter import save_snapshot
    from app.main import demo_service

    path = save_snapshot(small_snapshot, tmp_path / "snap.json")
    config = Config(month="2026-10")
    with TestClient(create_app(config, lambda cfg: demo_service(cfg, path))) as c:
        assert c.get("/api/status").json()["mode"] == "demo"
        res = c.post("/api/entries", json={"user": "Navod", "entries": [ENTRY]}).json()
        assert res["status"] == "written"
    assert path.read_text() == save_snapshot(small_snapshot, tmp_path / "again.json").read_text()
