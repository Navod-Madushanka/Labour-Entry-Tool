"""Whose manpower sheet: the supervisor given at push, kept with the push in the change log."""
# ruff: noqa: E501

import pytest
from fastapi.testclient import TestClient

from app.audit.backups import BackupManager
from app.audit.store import AuditStore
from app.config import Config
from app.excel.fake_adapter import FakeWorkbook
from app.main import create_app
from app.service import EntryService

A = {"sheet": "1", "calling_name": "INB-01 CH", "time_in": 7, "time_out": 19,
     "activities": [{"code": "03-11-00-00", "hours": 11}], "acknowledged": ["W03"], "overwrite": True}  # fmt: skip
B = {**A, "calling_name": "INC-02", "acknowledged": []}


@pytest.fixture
def client(small_snapshot, tmp_path):
    fake = FakeWorkbook(small_snapshot)

    def factory(config):
        return EntryService(lambda: fake, config, AuditStore(), BackupManager(tmp_path / "b"))

    with TestClient(create_app(Config(month="2026-10"), service_factory=factory)) as c:
        yield c


def push(c, entries, supervisor):
    body = {"user": "Clerk", "entries": entries, "supervisor": supervisor}
    return c.post("/api/entries", json=body).json()


def owners(c):
    return {
        (o["sheet"], o["calling_name"]): o["supervisor"]
        for o in c.get("/api/supervisor-sheets").json()
    }


def test_push_keeps_the_supervisor_and_undo_gives_it_back(client):
    first = push(client, [A, B], "Kamal  Perera ")
    assert first["status"] == "written"
    assert owners(client) == {("1", "INB-01 CH"): "Kamal Perera", ("1", "INC-02"): "Kamal Perera"}
    [o] = [o for o in client.get("/api/supervisor-sheets").json() if o["calling_name"] == "INC-02"]
    assert (
        o["entry"]["time_in"] == 7 and o["batch_id"] == first["batch_id"] and o["user"] == "Clerk"
    )

    # B again on another supervisor's paper (other times): B is theirs now; "kamal perera" is Kamal
    second = push(client, [{**B, "time_out": 17, "activities": [{"code": "03-11-00-00", "hours": 9}]}],
                  "Nimal")  # fmt: skip
    assert owners(client)[("1", "INC-02")] == "Nimal"
    assert push(client, [A], "kamal perera")["status"] == "unchanged"  # same as Excel: still kept
    assert owners(client)[("1", "INB-01 CH")] == "Kamal Perera"
    assert [s["name"] for s in client.get("/api/supervisors").json()][:2] == [
        "Kamal Perera",
        "Nimal",
    ]

    client.post(f"/api/batches/{second['batch_id']}/undo", json={"user": "Clerk"})
    assert owners(client)[("1", "INC-02")] == "Kamal Perera"  # back to the paper before

    # without a supervisor (other tools, old pages) nothing is kept for the push
    assert push(client, [{**A, "time_in": 8, "time_out": 20}], None)["status"] == "written"
    assert owners(client)[("1", "INB-01 CH")] == "Kamal Perera"


def test_reassign_rename_and_the_list(client):
    push(client, [A, B], "Sunil")
    ids = [
        o["id"]
        for o in client.get("/api/supervisor-sheets").json()
        if o["calling_name"] == "INC-02"
    ]
    client.post("/api/supervisor-sheets/reassign", json={"ids": ids, "supervisor": "Ruwan"})
    assert owners(client) == {("1", "INB-01 CH"): "Sunil", ("1", "INC-02"): "Ruwan"}

    names = lambda: [s["name"] for s in client.get("/api/supervisors").json()]  # noqa: E731
    client.post("/api/supervisors", json={"name": "Amal"})  # typed, not used yet: at the end
    client.post("/api/supervisors", json={"name": "amal"})  # no double
    assert names()[-1] == "Amal" and names().count("Amal") == 1
    client.post("/api/supervisors/rename", json={"old": "Sunil", "new": "Sunil Silva"})
    assert owners(client)[("1", "INB-01 CH")] == "Sunil Silva"
    client.post("/api/supervisors/remove", json={"name": "Ruwan"})
    assert "Ruwan" not in names() and owners(client)[("1", "INC-02")] == "Ruwan"  # sheets kept
    client.post("/api/supervisors", json={"name": "Ruwan"})  # back on the list
    assert "Ruwan" in names()
    assert client.post("/api/supervisors", json={"name": "   "}).status_code == 422


def test_reviews_latest_per_sheet(client):
    push(client, [A, B], "Sunil")
    body = {
        "sheet": "1",
        "supervisor": "Sunil",
        "status": "ok",
        "fingerprint": "f1",
        "user": "Clerk",
    }
    assert client.post("/api/supervisor-reviews", json=body).status_code == 200
    problem = {**body, "status": "problem", "note": "", "fingerprint": "f2"}
    assert client.post("/api/supervisor-reviews", json=problem).status_code == 422  # say what
    [r] = client.post(
        "/api/supervisor-reviews", json={**problem, "note": "INC-02 out 17 on paper"}
    ).json()
    assert (r["status"], r["note"], r["fingerprint"], r["history"]) == (
        "problem",
        "INC-02 out 17 on paper",
        "f2",
        2,
    )
    client.post("/api/supervisors/rename", json={"old": "Sunil", "new": "Sunil Silva"})
    [r] = client.get("/api/supervisor-reviews").json()
    assert r["supervisor"] == "Sunil Silva"  # the review follows the name
