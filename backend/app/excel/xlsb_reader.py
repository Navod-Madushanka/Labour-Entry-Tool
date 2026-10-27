"""Read-only access to an entry workbook on disk through pyxlsb (no Excel needed).

Used for tests, fixtures and the health check. pyxlsb returns cached formula results, which is
what Phase 0 verifies ``rules`` against. Each sheet is read in one sequential pass (bulk only).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re
from pathlib import Path

from pyxlsb import open_workbook

from app import __version__
from app.config import TemplateConfig
from app.domain.models import (
    CellValue,
    DaySheet,
    MasterData,
    SnapshotMeta,
    WorkbookSnapshot,
)
from app.excel.grid import (
    Grid,
    day_from_grid,
    day_max_col,
    excel_serial_to_date,
    master_from_grid,
    master_max_col,
)

__all__ = ["XlsbReader", "excel_serial_to_date", "sha256_of"]

# pyxlsb hands error cells back as hex strings of the BIFF12 error byte.
_ERROR_CODES = {
    0x00: "#NULL!",
    0x07: "#DIV/0!",
    0x0F: "#VALUE!",
    0x17: "#REF!",
    0x1D: "#NAME?",
    0x24: "#NUM!",
    0x2A: "#N/A",
    0x2B: "#GETTING_DATA",
}
_HEX_RE = re.compile(r"^0x[0-9a-f]{1,2}$")


def _clean(value: object) -> CellValue:
    """pyxlsb value -> CellValue: errors to their names, '' to None."""
    if isinstance(value, str):
        if _HEX_RE.match(value):
            return _ERROR_CODES.get(int(value, 16), "#UNKNOWN!")
        return value if value != "" else None
    return value  # type: ignore[return-value]


def sha256_of(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class XlsbReader:
    """Implements the read side of ``WorkbookAdapter`` for a ``.xlsb`` file."""

    def __init__(self, path: str | Path, template: TemplateConfig | None = None):
        self.path = Path(path)
        self.template = template or TemplateConfig()
        self._wb = open_workbook(str(self.path))

    def __enter__(self) -> XlsbReader:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._wb.close()

    # --- low level ---

    @property
    def sheet_names(self) -> list[str]:
        return list(self._wb.sheets)

    def _grid(self, sheet: str, max_row: int, max_col: int) -> Grid:
        """Non-blank cells up to (max_row, max_col), keyed (row, col) 1-based."""
        if sheet not in self._wb.sheets:  # pyxlsb would match case-insensitively
            raise KeyError(f"sheet {sheet!r} not in {self.path.name}")
        grid: Grid = {}
        with self._wb.get_sheet(sheet) as ws:
            for row in ws.rows(sparse=True):
                if not row:
                    continue
                r = row[0].r + 1
                if r > max_row:
                    break
                for cell in row[:max_col]:
                    value = _clean(cell.v)
                    if value is not None:
                        grid[(r, cell.c + 1)] = value
        return grid

    # --- master ---

    def read_master(self) -> MasterData:
        t = self.template
        grid = self._grid(t.master_sheet, max_row=1_048_576, max_col=master_max_col(t))
        return master_from_grid(grid, t)

    # --- day sheets ---

    def day_sheet_names(self) -> list[str]:
        return self.template.day_sheet_names()

    def read_day(self, sheet: str) -> DaySheet:
        t = self.template
        grid = self._grid(sheet, max_row=t.last_block_row, max_col=day_max_col(t))
        return day_from_grid(sheet, grid, t)

    def snapshot(self) -> WorkbookSnapshot:
        return WorkbookSnapshot(
            meta=SnapshotMeta(
                source_name=self.path.name,
                source_sha256=sha256_of(self.path),
                read_at=dt.datetime.now().astimezone(),
                tool_version=__version__,
            ),
            master=self.read_master(),
            days=[self.read_day(s) for s in self.day_sheet_names()],
        )
