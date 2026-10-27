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
from app.domain.models import CellValue, MasterData, as_number
from app.domain.rules import same_hours
from app.domain.validators import make_issue
from app.domain.writes import (
    ActivityInput,
    EntryInput,
    EntryPlan,
    RangeWrite,
    block_writes,
    plan_entry,
    same_value,
    unwritable_cells,
)
from app.excel.adapter import LiveWorkbook, WorkbookError
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


class Status(BaseModel):
    connected: bool
    workbook: str | None = None
    error: str | None = None
    unsaved_changes: bool = False
    backup: str | None = None


class EntryService:
    def __init__(
        self,
        connect: Callable[[], LiveWorkbook],
        config: Config,
        audit: AuditStore,
        backups: BackupManager,
    ):
        self._connect = connect
        self.config = config
        self.template = config.template
        self.audit = audit
        self.backups = backups
        self._workbook: LiveWorkbook | None = None
        self.unsaved = False

    # --- connection ---

    @property
    def workbook(self) -> LiveWorkbook:
        if self._workbook is None:
            self._workbook = self._connect()
        return self._workbook

    def disconnect(self) -> None:
        self._workbook = None

    def status(self) -> Status:
        try:
            wb = self.workbook
        except WorkbookError as exc:
            return Status(connected=False, error=str(exc))
        backup = self.backups.session_backup(wb.name)
        return Status(connected=True, workbook=wb.name, unsaved_changes=self.unsaved,
                      backup=str(backup) if backup else None)  # fmt: skip

    # --- preview / commit ---

    def preview(self, entries: list[EntryInput]) -> list[EntryPlan]:
        return self._plan(entries, self.workbook.read_master())

    def commit(self, entries: list[EntryInput], user: str, dry_run: bool = False) -> CommitResult:
        started = time.perf_counter()
        if not user.strip():
            raise ValueError("a user name is required for writes")
        wb = self.workbook
        plans = self._plan(entries, wb.read_master())

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

    def _plan(self, entries: list[EntryInput], master: MasterData) -> list[EntryPlan]:
        codes = {a.code for a in master.activities}
        days = {sheet: self.workbook.read_day(sheet) for sheet in {e.sheet for e in entries}}
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
        by_block: dict[tuple[str, int], list[Change]] = {}
        for ch in self.audit.changes(batch_id):
            row = parse_cell(ch.cell)[0]
            first = row - (row - t.first_block_row) % t.block_size
            by_block.setdefault((ch.sheet, first), []).append(ch)

        writes: list[RangeWrite] = []
        undo_changes: list[Change] = []
        conflicts: list[str] = []
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
        if bad := unwritable_cells(writes, t):
            raise RuntimeError(f"refusing to write outside the input cells: {bad}")
        try:
            self.backups.ensure(wb.name, wb.save_copy)
        except (OSError, WorkbookError) as exc:
            return UndoResult(status="failed", batch_id=batch_id, error=f"Backup failed: {exc}")
        undo_id = self.audit.start("undo", user, wb.name, undo_changes, undo_of=batch_id)
        try:
            wb.write_ranges(writes)
        except WorkbookError as exc:
            self.unsaved = True
            self.audit.finish(undo_id, "failed", str(exc))
            return UndoResult(status="failed", batch_id=batch_id, undo_batch_id=undo_id,
                              error=str(exc))  # fmt: skip
        self.unsaved = True
        self.audit.finish(undo_id, "done")
        return UndoResult(status="undone", batch_id=batch_id, undo_batch_id=undo_id)

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

    # --- save / history ---

    def save(self) -> None:
        self.workbook.save()
        self.unsaved = False

    def recent_batches(self, limit: int = 20) -> list[Batch]:
        return self.audit.recent(limit)


def _range_changes(write: RangeWrite, old: dict[str, CellValue]) -> bool:
    return any(not same_value(old.get(cell), value) for cell, value in write.cells())
