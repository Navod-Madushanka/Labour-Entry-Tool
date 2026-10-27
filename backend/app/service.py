"""Entry service: preview, commit, read-back, undo and save against a live workbook (PLAN.md §8).

Every method here touches the workbook, so the API runs them on the ``ExcelWorker`` thread, one at
a time. A commit re-reads each day sheet it writes to (E07/E08 on fresh data), plans every entry,
and writes only when all of them are ``ok``: backup first, then the audit rows, then one batched
write, then a read-back that compares Excel's results with the preview.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, Field

from app.audit.backups import BackupManager
from app.audit.store import AuditStore, Batch, Change
from app.config import Config
from app.domain.codes import (
    EmployeeCodeStatus,
    employee_code_status,
    is_excel_error,
    person_key,
)
from app.domain.crosscheck import add_cross_entry_issues
from app.domain.models import (
    CellValue,
    Computed,
    DayHeader,
    DaySheet,
    Entry,
    Issue,
    MasterData,
    as_number,
)
from app.domain.rules import compute_entry, same_hours
from app.domain.validators import (
    calendar_day_type,
    check_entry,
    check_header,
    intended_date,
    make_issue,
)
from app.domain.writes import (
    ActivityInput,
    EntryInput,
    EntryPlan,
    RangeWrite,
    block_writes,
    header_fix_cells,
    plan_entry,
    same_value,
    unwritable_cells,
)
from app.excel.adapter import LiveWorkbook, WorkbookError
from app.excel.grid import date_to_excel_serial
from app.excel.refs import col_to_index, index_to_col, parse_cell


class ReadBack(BaseModel):
    sheet: str
    calling_name: str
    row: int
    ok: bool
    effective: CellValue = None  # what Excel shows after recalculation
    zidle: CellValue = None
    ot: CellValue = None
    mismatches: list[str] = Field(default_factory=list)


class CommitResult(BaseModel):
    status: Literal["rejected", "dry_run", "unchanged", "written", "failed"]
    plans: list[EntryPlan]
    batch_id: int | None = None
    backup: str | None = None
    readback: list[ReadBack] = Field(default_factory=list)
    error: str | None = None
    seconds: float = 0.0


class UndoResult(BaseModel):
    status: Literal["undone", "conflict", "rejected", "failed"]
    batch_id: int
    undo_batch_id: int | None = None
    conflicts: list[str] = Field(default_factory=list)
    error: str | None = None
    note: str | None = None


class HeaderFixResult(BaseModel):
    status: Literal["written", "unchanged", "rejected", "failed"]
    batch_id: int | None = None
    changes: dict[str, tuple[CellValue, CellValue]] = Field(default_factory=dict)
    error: str | None = None


class CodeWrite(BaseModel):
    row: int  # Labour Detail row
    calling_name: str  # must still be on that row
    code: str


class CodeWriteResult(BaseModel):
    status: Literal["written", "rejected", "failed"]
    batch_id: int | None = None
    written: dict[str, tuple[CellValue, CellValue]] = Field(
        default_factory=dict
    )  # cell -> old, new
    problems: list[str] = Field(default_factory=list)
    mismatches: list[str] = Field(default_factory=list)  # read-back
    error: str | None = None


class Status(BaseModel):
    connected: bool
    mode: Literal["live", "demo"] = "live"
    workbook: str | None = None
    error: str | None = None
    unsaved_changes: bool = False
    backup: str | None = None


class WorkerView(BaseModel):
    row: int
    block: int
    calling_name: str
    person: str  # base code: a calling name and its role-suffix codes share it
    name: CellValue = None
    trade_group: CellValue = None
    employee_code: CellValue = None
    code_status: EmployeeCodeStatus


class MasterView(BaseModel):
    workbook: str
    month: str
    holidays: list
    sheets: list[str]
    workers: list[WorkerView]
    activities: list[str]  # trimmed, unique, in list order
    day_types: list[str]


class EntryView(BaseModel):
    entry: Entry
    computed: Computed | None = None
    issues: list[Issue] = Field(default_factory=list)


class DayView(BaseModel):
    header: DayHeader
    expected_date: str | None = None
    expected_day_type: str | None = None
    header_issues: list[Issue] = Field(default_factory=list)
    entries: list[EntryView] = Field(default_factory=list)


class EntryService:
    def __init__(
        self,
        connect: Callable[[], LiveWorkbook],
        config: Config,
        audit: AuditStore,
        backups: BackupManager,
        mode: Literal["live", "demo"] = "live",
    ):
        self._connect = connect
        self.mode = mode
        self.config = config
        self.template = config.template
        self.audit = audit
        self.backups = backups
        self._workbook: LiveWorkbook | None = None
        self._master: MasterData | None = None
        self._days: dict[str, DaySheet] = {}
        self.unsaved = False

    # --- connection ---

    @property
    def workbook(self) -> LiveWorkbook:
        if self._workbook is None:
            self._workbook = self._connect()
        return self._workbook

    def disconnect(self) -> None:
        self._workbook = None
        self._master = None
        self._days.clear()

    # --- cached reads (previews); writes always re-read ---

    def master(self, fresh: bool = False) -> MasterData:
        if fresh or self._master is None:
            self._master = self.workbook.read_master()
        return self._master

    def day(self, sheet: str, fresh: bool = False) -> DaySheet:
        if sheet not in self.workbook.day_sheet_names():
            raise KeyError(f"no day sheet {sheet!r}")
        if fresh or sheet not in self._days:
            self._days[sheet] = self.workbook.read_day(sheet)
        return self._days[sheet]

    def _forget(self, sheets) -> None:
        for sheet in sheets:
            self._days.pop(sheet, None)

    def master_view(self, fresh: bool = False) -> MasterView:
        m, t = self.master(fresh), self.template
        return MasterView(
            workbook=self.workbook.name,
            month=self.config.month,
            holidays=self.config.holidays,
            sheets=self.workbook.day_sheet_names(),
            workers=[
                WorkerView(row=w.row, block=t.block_for_master_row(w.row),
                           calling_name=w.calling_name, person=person_key(w.calling_name),
                           name=w.name, trade_group=w.trade_group,
                           employee_code=w.employee_code,
                           code_status=employee_code_status(w.employee_code))
                for w in m.workers
            ],
            activities=list(dict.fromkeys(a.code for a in m.activities)),
            day_types=m.day_types,
        )  # fmt: skip

    def day_view(self, sheet: str, fresh: bool = False) -> DayView:
        day, t = self.day(sheet, fresh), self.template
        codes = {a.code for a in self.master().activities}
        month, holidays = self.config.month_start, self.config.holidays
        expected = intended_date(sheet, month)
        return DayView(
            header=day.header,
            expected_date=expected.isoformat() if expected else None,
            expected_day_type=calendar_day_type(expected, holidays) if expected else None,
            header_issues=check_header(day.header, month, holidays, t),
            entries=[
                EntryView(entry=e, computed=compute_entry(e, day.header.day_type),
                          issues=check_entry(e, day.header.day_type, codes, t))
                for e in day.entries
            ],
        )  # fmt: skip

    def status(self) -> Status:
        try:
            wb = self.workbook
        except WorkbookError as exc:
            return Status(connected=False, mode=self.mode, error=str(exc))
        backup = self.backups.session_backup(wb.name)
        return Status(connected=True, mode=self.mode, workbook=wb.name,
                      unsaved_changes=self.unsaved,
                      backup=str(backup) if backup else None)  # fmt: skip

    # --- preview / commit ---

    def preview(self, entries: list[EntryInput], fresh: bool = False) -> list[EntryPlan]:
        """Plans against the cached sheets (fast enough to run while typing)."""
        return self._plan(entries, self.master(fresh), fresh)

    def commit(self, entries: list[EntryInput], user: str, dry_run: bool = False) -> CommitResult:
        started = time.perf_counter()
        if not user.strip():
            raise ValueError("a user name is required for writes")
        wb = self.workbook
        plans = self._plan(entries, self.master(fresh=True), fresh=True)

        def result(status, **kw) -> CommitResult:
            return CommitResult(status=status, plans=plans,
                                seconds=round(time.perf_counter() - started, 3), **kw)  # fmt: skip

        if not plans or not all(p.ok for p in plans):
            return result("rejected")
        if dry_run:
            return result("dry_run")
        changed = [p for p in plans if p.changes]
        if not changed:
            return result("unchanged")
        writes = [w for p in changed for w in p.writes if _range_changes(w, p.old)]
        if bad := unwritable_cells(writes, self.template):  # last line of defence (E09)
            raise RuntimeError(f"refusing to write outside the input cells: {bad}")

        try:
            backup = self.backups.ensure(wb.name, wb.save_copy)
        except (OSError, WorkbookError) as exc:
            return result("failed", error=f"Backup failed, nothing written: {exc}")
        changes = [
            Change(sheet=p.input.sheet, cell=cell, calling_name=p.input.calling_name,
                   old=old, new=new)
            for p in changed for cell, (old, new) in p.changes.items()
        ]  # fmt: skip
        batch_id = self.audit.start("write", user, wb.name, changes)
        self._forget({w.sheet for w in writes})  # cached copies are stale from here on
        try:
            wb.write_ranges(writes)
        except WorkbookError as exc:
            self.unsaved = True  # part of the batch may be in; undo restores it from the audit
            self.audit.finish(batch_id, "failed", str(exc))
            return result("failed", batch_id=batch_id, backup=str(backup), error=str(exc))
        self.unsaved = True
        readback = [self._read_back(p) for p in changed]
        bad_reads = sum(not r.ok for r in readback)
        self.audit.finish(
            batch_id, "done", f"{bad_reads} read-back mismatches" if bad_reads else None
        )
        return result("written", batch_id=batch_id, backup=str(backup), readback=readback)

    def _plan(
        self, entries: list[EntryInput], master: MasterData, fresh: bool = False
    ) -> list[EntryPlan]:
        codes = {a.code for a in master.activities}
        days = {sheet: self.day(sheet, fresh) for sheet in {e.sheet for e in entries}}
        plans, seen = [], set()
        for e in entries:
            plan = plan_entry(e, days[e.sheet], codes, self.config.month_start,
                              self.config.holidays, self.template)  # fmt: skip
            key = (e.sheet, e.calling_name)
            if key in seen:
                plan.issues.append(make_issue("E07", f"{e.calling_name} is entered twice in this "
                                              f"batch for sheet {e.sheet}.", sheet=e.sheet,
                                              calling_name=e.calling_name))  # fmt: skip
            seen.add(key)
            plans.append(plan)
        names = set(self.workbook.day_sheet_names())
        around = {str(int(s) + d) for s in days if s.isdigit() for d in (-1, 1)} & names
        context = {**{s: self.day(s) for s in around - set(days)}, **days}
        add_cross_entry_issues(plans, context, master, self.template)
        return plans

    def _read_back(self, plan: EntryPlan) -> ReadBack:
        """Excel's recalculated E, ZIDLE and OT plus the written inputs, against the plan."""
        t, r = self.template, plan.row
        last_col = max(col_to_index(v) for v in t.cols.model_dump().values())
        values = self.workbook.read_range(
            plan.input.sheet, f"A{r}:{index_to_col(last_col)}{r + t.block_size - 1}"
        )

        def at(cell: str) -> CellValue:
            row, col = parse_cell(cell)
            return values[row - r][col - 1]

        c = t.cols
        effective = at(f"{c.effective}{r}")
        zidle = at(f"{c.upload_hours}{r + t.zidle_row - 1}")
        ot = at(f"{c.upload_ot}{r + t.ot_row - 1}")
        mismatches = [
            f"{cell} reads {at(cell)!r}, wrote {value!r}"
            for w in plan.writes for cell, value in w.cells() if not same_value(at(cell), value)
        ]  # fmt: skip
        p = plan.preview
        if p is not None:
            for label, excel, mine in (("effective", effective, p.effective),
                                       ("ZIDLE", zidle, p.zidle), ("OT", ot, p.ot)):  # fmt: skip
                if not same_hours(as_number(excel), mine):
                    mismatches.append(f"Excel {label} {excel!r}, preview {mine!r}")
        elif not all(v is None for v in (effective, zidle, ot)):  # cleared block
            mismatches.append(f"cleared, but Excel still shows E={effective!r}")
        return ReadBack(sheet=plan.input.sheet, calling_name=plan.input.calling_name, row=r,
                        ok=not mismatches, effective=effective, zidle=zidle, ot=ot,
                        mismatches=mismatches)  # fmt: skip

    # --- undo ---

    def undo(self, batch_id: int, user: str) -> UndoResult:
        if not user.strip():
            raise ValueError("a user name is required for undo")

        def reject(error: str) -> UndoResult:
            return UndoResult(status="rejected", batch_id=batch_id, error=error)

        batch = self.audit.batch(batch_id)
        if batch is None or batch.kind != "write":
            return reject("No such write batch.")
        if batch.undone_by is not None:
            return reject(f"Already undone by batch {batch.undone_by}.")
        wb = self.workbook
        if batch.workbook != wb.name:
            return reject(f"Batch was written to {batch.workbook}, not {wb.name}.")

        t = self.template
        header_cells = set(header_fix_cells(t).values())
        by_block: dict[tuple[str, int], list[Change]] = {}
        header_changes: list[Change] = []
        code_changes: list[Change] = []
        for ch in self.audit.changes(batch_id):
            if ch.sheet == t.master_sheet:
                code_changes.append(ch)
                continue
            if ch.cell in header_cells:
                header_changes.append(ch)
                continue
            row = parse_cell(ch.cell)[0]
            first = row - (row - t.first_block_row) % t.block_size
            by_block.setdefault((ch.sheet, first), []).append(ch)

        writes: list[RangeWrite] = []
        undo_changes: list[Change] = []
        conflicts: list[str] = []
        for ch in header_changes:  # header fixes: cell by cell
            [[now]] = self.workbook.read_range(ch.sheet, ch.cell)
            if same_value(now, ch.old):
                continue
            if not same_value(now, ch.new):
                conflicts.append(
                    f"{ch.sheet}!{ch.cell} changed since: now {now!r}, wrote {ch.new!r}"
                )
                continue
            writes.append(RangeWrite(sheet=ch.sheet, address=ch.cell, values=[[ch.old]]))
            undo_changes.append(Change(sheet=ch.sheet, cell=ch.cell, old=now, new=ch.old))
        lost_formulas = 0
        for ch in code_changes:  # Labour Detail codes: cell by cell, row must not have moved
            row = parse_cell(ch.cell)[0]
            name_cell = f"{t.master_cols.calling_name}{row}"
            [[name]] = self.workbook.read_range(ch.sheet, name_cell)
            [[now]] = self.workbook.read_range(ch.sheet, ch.cell)
            if name != ch.calling_name:
                conflicts.append(f"{ch.sheet}!{name_cell} is now {name!r}, was {ch.calling_name!r}")
                continue
            if not same_value(now, ch.new):
                if not same_value(now, ch.old):
                    conflicts.append(f"{ch.sheet}!{ch.cell} changed since: now {now!r}, "
                                     f"wrote {ch.new!r}")  # fmt: skip
                continue
            old = ch.old
            if is_excel_error(old):  # was a lookup formula; the tool never writes formulas
                old, lost_formulas = None, lost_formulas + 1
            writes.append(RangeWrite(sheet=ch.sheet, address=ch.cell, values=[[old]]))
            undo_changes.append(Change(sheet=ch.sheet, cell=ch.cell, calling_name=ch.calling_name,
                                       old=now, new=old))  # fmt: skip
        for (sheet, r), changes in by_block.items():
            current = self._read_inputs(sheet, r)
            name = changes[0].calling_name
            if current["name"] != name:  # E07: the block now belongs to someone else
                conflicts.append(f"{sheet}!A{r} is now {current['name']!r}, was {name!r}")
                continue
            target = dict(current["cells"])
            for ch in changes:
                now = current["cells"][ch.cell]
                if same_value(now, ch.old):
                    continue  # never written (failed batch) or already back
                if not same_value(now, ch.new):
                    conflicts.append(f"{sheet}!{ch.cell} changed since: now {now!r}, "
                                     f"wrote {ch.new!r}")  # fmt: skip
                    continue
                target[ch.cell] = ch.old
                undo_changes.append(Change(sheet=sheet, cell=ch.cell, calling_name=name,
                                           old=now, new=ch.old))  # fmt: skip
            writes += self._block_ranges(sheet, r, name, target)
        if conflicts:
            return UndoResult(status="conflict", batch_id=batch_id, conflicts=conflicts)
        if not undo_changes:
            return reject("Nothing to undo: the cells already hold the old values.")
        allow = {"allow_header": bool(header_changes), "allow_codes": bool(code_changes)}
        if bad := unwritable_cells(writes, t, **allow):
            raise RuntimeError(f"refusing to write outside the input cells: {bad}")
        try:
            self.backups.ensure(wb.name, wb.save_copy)
        except (OSError, WorkbookError) as exc:
            return UndoResult(status="failed", batch_id=batch_id, error=f"Backup failed: {exc}")
        undo_id = self.audit.start("undo", user, wb.name, undo_changes, undo_of=batch_id)
        self._forget({w.sheet for w in writes})
        if code_changes:
            self._master = None
            self._days.clear()
        try:
            wb.write_ranges(writes)
        except WorkbookError as exc:
            self.unsaved = True
            self.audit.finish(undo_id, "failed", str(exc))
            return UndoResult(status="failed", batch_id=batch_id, undo_batch_id=undo_id,
                              error=str(exc))  # fmt: skip
        self.unsaved = True
        self.audit.finish(undo_id, "done")
        note = (f"{lost_formulas} cell(s) held a broken lookup formula (#N/A); they are blank now. "
                "The backup copy still has the formulas.") if lost_formulas else None  # fmt: skip
        return UndoResult(status="undone", batch_id=batch_id, undo_batch_id=undo_id, note=note)

    def _read_inputs(self, sheet: str, r: int) -> dict:
        """Column A and every input cell of the block starting at row r, in one read."""
        t, c = self.template, self.template.cols
        n = t.activity_rows[1] - t.activity_rows[0] + 1
        last_col = max(col_to_index(x) for x in (c.time_in, c.time_out, c.activity, c.hours,
                                                 c.additional, c.remarks))  # fmt: skip
        values = self.workbook.read_range(sheet, f"A{r}:{index_to_col(last_col)}{r + n - 1}")

        def at(col: str, row: int) -> CellValue:
            return values[row - r][col_to_index(col) - 1]

        cells = {
            f"{col}{r}": at(col, r) for col in (c.time_in, c.time_out, c.additional, c.remarks)
        }
        for i in range(n):
            cells[f"{c.activity}{r + i}"] = at(c.activity, r + i)
            cells[f"{c.hours}{r + i}"] = at(c.hours, r + i)
        name = at(c.calling_name, r)
        return {"name": name if isinstance(name, str) else None, "cells": cells}

    def _block_ranges(
        self, sheet: str, r: int, name: str | None, cells: dict[str, CellValue]
    ) -> list[RangeWrite]:
        """The four block ranges holding ``cells`` (the whole block's inputs)."""
        c, n = (
            self.template.cols,
            self.template.activity_rows[1] - self.template.activity_rows[0] + 1,
        )
        entry = EntryInput.model_construct(
            sheet=sheet, calling_name=name or "", time_in=cells[f"{c.time_in}{r}"],
            time_out=cells[f"{c.time_out}{r}"], additional=cells[f"{c.additional}{r}"],
            remark=cells[f"{c.remarks}{r}"],
            activities=[ActivityInput.model_construct(code=cells[f"{c.activity}{r + i}"],
                                                      hours=cells[f"{c.hours}{r + i}"])
                        for i in range(n)],
        )  # fmt: skip
        writes = block_writes(entry, sheet, r, self.template)
        # block_writes trims codes; undo must restore exactly what was there.
        for i in range(n):
            writes[1].values[i][0] = cells[f"{c.activity}{r + i}"]
        return writes

    # --- header fix (H01-H03; needs the user's explicit approval, PLAN.md §2 rule 2) ---

    def fix_header(self, sheet: str, fields: list[str], user: str) -> HeaderFixResult:
        """Write the expected date (F3), day type (H3) and/or sheet number (F4) of a day sheet."""
        if not user.strip():
            raise ValueError("a user name is required for writes")
        cells = header_fix_cells(self.template)
        if unknown := set(fields) - set(cells):
            raise ValueError(f"unknown header fields: {sorted(unknown)}")
        expected = intended_date(sheet, self.config.month_start)
        if expected is None:
            return HeaderFixResult(status="rejected", error=f"Sheet {sheet} is not a day of "
                                   f"{self.config.month}.")  # fmt: skip
        wb = self.workbook
        h = self.day(sheet, fresh=True).header
        current = {"date": h.date_raw, "day_type": h.day_type, "sheet_no": h.sheet_no}
        wanted = {
            "date": date_to_excel_serial(expected),
            "day_type": calendar_day_type(expected, self.config.holidays),
            "sheet_no": float(sheet),
        }
        changes = [
            Change(sheet=sheet, cell=cells[f], old=current[f], new=wanted[f])
            for f in fields if not same_value(current[f], wanted[f])
        ]  # fmt: skip
        if not changes:
            return HeaderFixResult(status="unchanged")
        writes = [RangeWrite(sheet=sheet, address=c.cell, values=[[c.new]]) for c in changes]
        if bad := unwritable_cells(writes, self.template, allow_header=True):
            raise RuntimeError(f"refusing to write outside the header cells: {bad}")
        try:
            self.backups.ensure(wb.name, wb.save_copy)
        except (OSError, WorkbookError) as exc:
            return HeaderFixResult(status="failed", error=f"Backup failed, nothing written: {exc}")
        batch_id = self.audit.start("write", user, wb.name, changes)
        self._forget({sheet})
        result = {c.cell: (c.old, c.new) for c in changes}
        try:
            wb.write_ranges(writes)
        except WorkbookError as exc:
            self.unsaved = True
            self.audit.finish(batch_id, "failed", str(exc))
            return HeaderFixResult(status="failed", batch_id=batch_id, changes=result,
                                   error=str(exc))  # fmt: skip
        self.unsaved = True
        self.audit.finish(batch_id, "done", "header fix")
        return HeaderFixResult(status="written", batch_id=batch_id, changes=result)

    # --- employee codes in Labour Detail (Phase 4; approved by the user, PLAN.md §2 rule 2) ---

    def write_codes(self, items: list[CodeWrite], user: str) -> CodeWriteResult:
        """Write approved employee codes into Labour Detail G (replacing blanks, 0 and the broken
        #N/A lookups with values). Every row is re-checked on a fresh read first."""
        if not user.strip():
            raise ValueError("a user name is required for writes")
        t, wb = self.template, self.workbook
        master = self.master(fresh=True)
        by_row = {w.row: w for w in master.workers}
        holders: dict[str, list[str]] = {}
        for w in master.workers:
            if employee_code_status(w.employee_code) == EmployeeCodeStatus.VALID:
                holders.setdefault(w.employee_code, []).append(w.calling_name)
        problems, changes = [], []
        col = t.master_cols.employee_code
        for item in items:
            w = by_row.get(item.row)
            code = item.code.strip().upper()
            if w is None or w.calling_name != item.calling_name:
                now = w.calling_name if w else "nobody"
                problems.append(f"Row {item.row} is {now} now, not {item.calling_name}.")
            elif employee_code_status(w.employee_code) == EmployeeCodeStatus.VALID:
                problems.append(f"{w.calling_name} already has {w.employee_code}.")
            elif employee_code_status(code) != EmployeeCodeStatus.VALID:
                problems.append(f"{code!r} for {w.calling_name} is not X##### or XIN###.")
            elif others := [n for n in holders.get(code, [])
                            if person_key(n) != person_key(w.calling_name)]:  # fmt: skip
                problems.append(f"{code} is already used by {', '.join(others)}.")
            else:
                cell = f"{col}{w.row}"
                change = Change(sheet=t.master_sheet, cell=cell, calling_name=w.calling_name,
                                old=w.employee_code, new=code)  # fmt: skip
                changes.append(change)
        if problems or not changes:
            return CodeWriteResult(status="rejected", problems=problems or ["Nothing to write."])
        writes = [RangeWrite(sheet=c.sheet, address=c.cell, values=[[c.new]]) for c in changes]
        if bad := unwritable_cells(writes, t, allow_codes=True):
            raise RuntimeError(f"refusing to write outside Labour Detail G: {bad}")
        try:
            self.backups.ensure(wb.name, wb.save_copy)
        except (OSError, WorkbookError) as exc:
            return CodeWriteResult(status="failed", error=f"Backup failed, nothing written: {exc}")
        batch_id = self.audit.start("write", user, wb.name, changes)
        self._master = None
        self._days.clear()  # upload lines on every sheet look the codes up
        written = {c.cell: (c.old, c.new) for c in changes}
        try:
            wb.write_ranges(writes)
        except WorkbookError as exc:
            self.unsaved = True
            self.audit.finish(batch_id, "failed", str(exc))
            return CodeWriteResult(status="failed", batch_id=batch_id, written=written,
                                   error=str(exc))  # fmt: skip
        self.unsaved = True
        mismatches = []
        for c in changes:
            [[now]] = wb.read_range(c.sheet, c.cell)
            if not same_value(now, c.new):
                mismatches.append(f"{c.cell} reads {now!r}, wrote {c.new!r}")
        self.audit.finish(batch_id, "done", "employee codes")
        return CodeWriteResult(status="written", batch_id=batch_id, written=written,
                               mismatches=mismatches)  # fmt: skip

    # --- save / history ---

    def save(self) -> None:
        self.workbook.save()
        self.unsaved = False

    def recent_batches(self, limit: int = 20) -> list[Batch]:
        return self.audit.recent(limit)


def _range_changes(write: RangeWrite, old: dict[str, CellValue]) -> bool:
    return any(not same_value(old.get(cell), value) for cell, value in write.cells())
