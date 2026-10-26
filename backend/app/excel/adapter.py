"""The interface every workbook backend implements (pyxlsb reader, live xlwings, in-memory fake).

Phase 0 defines the read side. Batch writes and read-back are added in Phase 2 (PLAN.md §8).
"""

from __future__ import annotations

from typing import Protocol

from app.domain.models import DaySheet, MasterData, WorkbookSnapshot


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
