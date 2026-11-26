"""Automatic save, by the tool itself: a few seconds after the tool's write, and whenever Excel
says it holds unsaved changes (typed in Excel too); never while a job runs; off by the switch."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app import autosave
from app.audit.backups import BackupManager
from app.audit.store import AuditStore
from app.config import Config
from app.excel.fake_adapter import FakeWorkbook
from app.main import create_app
from app.service import EntryService

ENTRY = {"sheet": "1", "calling_name": "INB-01 CH", "time_in": 7, "time_out": 19,
         "activities": [{"code": "03-11-00-00", "hours": 11}], "acknowledged": ["W03"]}  # fmt: skip


@pytest.fixture
def setup(small_snapshot, tmp_path, monkeypatch):
    fake = FakeWorkbook(small_snapshot)
    cfg = Config(month="2026-10", settings_file=tmp_path / "w.json")

    def factory(config):
        return EntryService(lambda: fake, config, AuditStore(), BackupManager(tmp_path / "b"))

    monkeypatch.setattr(autosave, "AFTER_WRITE", 0.0)
    with TestClient(create_app(cfg, service_factory=factory)) as c:
        yield c, fake


def run_tick(c, state=None):
    asyncio.run(autosave.tick(c.app, state if state is not None else {}))


def test_saved_after_a_push_without_the_page(setup):
    c, fake = setup
    c.post("/api/entries", json={"user": "Clerk", "entries": [ENTRY]})
    assert c.get("/api/status").json()["unsaved_changes"] is True and fake.saves == 0
    run_tick(c)  # nobody asked: the tool saves by itself
    s = c.get("/api/status").json()
    assert fake.saves == 1 and s["unsaved_changes"] is False and s["saved_at"] and s["autosave"] is True
    run_tick(c)
    assert fake.saves == 1  # nothing new: no second save


def test_the_switch_turns_it_off_and_is_kept(setup):
    c, fake = setup
    assert c.post("/api/autosave", json={"on": False}).json() == {"autosave": False}
    c.post("/api/entries", json={"user": "Clerk", "entries": [ENTRY]})
    run_tick(c)
    assert fake.saves == 0 and c.get("/api/status").json()["autosave"] is False
    c.post("/api/autosave", json={"on": True})
    run_tick(c)
    assert fake.saves == 1


def test_changes_typed_in_excel_are_saved_too(setup, monkeypatch):
    c, fake = setup
    svc = c.app.state.get_service()
    monkeypatch.setattr(svc, "mode", "live")
    monkeypatch.setattr(fake, "has_unsaved_changes", lambda: True, raising=False)
    run_tick(c)
    assert fake.saves == 1  # Excel said it held unsaved changes


def test_excel_busy_is_tried_again_later(setup, monkeypatch):
    c, fake = setup
    from app.excel.adapter import WorkbookBusyError

    c.post("/api/entries", json={"user": "Clerk", "entries": [ENTRY]})
    monkeypatch.setattr(fake, "save", lambda: (_ for _ in ()).throw(WorkbookBusyError("Excel is busy.")))
    state = {}
    run_tick(c, state)
    s = c.get("/api/status").json()
    assert s["unsaved_changes"] is True and "Auto-save waiting" in s["save_note"]
