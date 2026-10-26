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
from app.domain.codes import cell_text
from app.domain.models import (
    ActivityCode,
    ActivityLine,
    CachedValues,
    CellValue,
    DayHeader,
    DaySheet,
    Entry,
    MasterData,
    SnapshotMeta,
    UploadLine,
    WorkbookSnapshot,
    Worker,
    is_blank,
)
from app.excel.refs import col_to_index, parse_cell, parse_range

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

EXCEL_EPOCH = dt.date(1899, 12, 30)

Grid = dict[tuple[int, int], CellValue]


def _clean(value: object) -> CellValue:
    """pyxlsb value -> CellValue: errors to their names, '' to None."""
    if isinstance(value, str):
        if _HEX_RE.match(value):
            return _ERROR_CODES.get(int(value, 16), "#UNKNOWN!")
        return value if value != "" else None
    return value  # type: ignore[return-value]


def excel_serial_to_date(value: CellValue) -> dt.date | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    if not 1 <= value < 2958466:  # 1900-01-01 .. 9999-12-31
        return None
    return EXCEL_EPOCH + dt.timedelta(days=int(value))


def sha256_of(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _text(value: CellValue) -> str | None:
    """Text of a cached calling-name cell; Excel shows 0 for a reference to a blank cell."""
    if isinstance(value, str):
        return value
    return None


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
        cols = {k: col_to_index(v) for k, v in t.master_cols.model_dump().items()}
        act_row, act_col = t.activity_start
        (dt_row0, dt_col), (dt_row1, _) = parse_range(t.day_types)
        max_col = max([*cols.values(), act_col, dt_col])
        grid = self._grid(t.master_sheet, max_row=1_048_576, max_col=max_col)

        workers = []
        for r in range(t.master_rows[0], t.master_rows[1] + 1):
            calling = grid.get((r, cols["calling_name"]))
            if is_blank(calling):
                continue
            workers.append(
                Worker(
                    row=r,
                    calling_name=cell_text(calling),
                    name=grid.get((r, cols["name"])),
                    trade_group=grid.get((r, cols["trade_group"])),
                    id_no=grid.get((r, cols["id"])),
                    daily_rate=grid.get((r, cols["daily_rate"])),
                    bp=grid.get((r, cols["bp"])),
                    employee_code=grid.get((r, cols["employee_code"])),
                    epf=grid.get((r, cols["epf"])),
                )
            )

        activities = []
        r = act_row
        while (value := grid.get((r, act_col))) is not None:  # until the first blank
            activities.append(ActivityCode(row=r, raw=cell_text(value)))
            r += 1

        day_types = [
            cell_text(v)
            for r in range(dt_row0, dt_row1 + 1)
            if (v := grid.get((r, dt_col))) is not None
        ]
        return MasterData(workers=workers, activities=activities, day_types=day_types)

    # --- day sheets ---

    def day_sheet_names(self) -> list[str]:
        return self.template.day_sheet_names()

    def read_day(self, sheet: str) -> DaySheet:
        t = self.template
        c = {k: col_to_index(v) for k, v in t.cols.model_dump().items()}
        header_cells = {k: parse_cell(v) for k, v in t.header.model_dump().items()}
        max_col = max([*c.values(), *(col for _, col in header_cells.values())])
        grid = self._grid(sheet, max_row=t.last_block_row, max_col=max_col)

        def at(r: int, col: str) -> CellValue:
            return grid.get((r, c[col]))

        h = {k: grid.get(rc) for k, rc in header_cells.items()}
        header = DayHeader(
            sheet=sheet,
            date=excel_serial_to_date(h["date"]),
            date_raw=h["date"],
            day_type=h["day_type"],
            sheet_no=h["sheet_no"],
            prepared_by=h["prepared_by"],
            project=h["project"],
        )

        first_act, last_act = t.activity_rows
        block_names: list[str | None] = []
        entries: list[Entry] = []
        for k in range(t.blocks):
            r0 = t.block_row(k)
            name = _text(at(r0, "calling_name"))
            block_names.append(name)
            entry = Entry(
                sheet=sheet,
                block=k,
                row=r0,
                calling_name=name,
                time_in=at(r0, "time_in"),
                time_out=at(r0, "time_out"),
                activities=[
                    ActivityLine(row=r, code=at(r, "activity"), hours=at(r, "hours"))
                    for r in range(r0 + first_act - 1, r0 + last_act)
                ],
                additional=at(r0, "additional"),
                remark=at(r0, "remarks"),
            )
            if not entry.has_input:
                continue
            entry.cached = CachedValues(
                calling_name=at(r0, "calling_name"),
                total=at(r0, "total"),
                effective=at(r0, "effective"),
                upload=[
                    UploadLine(
                        row=r,
                        employee=at(r, "upload_employee"),
                        date=at(r, "upload_date"),
                        activity=at(r, "upload_activity"),
                        hours=at(r, "upload_hours"),
                        ot=at(r, "upload_ot"),
                    )
                    for r in range(r0, r0 + t.block_size)
                ],
            )
            entries.append(entry)
        return DaySheet(header=header, block_names=block_names, entries=entries)

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
