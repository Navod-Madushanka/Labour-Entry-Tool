"""The interfaces every workbook backend implements (pyxlsb reader, live xlwings, in-memory fake).

``WorkbookAdapter`` is the read side (Phase 0). ``LiveWorkbook`` adds what the write path needs
(Phase 2, PLAN.md §8): bulk range reads for read-back, one batched write, save and backup copy.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

from app.domain.models import CellValue, DaySheet, MasterData, WorkbookSnapshot
from app.domain.writes import RangeWrite


class WorkbookError(Exception):
    """Something the user can act on (shown as-is in the UI)."""


class NotConnectedError(WorkbookError):
    """No open workbook matches, or more than one does."""


class WorkbookBusyError(WorkbookError):
    """Excel refused the call because the user is editing a cell (RPC_E_CALL_REJECTED)."""


class ProtectionError(WorkbookError):
    """Excel refused to change a locked cell on a protected sheet."""


class WorkbookAdapter(Protocol):
    def read_master(self) -> MasterData:
        """Labour Detail workers, the activity list and the day types."""
        ...

    def read_day(self, sheet: str) -> DaySheet:
        """Header, block names and every block with input on one day sheet."""
        ...

    def day_sheet_names(self) -> list[str]: ...

    def snapshot(self) -> WorkbookSnapshot:
        """Master data plus all day sheets."""
        ...


class LiveWorkbook(WorkbookAdapter, Protocol):
    @property
    def name(self) -> str:
        """The workbook's file name."""
        ...

    def read_range(self, sheet: str, address: str) -> list[list[CellValue]]:
        """One bulk read; always 2-D, blanks as None, errors as their text."""
        ...

    def write_ranges(self, writes: Sequence[RangeWrite]) -> None:
        """Write all ranges as one batch: calculation paused, then restored and recalculated."""
        ...

    def save(self) -> None: ...

    def save_copy(self, path: Path) -> None:
        """Copy of the workbook as it is now (including unsaved changes), for the backup."""
        ...
