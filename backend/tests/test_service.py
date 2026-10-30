"""The write path on the fake workbook: commit, read-back, audit, backup, undo, save (Phase 2)."""

import asyncio
import os
import threading
import time

import pytest

from app.audit.backups import BackupManager
from app.audit.store import AuditStore, Change
from app.config import Config
from app.domain.writes import ActivityInput, EntryInput
from app.excel.adapter import NotConnectedError
from app.excel.fake_adapter import FakeWorkbook
from app.excel.worker import ExcelWorker
from app.service import EntryService

USER = "Navod"


def acts(hours, code="03-11-00-00"):
    return [ActivityInput(code=code, hours=hours)]


def entry(name="INB-01 CH", **kw):
    # INB-01 CH and INH-03 are the same person as INB-01 (7-19 on sheet 1): W03 acknowledged.
    base = dict(sheet="1", calling_name=name, time_in=7.0, time_out=19.0, acknowledged=["W03"],
                activities=[ActivityInput(code="03-11-00-00", hours=11.0)])  # fmt: skip
    return EntryInput(**{**base, **kw})


@pytest.fixture
def fake(small_snapshot):
    return FakeWorkbook(small_snapshot)


@pytest.fixture
def service(fake, tmp_path):
    config = Config(month="2026-10", backups={"dir": tmp_path / "backups", "keep": 3})
    return EntryService(lambda: fake, config, AuditStore(), BackupManager(tmp_path / "backups", 3))


def block(fake, sheet="1", address="G16:R20"):
    return fake.read_range(sheet, address)


# --- commit -----------------------------------------------------------------------------------


def test_commit_writes_reads_back_and_audits(service, fake, tmp_path):
    res = service.commit([entry()], USER)
    assert res.status == "written" and res.error is None
    assert fake.read_range("1", "G16:H16") == [[7.0, 19.0]]
    assert fake.read_range("1", "J16:K16") == [["03-11-00-00", 11.0]]
    [rb] = res.readback
    assert rb.ok and (rb.effective, rb.zidle, rb.ot) == (11.0, None, 3.0)
    # One batch with only the changed cells, before/after values kept.
    batch = service.audit.batch(res.batch_id)
    assert (batch.status, batch.user, batch.kind, batch.cells) == ("done", USER, "write", 4)
    assert batch.calling_names == ["INB-01 CH"] and batch.sheets == ["1"]
    assert Change(sheet="1", cell="K16", calling_name="INB-01 CH", old=None, new=11.0) in (
        service.audit.changes(res.batch_id)
    )
    # Unchanged ranges (L16, R16) are not written at all.
    assert [w.address for w in fake.batches[0]] == ["G16:H16", "J16:K20"]
    assert service.unsaved and res.backup and os.path.exists(res.backup)


def test_dry_run_and_rejections_write_nothing(service, fake):
    assert service.commit([entry()], USER, dry_run=True).status == "dry_run"
    res = service.commit([entry(name="INB-01")], USER)  # block has input: E08
    assert res.status == "rejected" and [i.rule for i in res.plans[0].blocking] == ["E08"]
    res = service.commit([entry(time_out=22.0, activities=acts(14.0))], USER)
    assert res.status == "rejected" and [i.rule for i in res.plans[0].unconfirmed] == ["W05"]
    assert service.commit([entry(), entry()], USER).status == "rejected"  # twice in one batch
    assert fake.batches == [] and fake.copies == [] and service.audit.recent() == []
    assert not service.unsaved


def test_acknowledged_warning_is_written(service, fake):
    res = service.commit(
        [entry(time_out=22.0, activities=acts(14.0), acknowledged=["W05", "W03"])], USER
    )
    assert res.status == "written" and res.readback[0].effective == 14.0


def test_unchanged_entry_is_not_written(service, fake):
    same = entry(name="INB-01", overwrite=True)  # block 0 already holds exactly this
    assert service.commit([same], USER).status == "unchanged"
    assert fake.batches == []


def test_user_required(service):
    with pytest.raises(ValueError):
        service.commit([entry()], " ")


def test_backup_once_per_session_and_pruned(service, fake, tmp_path):
    service.commit([entry()], USER)
    service.commit([entry(name="INH-03", time_out=12.0, activities=acts(5.0))], USER)
    assert len(fake.copies) == 1
    mgr = BackupManager(tmp_path / "backups", keep=3)
    for _ in range(4):
        mgr.make(fake.name, fake.save_copy)
    assert len(list((tmp_path / "backups").iterdir())) == 3


def test_busy_excel_fails_cleanly(service, fake):
    fake.busy_failures = 1
    res = service.commit([entry()], USER)
    assert res.status == "failed" and "busy" in res.error
    assert service.audit.batch(res.batch_id).status == "failed"
    assert block(fake)[0][:2] == [None, None]
    # Nothing reached the sheet, so there is nothing to undo.
    assert service.undo(res.batch_id, USER).status == "rejected"


class TamperingFake(FakeWorkbook):
    """Excel showing something other than the preview (e.g. a changed formula)."""

    def read_range(self, sheet, address):
        values = super().read_range(sheet, address)
        if address.startswith("A16:"):
            values[0][4] = 99.0  # E16
            values[0][9] = "3-11-00"  # J16 auto-converted
        return values


def test_read_back_mismatch_reported(small_snapshot, tmp_path):
    fake = TamperingFake(small_snapshot)
    svc = EntryService(lambda: fake, Config(month="2026-10"), AuditStore(),
                       BackupManager(tmp_path, 3))  # fmt: skip
    res = svc.commit([entry()], USER)
    [rb] = res.readback
    assert res.status == "written" and not rb.ok
    assert "J16 reads '3-11-00', wrote '03-11-00-00'" in rb.mismatches
    assert "Excel effective 99.0, preview 11.0" in rb.mismatches
    assert svc.audit.batch(res.batch_id).note == "1 read-back mismatches"


# --- undo -------------------------------------------------------------------------------------


def test_undo_restores_exact_old_values(service, fake):
    before = block(fake, address="G23:R27")  # INC-02: 7-22, add -1, remark "dinner"
    change = entry(name="INC-02", overwrite=True, time_out=21.0, activities=acts(13.0))
    res = service.commit([change], USER)
    assert res.status == "written" and block(fake, address="G23:R27") != before
    undo = service.undo(res.batch_id, USER)
    assert undo.status == "undone"
    assert block(fake, address="G23:R27") == before
    assert fake.read_day("1").entries[1].cached.effective == 13.0
    assert service.audit.batch(res.batch_id).undone_by == undo.undo_batch_id
    assert service.audit.batch(undo.undo_batch_id).undo_of == res.batch_id
    assert service.undo(res.batch_id, USER).status == "rejected"  # only once


def test_undo_clear(service, fake):
    before = block(fake, address="G9:R13")
    res = service.commit([EntryInput(sheet="1", calling_name="INB-01", overwrite=True)], USER)
    assert res.status == "written" and res.readback[0].ok
    assert fake.read_day("1").entries[0].calling_name == "INC-02"  # INB-01's block is empty now
    assert service.undo(res.batch_id, USER).status == "undone"
    assert block(fake, address="G9:R13") == before


def test_undo_refuses_when_cells_changed_since(service, fake):
    first = service.commit([entry()], USER)
    service.commit([entry(overwrite=True, time_out=21.0, activities=acts(13.0))], USER)
    res = service.undo(first.batch_id, USER)
    assert res.status == "conflict"
    assert "1!H16 changed since: now 21.0, wrote 19.0" in res.conflicts
    assert block(fake)[0][:2] == [7.0, 21.0]  # untouched


def test_undo_refuses_when_block_moved(service, fake):
    res = service.commit([entry()], USER)
    fake.grids["1"][(16, 1)] = "INB-77"  # a row inserted in Labour Detail shifts the blocks
    undo = service.undo(res.batch_id, USER)
    assert undo.status == "conflict" and "1!A16 is now 'INB-77'" in undo.conflicts[0]


# --- save, status ------------------------------------------------------------------------------


def test_save_and_status(service, fake):
    service.commit([entry()], USER)
    status = service.status()
    assert status.connected and status.unsaved_changes and status.backup
    service.save()
    assert fake.saves == 1 and not service.status().unsaved_changes


def test_status_when_excel_is_not_open(tmp_path):
    def connect():
        raise NotConnectedError("No open workbook matches 'Labour Entry Sheet *'.")

    svc = EntryService(connect, Config(month="2026-10"), AuditStore(), BackupManager(tmp_path))
    status = svc.status()
    assert not status.connected and "No open workbook" in status.error


# --- audit store, worker ------------------------------------------------------------------------


def test_audit_store_persists(tmp_path):
    db = tmp_path / "a" / "audit.sqlite"
    store = AuditStore(db)
    changes = [
        Change(sheet="3", cell="J9", calling_name="INB-01", old=None, new="03-11-00-00"),
        Change(sheet="3", cell="K9", old=True),
    ]
    batch_id = store.start("write", USER, "wb.xlsb", changes)
    store.finish(batch_id, "done")
    store.close()
    store = AuditStore(db)
    [b] = store.recent()
    assert (b.id, b.status, b.cells, b.workbook) == (batch_id, "done", 2, "wb.xlsb")
    assert [c.old for c in store.changes(batch_id)] == [None, True]  # types survive JSON


def test_worker_runs_jobs_in_order_on_one_thread():
    seen = []
    worker = ExcelWorker(init=lambda: seen.append(("init", threading.current_thread().name)))

    def job(i):
        time.sleep(0.01 * (3 - i))
        return threading.current_thread().name

    names = [worker.call(job, i) for i in range(3)]
    assert set(names) == {"excel-worker"} and seen == [("init", "excel-worker")]
    order = []
    futures = [worker.submit(order.append, i) for i in range(20)]
    for f in futures:
        f.result(1)
    assert order == list(range(20))
    with pytest.raises(ZeroDivisionError):
        worker.call(lambda: 1 / 0)
    assert asyncio.run(worker.run(lambda: 42)) == 42
    worker.stop()
    assert not worker.thread.is_alive()


# --- header fix ---------------------------------------------------------------------------------


def test_header_fix_and_undo(service, fake):
    fake.grids["1"][(3, 8)] = "Saturday"  # H3 wrong: 1 Oct 2026 is a Thursday
    fake.grids["1"][(4, 6)] = 2.0  # F4 wrong
    assert {i.rule for i in service.day_view("1", fresh=True).header_issues} == {"H02", "H03"}
    res = service.fix_header("1", ["day_type", "sheet_no", "date"], USER)
    assert res.status == "written"
    assert res.changes == {"H3": ("Saturday", "Normal Day"), "F4": (2.0, 1.0)}  # date was right
    assert service.day_view("1").header_issues == []
    assert fake.read_day("1").entries[0].cached.upload[6].ot == 3.0  # OT recalculated
    assert service.fix_header("1", ["day_type"], USER).status == "unchanged"
    undo = service.undo(res.batch_id, USER)
    assert undo.status == "undone"
    assert fake.read_range("1", "H3:H3") == [["Saturday"]] and fake.read_range("1", "F4:F4") == [
        [2.0]
    ]


def test_header_fix_rejects_unknown_fields(service):
    with pytest.raises(ValueError):
        service.fix_header("1", ["prepared_by"], USER)


def test_read_back_failure_after_a_good_write(small_snapshot, tmp_path):
    from app.excel.adapter import WorkbookBusyError

    class FlakyRead(FakeWorkbook):
        fail = False

        def read_range(self, sheet, address):
            if self.fail:
                raise WorkbookBusyError("Excel is busy.")
            return super().read_range(sheet, address)

        def write_ranges(self, writes):
            super().write_ranges(writes)
            self.fail = True  # Excel turns busy right after the write

    fake = FlakyRead(small_snapshot)
    svc = EntryService(lambda: fake, Config(month="2026-10"), AuditStore(), BackupManager(tmp_path))
    res = svc.commit([entry()], USER)
    assert res.status == "written" and "read-back failed" in res.error
    assert svc.audit.batch(res.batch_id).status == "done"  # not left pending
    fake.fail = False
    assert fake.read_range("1", "G16:H16") == [[7.0, 19.0]]


# --- changes made in Excel while the tool is open -----------------------------------------------


def test_preview_sees_an_activity_code_added_in_excel(service, fake):
    new = entry(activities=acts(11.0, code="99-99-99-99"))
    [plan] = service.preview([new])
    assert "E04" in {i.rule for i in plan.issues}  # not in the list yet
    # Someone adds the code to Labour Detail's activity list in Excel.
    _row, c = service.template.activity_start
    last = max(row for (row, col) in fake.master_grid if col == c)
    fake.master_grid[(last + 1, c)] = "99-99-99-99"
    service._last_reread = float("-inf")  # the first lookup above re-read already; allow another
    [plan] = service.preview([new])
    assert "E04" not in {i.rule for i in plan.issues}
    assert "99-99-99-99" in service.master_view().activities


def test_unknown_code_rereads_at_most_every_few_seconds(service, fake, monkeypatch):
    reads = []
    real = fake.read_master
    monkeypatch.setattr(fake, "read_master", lambda: reads.append(1) or real())
    service.master()  # cached
    bad = entry(activities=acts(11.0, code="00-00-00-0"))
    for _ in range(5):  # a code typed letter by letter
        service.preview([bad])
    assert len(reads) == 2  # the first read, then one re-read


def test_very_long_day_is_written_without_confirmation(service, fake):
    """7:00 to 06:00 next morning happens on site: shown as a note, never holds up the push."""
    long_day = entry(time_out=30.0, activities=acts(21.0))
    [plan] = service.preview([long_day])
    w01 = [i for i in plan.issues if i.rule == "W01"]
    assert w01 and w01[0].severity == "INFO" and plan.ok
    res = service.commit([long_day], USER)
    assert res.status == "written" and res.readback[0].effective == 21.0


def test_live_snapshot_reports_progress(small_snapshot, tmp_path):
    """Reading through Excel goes sheet by sheet and says how far it has got (the start page shows
    it); demo copies are read at once."""
    from app.audit.backups import BackupManager
    from app.audit.store import AuditStore
    from app.config import Config
    from app.excel.fake_adapter import FakeWorkbook
    from app.service import EntryService

    fake = FakeWorkbook(small_snapshot, Config(month="2026-10").template)
    seen = []
    service = EntryService(lambda: fake, Config(month="2026-10"), AuditStore(tmp_path / "a.sqlite"),
                           BackupManager(tmp_path / "b", 2))  # fmt: skip
    read_day = fake.read_day
    fake.read_day = lambda sheet: (seen.append(dict(service.progress)), read_day(sheet))[1]
    snap = service.snapshot()
    assert len(snap.days) == len(small_snapshot.days)
    assert seen[0] == {"done": 1, "total": len(small_snapshot.days) + 1, "step": "sheet 1"}
    assert service.progress is None  # done
