"""Pydantic models for the entry workbook (PLAN.md §5).

Readers store cell values *raw* (``CellValue``) exactly as Excel holds them: numbers, text,
booleans, ``None`` for blank, and Excel errors as their display text (e.g. ``"#N/A"``).
Interpretation (is it numeric? on the quarter grid? a valid code?) belongs to ``rules``,
``codes`` and ``validators``, never to the readers.
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field

CellValue = bool | int | float | str | None
Severity = Literal["BLOCK", "WARN", "INFO"]


def is_blank(value: CellValue) -> bool:
    """Blank as Excel's ISBLANK-ish view the tool uses: empty cell or empty string."""
    return value is None or value == ""


def as_number(value: CellValue) -> float | None:
    """Numeric cell value as float; text, booleans and blanks give None."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


# --- Master data (Labour Detail) -----------------------------------------------------------


class Worker(BaseModel):
    """One used row of ``Labour Detail`` (rows 3-502)."""

    row: int
    calling_name: str
    name: CellValue = None
    trade_group: CellValue = None
    id_no: CellValue = None
    daily_rate: CellValue = None
    bp: CellValue = None
    employee_code: CellValue = None
    epf: CellValue = None


class ActivityCode(BaseModel):
    """One cell of the activity list (``Labour Detail!L``). ``raw`` keeps stray spaces."""

    row: int
    raw: str

    @property
    def code(self) -> str:
        return self.raw.strip()


class MasterData(BaseModel):
    workers: list[Worker]
    activities: list[ActivityCode]
    day_types: list[str]


# --- Day sheets -----------------------------------------------------------------------------


class DayHeader(BaseModel):
    sheet: str
    date: dt.date | None = None
    date_raw: CellValue = None
    day_type: CellValue = None
    sheet_no: CellValue = None
    prepared_by: CellValue = None
    project: CellValue = None


class ActivityLine(BaseModel):
    """J/K of one of block rows 1-5."""

    row: int
    code: CellValue = None
    hours: CellValue = None


class UploadLine(BaseModel):
    """Cached M-Q (ERP upload line) of one block row. Formula results, read-only."""

    row: int
    employee: CellValue = None
    date: CellValue = None
    activity: CellValue = None
    hours: CellValue = None
    ot: CellValue = None


class CachedValues(BaseModel):
    """Excel's cached formula results for one block, used to verify ``rules``."""

    calling_name: CellValue = None  # A, block row 1
    total: CellValue = None  # D, block row 1
    effective: CellValue = None  # E, block row 1
    upload: list[UploadLine] = []  # M-Q, block rows 1-7


class Entry(BaseModel):
    """Input cells of one worker block on one day sheet (PLAN.md §5.4 writable cells)."""

    sheet: str
    block: int
    row: int
    calling_name: str | None = None
    time_in: CellValue = None  # G, block row 1
    time_out: CellValue = None  # H, block row 1
    activities: list[ActivityLine] = []  # J/K, block rows 1-5
    additional: CellValue = None  # L, block row 1
    remark: CellValue = None  # R, block row 1
    cached: CachedValues | None = None

    @property
    def has_input(self) -> bool:
        cells = [self.time_in, self.time_out, self.additional, self.remark]
        cells += [v for line in self.activities for v in (line.code, line.hours)]
        return any(not is_blank(v) for v in cells)

    @property
    def is_complete(self) -> bool:
        """In and Out are both numbers, so Excel's formulas produce a result."""
        return as_number(self.time_in) is not None and as_number(self.time_out) is not None

    @property
    def activity_lines(self) -> list[ActivityLine]:
        """Rows 1-5 where code or hours is filled."""
        return [a for a in self.activities if not (is_blank(a.code) and is_blank(a.hours))]


class DaySheet(BaseModel):
    header: DayHeader
    block_names: list[str | None] = Field(
        default_factory=list, description="cached column A per block, for E07"
    )
    entries: list[Entry] = Field(default_factory=list, description="blocks with any input")


# --- Results ----------------------------------------------------------------------------------


class Computed(BaseModel):
    """What Excel computes for one entry (PLAN.md §5.5)."""

    total: float
    effective: float
    ot_raw: float | None  # effective - threshold; None for an unknown day type
    activity_hours: float
    zidle: float

    @property
    def ot(self) -> float | None:
        """OT as shown on the upload line (only when > 0)."""
        return self.ot_raw if self.ot_raw is not None and self.ot_raw > 0 else None


class Issue(BaseModel):
    rule: str  # catalogue id, e.g. "E05" (PLAN.md §7)
    severity: Severity
    message: str
    sheet: str | None = None
    cell: str | None = None
    calling_name: str | None = None
    suggestion: str | None = None


# --- Snapshot (whole workbook, used by readers and fixtures) -----------------------------------


class SnapshotMeta(BaseModel):
    source_name: str
    source_sha256: str | None = None
    read_at: dt.datetime
    sanitized: bool = False
    tool_version: str | None = None


class WorkbookSnapshot(BaseModel):
    meta: SnapshotMeta
    master: MasterData
    days: list[DaySheet]
