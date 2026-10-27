"""Phase 2 smoke test against a COPY of the entry workbook open in Excel (PLAN.md §6, §9).

Writes a few test entries into empty blocks of an empty day sheet, checks Excel's recalculated
values against the tool's preview, undoes them and checks every cell is back to what it was. It
also checks that a backup copy was made and that Excel refuses a write to a locked formula cell.

    1. Copy the workbook, e.g. "Labour Entry Sheet October 2026 - INDIAN (2) - COPY.xlsb".
    2. Open ONLY the copy in Excel.
    3. python scripts/excel_smoke.py --i-am-using-a-copy
    4. Close the copy without saving. Send me smoke_report.json (no names or IDs in it).

``--fake fixtures/sanitized/x.json`` runs the same steps on the in-memory fake (no Excel).
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

from app.audit.backups import BackupManager
from app.audit.store import AuditStore
from app.config import load_config
from app.domain.validators import RULES, check_header
from app.domain.writes import ActivityInput, EntryInput, RangeWrite
from app.excel.adapter import ProtectionError, WorkbookError
from app.excel.worker import ExcelWorker
from app.service import EntryService

WARNINGS = [r for r, rule in RULES.items() if rule.severity == "WARN"]


def cases(codes: list[str]) -> list[dict]:
    """(In, Out, additional, activities, remark) covering the §5.5 rules and 5 activity lines."""
    a, b = codes[0], codes[1]
    return [
        dict(time_in=7.0, time_out=19.0, activities=[(a, 11.0)]),
        dict(time_in=7.0, time_out=22.0, additional=-1.0, activities=[(a, 8.0), (b, 5.0)],
             remark="smoke test"),
        dict(time_in=7.0, time_out=30.0, activities=[(a, 21.0)]),  # overnight
        dict(time_in=18.0, time_out=23.5, activities=[(a, 3.5)]),
        dict(time_in=7.0, time_out=12.0, activities=[(a, 2.0)]),  # 3 h ZIDLE
        dict(time_in=7.0, time_out=19.0, activities=[(a, 2.0), (b, 2.0), (a, 2.0), (b, 2.0),
                                                     (a, 3.0)]),
    ]  # fmt: skip


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--i-am-using-a-copy", action="store_true", help="required for real Excel")
    ap.add_argument("--pattern", help="workbook name pattern (default: config workbook_pattern)")
    ap.add_argument(
        "--sheet", help="day sheet to use (default: first empty sheet with a good header)"
    )
    ap.add_argument("--config", type=Path)
    ap.add_argument("--fake", type=Path, help="run on a snapshot JSON instead of Excel")
    ap.add_argument("--report", type=Path, default=Path("smoke_report.json"))
    args = ap.parse_args(argv)

    config = load_config(args.config)
    if args.pattern:
        config = config.model_copy(update={"workbook_pattern": args.pattern})
    work = Path(tempfile.mkdtemp(prefix="labour_smoke_"))
    backups = BackupManager(work / "backups", keep=3)

    if args.fake:
        from app.excel.fake_adapter import FakeWorkbook, load_snapshot

        fake = FakeWorkbook(load_snapshot(args.fake), config.template)
        connect, worker = (lambda: fake), ExcelWorker()
    else:
        if not args.i_am_using_a_copy:
            ap.error("open a COPY of the workbook in Excel and pass --i-am-using-a-copy")
        from app.excel import xlwings_adapter as xa

        connect = lambda: xa.connect(config)  # noqa: E731
        worker = ExcelWorker(init=xa.com_init, cleanup=xa.com_uninit)

    service = EntryService(connect, config, AuditStore(work / "audit.sqlite"), backups)
    report: dict = {"steps": [], "ok": True}

    def step(name: str, ok: bool, **info) -> None:
        report["steps"].append({"step": name, "ok": ok, **info})
        report["ok"] &= ok
        extra = " ".join(f"{k}={v}" for k, v in info.items())
        print(f"[{'PASS' if ok else 'FAIL'}] {name}  {extra}")

    try:
        run(service, worker, config, args.sheet, step, report)
    except WorkbookError as exc:
        step("workbook", False, error=str(exc))
    finally:
        worker.stop()
    args.report.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"\n{'ALL PASSED' if report['ok'] else 'SOME STEPS FAILED'}. Report: {args.report}")
    print(f"Backups and audit for this run: {work}")
    if not args.fake:
        print("Now close the workbook copy WITHOUT saving.")
    return 0 if report["ok"] else 1


def run(service: EntryService, worker: ExcelWorker, config, sheet_arg, step, report) -> None:
    call = worker.call
    t = config.template
    started = time.perf_counter()
    status = call(service.status)
    step("attach", status.connected, workbook=status.workbook, error=status.error)
    if not status.connected:
        return
    report["workbook"] = status.workbook

    wb = service.workbook  # attached; use only through worker.call below
    master = call(wb.read_master)
    seconds = round(time.perf_counter() - started, 2)
    step("read master", bool(master.workers), workers=len(master.workers),
         activities=len(master.activities), seconds=seconds)  # fmt: skip
    codes = list(dict.fromkeys(a.code for a in master.activities))

    # An empty sheet with a correct header, and empty blocks on it.
    day = None
    for name in [sheet_arg] if sheet_arg else t.day_sheet_names():
        t0 = time.perf_counter()
        d = call(wb.read_day, name)
        seconds = round(time.perf_counter() - t0, 2)
        if sheet_arg or (not d.entries and not check_header(d.header, config.month_start,
                                                              config.holidays, t)):  # fmt: skip
            day = d
            step("read day sheet", True, sheet=name, entries=len(d.entries), seconds=seconds)
            break
    if day is None:
        step("find an empty day sheet", False, hint="pass --sheet N")
        return
    used = {e.block for e in day.entries}
    names = [n for k, n in enumerate(day.block_names) if n and k not in used][:6]
    tests = [
        EntryInput(sheet=day.header.sheet, calling_name=n, acknowledged=WARNINGS,
                   activities=[ActivityInput(code=c, hours=h) for c, h in case.pop("activities")],
                   **case)
        for n, case in zip(names, cases(codes), strict=False)
    ]  # fmt: skip
    rows = {}
    for e in tests:
        plan = call(service.preview, [e])[0]
        rows[e.calling_name] = plan.row
    before = {n: call(wb.read_range, day.header.sheet, f"A{r}:R{r + 6}") for n, r in rows.items()}

    plans = call(service.preview, tests)
    blocking = [(p.input.calling_name, [i.rule for i in p.blocking]) for p in plans if not p.ok]
    step("preview", all(p.ok for p in plans), entries=len(plans), blocking=blocking)

    # One entry alone (single-write time, PLAN.md §8), then the rest as one batch.
    batches = []
    for label, group in (("write 1 entry", tests[:1]), ("write batch", tests[1:])):
        res = call(service.commit, group, "smoke-test")
        bad = [(r.calling_name, r.mismatches) for r in res.readback if not r.ok]
        step(label, res.status == "written" and not bad, status=res.status, seconds=res.seconds,
             error=res.error, mismatches=bad)  # fmt: skip
        report.setdefault("readback", []).extend(r.model_dump() for r in res.readback)
        if res.batch_id:
            batches.append(res.batch_id)
        if res.status != "written":
            break

    backup = service.backups.session_backup(status.workbook)
    step("backup copy", bool(backup and backup.exists() and backup.stat().st_size > 0),
         path=backup, bytes=backup.stat().st_size if backup and backup.exists() else 0)  # fmt: skip

    # Excel itself must refuse a locked cell (column A holds a formula); the tool never writes
    # there, so this probe bypasses its guard and goes straight to the workbook.
    r0 = next(iter(rows.values()))
    probe = RangeWrite(sheet=day.header.sheet, address=f"{t.cols.calling_name}{r0}", values=[["X"]])
    try:
        call(wb.write_ranges, [probe])
        step("sheet protection", False, error="Excel accepted a write to a formula cell!")
    except ProtectionError as exc:
        step("sheet protection", True, refused=str(exc)[:80])
    except WorkbookError as exc:
        step("sheet protection", True, refused=f"{type(exc).__name__}: {str(exc)[:80]}")

    for batch_id in reversed(batches):
        t0 = time.perf_counter()
        res = call(service.undo, batch_id, "smoke-test")
        seconds = round(time.perf_counter() - t0, 2)
        step(f"undo batch {batch_id}", res.status == "undone", seconds=seconds, error=res.error,
             conflicts=res.conflicts)  # fmt: skip
    after = {n: call(wb.read_range, day.header.sheet, f"A{r}:R{r + 6}") for n, r in rows.items()}
    changed = [n for n in rows if after[n] != before[n]]
    step("undo restored every cell", not changed, blocks=len(rows), changed=changed)
    report["total_seconds"] = round(time.perf_counter() - started, 2)


if __name__ == "__main__":
    sys.exit(main())
