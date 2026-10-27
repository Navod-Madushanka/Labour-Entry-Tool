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
         "activities": [{"code": "03-11-00-00", "hours": 11}]}  # fmt: skip


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
    assert body == {"connected": True, "workbook": fake.name, "error": None,
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
