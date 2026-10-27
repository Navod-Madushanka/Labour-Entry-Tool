"""Build the workbook models from a grid of cell values (shared by every reader).

A grid maps (row, col), both 1-based, to a ``CellValue``; blank cells are left out. The pyxlsb
reader and the live xlwings adapter each produce grids, so both build identical models.
"""

from __future__ import annotations

import datetime as dt

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
    UploadLine,
    Worker,
    is_blank,
)
from app.excel.refs import col_to_index, parse_cell, parse_range

Grid = dict[tuple[int, int], CellValue]

EXCEL_EPOCH = dt.date(1899, 12, 30)


def excel_serial_to_date(value: CellValue) -> dt.date | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    if not 1 <= value < 2958466:  # 1900-01-01 .. 9999-12-31
        return None
    return EXCEL_EPOCH + dt.timedelta(days=int(value))


def date_to_excel_serial(value: dt.date) -> float:
    return float((value - EXCEL_EPOCH).days)


def master_max_col(t: TemplateConfig) -> int:
    cols = [col_to_index(v) for v in t.master_cols.model_dump().values()]
    return max([*cols, t.activity_start[1], parse_range(t.day_types)[0][1]])


def day_max_col(t: TemplateConfig) -> int:
    cols = [col_to_index(v) for v in t.cols.model_dump().values()]
    return max([*cols, *(parse_cell(v)[1] for v in t.header.model_dump().values())])


def _text(value: CellValue) -> str | None:
    """Text of a cached calling-name cell; Excel shows 0 for a reference to a blank cell."""
    if isinstance(value, str):
        return value
    return None


def master_from_grid(grid: Grid, t: TemplateConfig) -> MasterData:
    """Labour Detail workers, activity list and day types from a grid of its cells."""
    cols = {k: col_to_index(v) for k, v in t.master_cols.model_dump().items()}
    act_row, act_col = t.activity_start
    (dt_row0, dt_col), (dt_row1, _) = parse_range(t.day_types)

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

    # Every non-blank cell from the first list row down to the end of the worker rows (or the
    # configured list end, if later). Blank and space-only cells are skipped, not the end: INDIAN
    # pads L312:L502 with " ", and a gap must not hide the codes below it.
    list_end = max(t.master_rows[1], parse_range(t.activity_list)[1][0])
    activities = [
        ActivityCode(row=r, raw=cell_text(value))
        for r in range(act_row, list_end + 1)
        if (value := grid.get((r, act_col))) is not None and cell_text(value).strip()
    ]

    day_types = [
        cell_text(v)
        for r in range(dt_row0, dt_row1 + 1)
        if (v := grid.get((r, dt_col))) is not None
    ]
    return MasterData(workers=workers, activities=activities, day_types=day_types)


def day_from_grid(sheet: str, grid: Grid, t: TemplateConfig) -> DaySheet:
    """Header, block names and every block with input, from a grid of a day sheet's cells."""
    c = {k: col_to_index(v) for k, v in t.cols.model_dump().items()}
    header_cells = {k: parse_cell(v) for k, v in t.header.model_dump().items()}

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


# --- Models back to grids (the in-memory fake workbook) ----------------------------------------


def grid_from_master(master: MasterData, t: TemplateConfig) -> Grid:
    cols = {k: col_to_index(v) for k, v in t.master_cols.model_dump().items()}
    fields = {"calling_name": "calling_name", "name": "name", "trade_group": "trade_group",
              "id": "id_no", "daily_rate": "daily_rate", "bp": "bp",
              "employee_code": "employee_code", "epf": "epf"}  # fmt: skip
    grid: Grid = {}
    for w in master.workers:
        for col_key, field in fields.items():
            if (value := getattr(w, field)) is not None:
                grid[(w.row, cols[col_key])] = value
    act_col = t.activity_start[1]
    for a in master.activities:
        grid[(a.row, act_col)] = a.raw
    (dt_row0, dt_col), _ = parse_range(t.day_types)
    for i, day_type in enumerate(master.day_types):
        grid[(dt_row0 + i, dt_col)] = day_type
    return grid


def grid_from_day(day: DaySheet, t: TemplateConfig) -> Grid:
    """Header, column A and the input cells. Formula results are left to the caller."""
    grid: Grid = {}
    h = day.header
    for key, value in (("date", h.date_raw), ("day_type", h.day_type), ("sheet_no", h.sheet_no),
                       ("prepared_by", h.prepared_by), ("project", h.project)):  # fmt: skip
        if value is None and key == "date" and h.date is not None:
            value = date_to_excel_serial(h.date)
        if value is not None:
            grid[parse_cell(getattr(t.header, key))] = value
    c = {k: col_to_index(v) for k, v in t.cols.model_dump().items()}
    for k, name in enumerate(day.block_names):
        if name is not None:
            grid[(t.block_row(k), c["calling_name"])] = name
    for e in day.entries:
        cells = [(e.row, "time_in", e.time_in), (e.row, "time_out", e.time_out),
                 (e.row, "additional", e.additional), (e.row, "remarks", e.remark)]  # fmt: skip
        for line in e.activities:
            cells += [(line.row, "activity", line.code), (line.row, "hours", line.hours)]
        for row, col, value in cells:
            if value is not None:
                grid[(row, c[col])] = value
    return grid
