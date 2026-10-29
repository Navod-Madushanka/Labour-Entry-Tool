"""Plan the cell writes for an entry, with the write-time checks E07-E09 (PLAN.md §5.4, §7, §8).

Pure functions: nothing here touches Excel. The service re-reads the day sheet, plans every entry
with these functions, and only writes when every plan is ``ok``.

Ranges per block (first row r), written separately because I is locked and because G/H/L in block
rows 2-7 are ignored by the formulas (§5.4):
``G{r}:H{r}`` In/Out, ``J{r}:K{r+4}`` activities 1-5, ``L{r}`` additional hours, ``R{r}`` remark.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Collection, Iterator

from pydantic import BaseModel, Field, computed_field

from app.config import TemplateConfig
from app.domain import rules
from app.domain.codes import normalise_activity
from app.domain.models import (
    ActivityLine,
    CellValue,
    Computed,
    DaySheet,
    Entry,
    Issue,
    is_blank,
)
from app.domain.validators import check_entry, check_header, make_issue
from app.excel.refs import cell_ref, col_to_index, parse_range

# BLOCK rules the user may override after reading them (H01/H02 are BLOCK* in §7).
ACKNOWLEDGEABLE_BLOCKS = frozenset({"H01", "H02"})


class ActivityInput(BaseModel):
    code: str | None = None
    hours: float | None = None


class EntryInput(BaseModel):
    """One worker-day as the user typed it. All blank (no times, activities, additional, remark)
    clears the block."""

    sheet: str
    calling_name: str
    time_in: float | None = None
    time_out: float | None = None
    activities: list[ActivityInput] = Field(default_factory=list)
    additional: float | None = None
    remark: str | None = None
    overwrite: bool = False  # E08: allow replacing a block that already has input
    acknowledged: list[str] = Field(default_factory=list)  # WARN rules, H01, H02 confirmed

    @property
    def is_clear(self) -> bool:
        return (
            self.time_in is None
            and self.time_out is None
            and self.additional is None
            and is_blank(self.remark)
            and all(a.code in (None, "") and a.hours is None for a in self.activities)
        )


class RangeWrite(BaseModel):
    """Values for one rectangular range on one sheet."""

    sheet: str
    address: str  # "G9:H9"
    values: list[list[CellValue]]

    def cells(self) -> Iterator[tuple[str, CellValue]]:
        (r0, c0), _ = parse_range(self.address)
        for i, row in enumerate(self.values):
            for j, value in enumerate(row):
                yield cell_ref(r0 + i, c0 + j), value


class EntryPlan(BaseModel):
    input: EntryInput
    block: int | None = None
    row: int | None = None
    writes: list[RangeWrite] = Field(default_factory=list)
    old: dict[str, CellValue] = Field(default_factory=dict)  # every target cell's current value
    preview: Computed | None = None
    day_count: float | None = None  # SUMMARY day count (1, 0.5 or 0)
    bp_day: bool | None = None  # BP Bill counts the day (effective >= 6)
    issues: list[Issue] = Field(default_factory=list)

    @computed_field
    @property
    def blocking(self) -> list[Issue]:
        acked = set(self.input.acknowledged)
        return [
            i
            for i in self.issues
            if i.severity == "BLOCK" and not (i.rule in ACKNOWLEDGEABLE_BLOCKS and i.rule in acked)
        ]

    @computed_field
    @property
    def unconfirmed(self) -> list[Issue]:
        """Warnings the user has not acknowledged yet."""
        return [
            i for i in self.issues if i.severity == "WARN" and i.rule not in self.input.acknowledged
        ]

    @computed_field
    @property
    def ok(self) -> bool:
        return not self.blocking and not self.unconfirmed

    @computed_field
    @property
    def changes(self) -> dict[str, tuple[CellValue, CellValue]]:
        """cell -> (old, new) for the cells whose value changes."""
        new = {cell: v for w in self.writes for cell, v in w.cells()}
        return {
            c: (self.old.get(c), v) for c, v in new.items() if not same_value(self.old.get(c), v)
        }


def same_value(a: CellValue, b: CellValue) -> bool:
    """Equal as Excel stores them: blank and "" are the same; numbers compare by value."""
    if is_blank(a) and is_blank(b):
        return True
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, int | float) and isinstance(b, int | float):
        return abs(float(a) - float(b)) < 1e-9
    return a == b


# --- Writable cells (E09) ---------------------------------------------------------------------


def writable_cell(template: TemplateConfig, cell: str) -> bool:
    """True only for the day-sheet input cells of §5.4."""
    (row, col), _ = parse_range(cell)
    t = template
    if not t.first_block_row <= row <= t.last_block_row:
        return False
    offset = (row - t.first_block_row) % t.block_size + 1  # 1..7 within the block
    c = t.cols
    first_row_cols = {c.time_in, c.time_out, c.activity, c.hours, c.additional, c.remarks}
    activity_cols = {c.activity, c.hours}
    allowed = first_row_cols if offset == 1 else activity_cols if offset <= 5 else set()
    return col in {col_to_index(x) for x in allowed}


def header_fix_cells(template: TemplateConfig) -> dict[str, str]:
    """Header cells the tool may fix after explicit approval (H01-H03): field -> cell."""
    h = template.header
    return {"date": h.date, "day_type": h.day_type, "sheet_no": h.sheet_no}


def employee_code_cell(template: TemplateConfig, cell: str) -> bool:
    """``Labour Detail`` column G of a worker row (Phase 4, written only after approval)."""
    (row, col), _ = parse_range(cell)
    first, last = template.master_rows
    return first <= row <= last and col == col_to_index(template.master_cols.employee_code)


def unwritable_cells(
    writes: list[RangeWrite],
    template: TemplateConfig,
    allow_header: bool = False,
    allow_codes: bool = False,
    allow_worker_rows: Collection[int] = (),
) -> list[str]:
    """Cells the tool must not write: anything but the §5.4 inputs of a day sheet, plus F3/H3/F4
    when a header fix was approved, Labour Detail G when employee codes were approved, and
    Labour Detail A-H of the given rows when adding a worker (e.g. a medical line) was approved."""
    header = set(header_fix_cells(template).values()) if allow_header else set()
    day_sheets = set(template.day_sheet_names())
    worker_cols = {col_to_index(c) for c in template.master_cols.model_dump().values()}

    def ok(sheet: str, cell: str) -> bool:
        if sheet in day_sheets:
            return writable_cell(template, cell) or cell in header
        if sheet == template.master_sheet:
            (row, col), _ = parse_range(cell)
            if row in allow_worker_rows and col in worker_cols:
                return True
            return allow_codes and employee_code_cell(template, cell)
        return False

    return [f"{w.sheet}!{cell}" for w in writes for cell, _ in w.cells() if not ok(w.sheet, cell)]


# --- Planning ---------------------------------------------------------------------------------


def find_block(day: DaySheet, calling_name: str) -> list[int]:
    return [k for k, name in enumerate(day.block_names) if name == calling_name]


def block_writes(entry: EntryInput, sheet: str, row: int, t: TemplateConfig) -> list[RangeWrite]:
    c = t.cols
    acts: list[list[CellValue]] = []
    n_rows = t.activity_rows[1] - t.activity_rows[0] + 1
    for i in range(n_rows):
        a = entry.activities[i] if i < len(entry.activities) else ActivityInput()
        acts.append([normalise_activity(a.code), a.hours])
    remark = entry.remark if not is_blank(entry.remark) else None
    return [
        RangeWrite(sheet=sheet, address=f"{c.time_in}{row}:{c.time_out}{row}",
                   values=[[entry.time_in, entry.time_out]]),
        RangeWrite(sheet=sheet, address=f"{c.activity}{row}:{c.hours}{row + n_rows - 1}",
                   values=acts),
        RangeWrite(sheet=sheet, address=f"{c.additional}{row}", values=[[entry.additional]]),
        RangeWrite(sheet=sheet, address=f"{c.remarks}{row}", values=[[remark]]),
    ]  # fmt: skip


def old_values(day: DaySheet, block: int, row: int, t: TemplateConfig) -> dict[str, CellValue]:
    """Current values of the block's input cells. Blocks without input are all blank."""
    current = next((e for e in day.entries if e.block == block), None)
    c = t.cols
    out: dict[str, CellValue] = {
        f"{c.time_in}{row}": current.time_in if current else None,
        f"{c.time_out}{row}": current.time_out if current else None,
        f"{c.additional}{row}": current.additional if current else None,
        f"{c.remarks}{row}": current.remark if current else None,
    }
    for i in range(t.activity_rows[1] - t.activity_rows[0] + 1):
        line = current.activities[i] if current and i < len(current.activities) else None
        out[f"{c.activity}{row + i}"] = line.code if line else None
        out[f"{c.hours}{row + i}"] = line.hours if line else None
    return out


def as_entry(entry: EntryInput, block: int, row: int) -> Entry:
    """The entry as it will read from the sheet after the write (for previews and checks)."""
    lines = []
    for i in range(max(len(entry.activities), 5)):
        a = entry.activities[i] if i < len(entry.activities) else ActivityInput()
        lines.append(ActivityLine(row=row + i, code=a.code or None, hours=a.hours))
    return Entry(
        sheet=entry.sheet,
        block=block,
        row=row,
        calling_name=entry.calling_name,
        time_in=entry.time_in,
        time_out=entry.time_out,
        activities=lines,
        additional=entry.additional,
        remark=entry.remark if not is_blank(entry.remark) else None,
    )


def plan_entry(
    entry: EntryInput,
    day: DaySheet,
    activity_codes: Collection[str],
    month_start: dt.date,
    holidays: Collection[dt.date] = (),
    template: TemplateConfig | None = None,
    check_activities: bool = True,
) -> EntryPlan:
    """Plan one entry against a freshly read day sheet."""
    t = template or TemplateConfig()
    plan = EntryPlan(input=entry)
    issues = plan.issues

    def block_issue(rule: str, message: str, cell: str | None = None) -> None:
        issues.append(
            make_issue(rule, message, sheet=entry.sheet, cell=cell, calling_name=entry.calling_name)
        )

    if entry.sheet != day.header.sheet:
        raise ValueError(f"entry for sheet {entry.sheet!r} planned against {day.header.sheet!r}")
    issues += check_header(day.header, month_start, holidays, t)

    # E07: the calling name must sit in exactly one block of this sheet.
    blocks = find_block(day, entry.calling_name)
    if len(blocks) != 1:
        found = "is not on" if not blocks else f"is in {len(blocks)} blocks of"
        block_issue("E07", f"{entry.calling_name} {found} sheet {entry.sheet}.")
        return plan
    block = blocks[0]
    row = t.block_row(block)
    plan.block, plan.row = block, row
    plan.writes = block_writes(entry, entry.sheet, row, t)
    plan.old = old_values(day, block, row, t)

    # E09: never write outside the §5.4 input cells.
    if bad := unwritable_cells(plan.writes, t):
        block_issue("E09", f"Refusing to write locked or formula cells: {', '.join(bad)}.")

    # E08: existing input is only replaced on request.
    filled = {cell: v for cell, v in plan.old.items() if not is_blank(v)}
    if filled and not entry.overwrite:
        shown = ", ".join(f"{cell}={v!r}" for cell, v in filled.items())
        block_issue("E08", f"Block already has input ({shown}). Confirm overwrite to replace it.",
                    f"{t.cols.time_in}{row}")  # fmt: skip

    if entry.is_clear:
        return plan  # clearing: nothing to validate beyond E07-E09
    would_be = as_entry(entry, block, row)
    issues += check_entry(would_be, day.header.day_type, activity_codes, t, check_activities)
    plan.preview = rules.compute_entry(would_be, day.header.day_type)
    if plan.preview is not None:
        plan.day_count = rules.summary_day_count(plan.preview.effective, day.header.day_type)
        plan.bp_day = rules.bp_bill_counts_day(plan.preview.effective)
    return plan
