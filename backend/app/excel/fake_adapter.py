"""In-memory workbooks: a read-only adapter over a ``WorkbookSnapshot`` (unit tests, sanitized JSON
fixtures) and a writable fake that recalculates like Excel (tests of the write path)."""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

from app.config import TemplateConfig
from app.domain import rules
from app.domain.codes import is_excel_error
from app.domain.models import CellValue, DaySheet, MasterData, WorkbookSnapshot, as_number
from app.domain.writes import RangeWrite, unwritable_cells
from app.excel.adapter import ProtectionError, WorkbookBusyError
from app.excel.grid import (
    Grid,
    day_from_grid,
    grid_from_day,
    grid_from_master,
    master_from_grid,
)
from app.excel.refs import col_to_index, parse_cell, parse_range


class FakeAdapter:
    def __init__(self, snapshot: WorkbookSnapshot):
        self._snapshot = snapshot
        self._days = {d.header.sheet: d for d in snapshot.days}

    @classmethod
    def from_json(cls, path: str | Path) -> FakeAdapter:
        return cls(load_snapshot(path))

    def read_master(self) -> MasterData:
        return self._snapshot.master.model_copy(deep=True)

    def read_day(self, sheet: str) -> DaySheet:
        try:
            return self._days[sheet].model_copy(deep=True)
        except KeyError:
            raise KeyError(f"no day sheet {sheet!r} in snapshot") from None

    def day_sheet_names(self) -> list[str]:
        return list(self._days)

    def snapshot(self) -> WorkbookSnapshot:
        return self._snapshot.model_copy(deep=True)


def save_snapshot(snapshot: WorkbookSnapshot, path: str | Path) -> Path:
    """Compact JSON (defaults left out); ``load_snapshot`` restores them."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    data = snapshot.model_dump(mode="json", exclude_defaults=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return out


def load_snapshot(path: str | Path) -> WorkbookSnapshot:
    return WorkbookSnapshot.model_validate_json(Path(path).read_text(encoding="utf-8"))


class FakeWorkbook:
    """Writable in-memory workbook (``LiveWorkbook``) for tests of the write path.

    Holds a grid per sheet and re-evaluates the day-sheet formulas Excel would (D, E and the
    upload lines M-Q, PLAN.md §5.5) after every batch, so read-back, undo and audit can be tested
    without Excel. Like the real sheets it refuses writes outside the unlocked input cells.
    """

    def __init__(self, snapshot: WorkbookSnapshot, template: TemplateConfig | None = None):
        self.template = template or TemplateConfig()
        self._name = snapshot.meta.source_name
        self._meta = snapshot.meta
        self.master_grid = grid_from_master(snapshot.master, self.template)
        self.grids = {d.header.sheet: grid_from_day(d, self.template) for d in snapshot.days}
        self.busy_failures = 0  # the next N write_ranges calls raise WorkbookBusyError
        self.batches: list[list[RangeWrite]] = []
        self.saves = 0
        self.copies: list[Path] = []
        for sheet in self.grids:
            self._recalculate(sheet)

    # --- read side ---

    @property
    def name(self) -> str:
        return self._name

    def read_master(self) -> MasterData:
        return master_from_grid(self.master_grid, self.template)

    def day_sheet_names(self) -> list[str]:
        return list(self.grids)

    def read_day(self, sheet: str) -> DaySheet:
        return day_from_grid(sheet, self._grid(sheet), self.template)

    def snapshot(self) -> WorkbookSnapshot:
        return WorkbookSnapshot(
            meta=self._meta,
            master=self.read_master(),
            days=[self.read_day(s) for s in self.grids],
        )

    def read_range(self, sheet: str, address: str) -> list[list[CellValue]]:
        grid = self._grid(sheet)
        (r0, c0), (r1, c1) = parse_range(address)
        return [[grid.get((r, c)) for c in range(c0, c1 + 1)] for r in range(r0, r1 + 1)]

    # --- write side ---

    def write_ranges(self, writes: Sequence[RangeWrite]) -> None:
        if self.busy_failures:
            self.busy_failures -= 1
            raise WorkbookBusyError("Excel is busy (a cell is being edited).")
        rows = range(self.template.master_rows[0], self.template.master_rows[1] + 1)
        for w in writes:  # unlocked: block inputs, day-sheet header, Labour Detail A-H
            if bad := unwritable_cells([w], self.template, allow_header=True, allow_codes=True,
                                       allow_worker_rows=rows):  # fmt: skip
                raise ProtectionError(f"The cell {bad[0]} is protected.")
        for w in writes:
            grid = self._grid(w.sheet)
            for cell, value in w.cells():
                key = parse_cell(cell)
                if value is None or value == "":
                    grid.pop(key, None)
                else:
                    grid[key] = value
        self.batches.append(list(writes))
        written = {w.sheet for w in writes}
        if self.template.master_sheet in written:  # the upload lines look codes up in G
            written = set(self.grids)
        for sheet in written:
            self._recalculate(sheet)

    def save(self) -> None:
        self.saves += 1

    def save_copy(self, path: Path) -> None:
        save_snapshot(self.snapshot(), path)
        self.copies.append(Path(path))

    # --- internals ---

    def _grid(self, sheet: str) -> Grid:
        if sheet == self.template.master_sheet:
            return self.master_grid
        try:
            return self.grids[sheet]
        except KeyError:
            raise KeyError(f"no sheet {sheet!r} in {self._name}") from None

    def _recalculate(self, sheet: str) -> None:
        """Excel's formulas for every block: D, E (block row 1) and M-Q (rows 1-7)."""
        t, grid = self.template, self._grid(sheet)
        c = {k: col_to_index(v) for k, v in t.cols.model_dump().items()}
        day_type = grid.get(parse_cell(t.header.day_type))
        date = grid.get(parse_cell(t.header.date))
        employees = {
            t.block_for_master_row(w.row): w.employee_code for w in self.read_master().workers
        }
        formula_cols = ("total", "effective", "upload_employee", "upload_date",
                        "upload_activity", "upload_hours", "upload_ot")  # fmt: skip
        n_act = t.activity_rows[1] - t.activity_rows[0] + 1
        names = {t.block_for_master_row(w.row): w.calling_name for w in self.read_master().workers}
        for k in range(t.blocks):
            r0 = t.block_row(k)
            if (name := names.get(k)) is not None:  # A = 'Labour Detail'!A{3+k}
                grid[(r0, c["calling_name"])] = name
            else:
                grid.pop((r0, c["calling_name"]), None)
            for r in range(r0, r0 + t.block_size):
                for col in formula_cols:
                    grid.pop((r, c[col]), None)
            hours = [grid.get((r, c["hours"])) for r in range(r0, r0 + n_act)]
            lines: dict[int, dict[str, CellValue]] = {}  # row -> O, P, Q
            for i, h in enumerate(hours):  # activity lines do not depend on In/Out
                code = grid.get((r0 + i, c["activity"]))
                lines[r0 + i] = {
                    "upload_activity": code if h not in (None, "") else None,  # IF(K="","",J)
                    "upload_hours": None if h in (None, "", 0) else h,  # IF(K=0,"",K)
                }
            time_in, time_out = grid.get((r0, c["time_in"])), grid.get((r0, c["time_out"]))
            if time_in is not None:
                tin, tout = as_number(time_in), as_number(time_out)
                if tin is None or tout is None:
                    grid[(r0, c["effective"])] = "#VALUE!"
                else:
                    add = as_number(grid.get((r0, c["additional"]))) or 0
                    effective = rules.effective_hours(tin, tout, add)
                    grid[(r0, c["total"])] = rules.total_hours(tin, tout)
                    grid[(r0, c["effective"])] = effective
                    zidle = rules.zidle_hours(effective, hours)
                    if zidle is not None and not rules.same_hours(zidle, 0):
                        lines[r0 + t.zidle_row - 1] = {"upload_activity": "ZIDLE",
                                                       "upload_hours": zidle}  # fmt: skip
                    ot = rules.ot_hours(effective, day_type)
                    if ot is not None and ot > 0:
                        lines[r0 + t.ot_row - 1] = {"upload_activity": "OT", "upload_ot": ot}
            employee = employees.get(k)
            employee = None if is_excel_error(employee) else employee  # IFERROR -> blank
            for r, values in lines.items():
                if values.get("upload_hours") is not None or values.get("upload_ot") is not None:
                    values = {**values, "upload_employee": employee, "upload_date": date}
                for col, value in values.items():
                    if value is not None:
                        grid[(r, c[col])] = value
