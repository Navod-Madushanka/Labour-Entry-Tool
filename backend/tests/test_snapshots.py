"""Rolling snapshots (recovery option 2): a whole copy of the workbook every few minutes when it
changed, kept within limits, listed, and never a path outside its folder. Made-up data."""

import asyncio
import datetime as dt
import os
import time

import pytest
from fastapi.testclient import TestClient

from app import autosave, snapshots
from app.audit.backups import BackupManager
from app.audit.store import AuditStore
from app.config import Config
from app.excel.fake_adapter import FakeWorkbook
from app.main import create_app
from app.service import EntryService

A = {"sheet": "1", "calling_name": "INB-01 CH", "time_in": 7, "time_out": 19,
     "activities": [{"code": "03-11-00-00", "hours": 11}], "acknowledged": ["W03"]}  # fmt: skip


@pytest.fixture
def setup(small_snapshot, tmp_path, monkeypatch):
    monkeypatch.setenv("LABOUR_TOOL_DATA", str(tmp_path / "data"))
    fake = FakeWorkbook(small_snapshot)

    def factory(config):
        svc = EntryService(lambda: fake, config, AuditStore(), BackupManager(tmp_path / "b"))
        svc.mode = "live"  # snapshots are for the real workbook
        return svc

    cfg = Config(month="2026-10", settings_file=tmp_path / "w.json")
    with TestClient(create_app(cfg, service_factory=factory)) as c:
        c.post("/api/autosave", json={"on": False})  # only the copies here
        yield c, fake


def tick(c, state):
    asyncio.run(autosave.tick(c.app, state))


def test_a_copy_when_changed_and_not_otherwise(setup, monkeypatch):
    c, fake = setup
    monkeypatch.setattr(fake, "has_unsaved_changes", lambda: False, raising=False)
    state = {}
    tick(c, state)
    assert c.get("/api/snapshots").json()["items"] == []  # nothing changed: no copy
    c.post("/api/entries", json={"user": "Clerk", "entries": [A]})
    state.clear()  # past the interval
    tick(c, state)
    v = c.get("/api/snapshots").json()
    assert len(v["items"]) == 1 and v["on"] and v["every_min"] == 10
    assert v["items"][0]["file"].startswith("synthetic_")
    tick(c, state)  # within the interval: nothing new
    assert len(c.get("/api/snapshots").json()["items"]) == 1


def test_typed_in_excel_counts_as_a_change(setup, monkeypatch):
    c, fake = setup
    monkeypatch.setattr(fake, "has_unsaved_changes", lambda: True, raising=False)
    tick(c, {})
    assert len(c.get("/api/snapshots").json()["items"]) == 1


def test_switch_and_take_now_and_open(setup):
    c, fake = setup
    assert c.post("/api/snapshots/switch", json={"on": False}).json()["on"] is False
    c.post("/api/entries", json={"user": "Clerk", "entries": [A]})
    tick(c, {})
    assert c.get("/api/snapshots").json()["items"] == []  # switched off
    v = c.post("/api/snapshots/take").json()  # by hand still works
    assert len(v["items"]) == 1
    r = c.post("/api/snapshots/open", json={"file": "../../w.json"})
    assert r.status_code == 404  # nothing outside the folder
    if os.name != "nt":
        assert c.post("/api/snapshots/open", json={}).status_code == 501


def test_prune_keeps_recent_and_one_per_day_within_size(tmp_path, monkeypatch):
    d = tmp_path / "s"
    d.mkdir()
    now = dt.datetime(2026, 11, 27, 18, 0)
    files = []
    for i in range(60):  # every 2 hours back: 27 Nov 18:00 to 22 Nov 20:00 (six days)
        p = d / f"book_{i:03d}.xlsb"
        p.write_bytes(b"x" * 1000)
        t = (now - dt.timedelta(hours=2 * i)).timestamp()
        os.utime(p, (t, t))
        files.append(p)
    gone = snapshots.prune(d, now)
    left = sorted(p.name for p in d.iterdir())
    assert len(left) == snapshots.KEEP_LAST + 4  # 12 newest (27th, two of the 26th) + newest of 25th-22nd
    assert "book_000.xlsb" in left and len(gone) == 60 - len(left)
    monkeypatch.setattr(snapshots, "MAX_MB", 0.0025)  # room for about two
    snapshots.prune(d, now)
    assert sorted(p.name for p in d.iterdir()) == ["book_000.xlsb", "book_001.xlsb"]


def test_recovered_copy_shares_the_folder():
    assert snapshots.book_dir("Labour Entry Sheet November 2026 - Supply(AutoRecovered).xlsb") == snapshots.book_dir(
        "Labour Entry Sheet November 2026 - Supply.xlsb"
    )
    time.sleep(0)
