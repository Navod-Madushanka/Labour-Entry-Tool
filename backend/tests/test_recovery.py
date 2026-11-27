"""Recovery from the change log: entries the tool pushed that are not in the workbook any more
(a crash before a save, Excel's recovered copy, an older file) go back on the manpower sheet;
changed ones are left alone; save tracking says when a file opened misses pushes. Made-up data."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.audit.backups import BackupManager
from app.audit.store import AuditStore
from app.config import Config
from app.domain.writes import RangeWrite
from app.excel.fake_adapter import FakeWorkbook
from app.main import create_app
from app.recovery import family, missing_pushes
from app.service import EntryService

A = {"sheet": "1", "calling_name": "INB-01 CH", "time_in": 7, "time_out": 19,
     "activities": [{"code": "03-11-00-00", "hours": 11}], "acknowledged": ["W03"]}  # fmt: skip


@pytest.fixture
def setup(small_snapshot, tmp_path):
    fake = FakeWorkbook(small_snapshot)
    audit = AuditStore(tmp_path / "audit.sqlite")

    def factory(config):
        return EntryService(lambda: fake, config, audit, BackupManager(tmp_path / "b"))

    with TestClient(create_app(Config(month="2026-10"), service_factory=factory)) as c:
        yield c, fake, audit


def test_family_names():
    assert family("Labour Entry Sheet November  2026 - Supply(AutoRecovered).xlsb") == family(
        "Labour Entry Sheet November 2026 - Supply.xlsb"
    )
    assert family("X [Repaired].xlsb") == family("X (Recovered).xlsb") == family("x.xlsb")
    assert family("Supply.xlsb") != family("Company.xlsb")


def test_lost_entries_come_back_and_changed_ones_are_left(setup):
    c, fake, _ = setup
    res = c.post("/api/entries", json={"user": "Clerk", "entries": [A]}).json()
    assert res["status"] == "written"
    assert c.get("/api/recovery").json()["present"] == 1  # all there

    # a crash before a save: the block is back to what it was (nothing went through the tool)
    fake.write_ranges([RangeWrite(sheet="1", address="G16:H16", values=[[None, None]]),
                       RangeWrite(sheet="1", address="J16:K16", values=[[None, None]])])  # fmt: skip
    r = c.get("/api/recovery").json()
    assert r["present"] == 0 and len(r["lost"]) == 1 and r["pushes"] == 1
    lost = r["lost"][0]
    assert lost["calling_name"] == "INB-01 CH" and lost["user"] == "Clerk" and "07:00–19:00" in lost["what"]
    entry = lost["input"]
    assert (entry["time_in"], entry["time_out"], entry["activities"][0]["code"]) == (7, 19, "03-11-00-00")

    # put back and pushed again: present
    again = c.post("/api/entries", json={"user": "Clerk", "entries": [{**entry, "acknowledged": ["W03"]}]}).json()
    assert again["status"] == "written"
    assert c.get("/api/recovery").json()["lost"] == []

    # changed in Excel since: shown, not offered
    fake.write_ranges([RangeWrite(sheet="1", address="H16", values=[[18.0]])])
    r = c.get("/api/recovery").json()
    assert r["lost"] == [] and r["changed"][0]["why"] == "changed in Excel since the push"


def test_pushes_under_the_recovered_copys_name_count(setup, small_snapshot, tmp_path):
    """Nine days pushed into "… (AutoRecovered).xlsb", then the file opened: still found."""
    c, fake, audit = setup
    c.post("/api/entries", json={"user": "Clerk", "entries": [A]})
    with audit._db:  # the same push, as if made while Excel had its recovered copy open
        audit._db.execute("UPDATE batches SET workbook = ?", (Path(fake.name).stem + "(AutoRecovered).xlsb",))
    fake.write_ranges([RangeWrite(sheet="1", address="G16:H16", values=[[None, None]])])
    r = c.get("/api/recovery").json()
    assert len(r["lost"]) == 1 and r["other_names"][0].endswith("(AutoRecovered).xlsb")


def test_save_tracking_says_what_a_file_misses(small_snapshot, tmp_path):
    fake = FakeWorkbook(small_snapshot)
    fake.full_path = Path("C:/Labour/Supply.xlsb")
    audit = AuditStore(tmp_path / "audit.sqlite")
    from app.domain.writes import EntryInput

    s1 = EntryService(lambda: fake, Config(month="2026-10"), audit, BackupManager(tmp_path / "b"))
    assert s1.commit([EntryInput(**A)], "Clerk").status == "written"
    s1.save()  # the file has the first push
    second = EntryInput(sheet="1", calling_name="INC-02", time_in=7, time_out=21, overwrite=True,
                        activities=[{"code": "03-11-00-00", "hours": 13}])  # fmt: skip
    assert s1.commit([second], "Clerk").status == "written"  # never saved: then a crash
    s2 = EntryService(lambda: fake, Config(month="2026-10"), audit, BackupManager(tmp_path / "b"))
    s2.started_at = "9999"  # the next session
    gap = missing_pushes(s2, str(fake.full_path), s2.started_at)
    assert gap is not None and gap.count == 1
    assert s2.status().missing_pushes["count"] == 1
    assert missing_pushes(s2, "C:/Other.xlsb", s2.started_at) is None  # never saved there: no claim
