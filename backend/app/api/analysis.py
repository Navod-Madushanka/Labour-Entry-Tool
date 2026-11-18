"""``POST /api/analysis/export``: the Analysis tab's tables as an .xlsx file (openpyxl).

The page works out every figure itself from the month it has loaded; this only lays the tables
out as worksheets, so nothing here reads or changes the workbook open in Excel.
"""

from __future__ import annotations

import io
import re

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/analysis")

Cell = str | float | int | bool | None


class Table(BaseModel):
    name: str = Field(max_length=100)
    note: str | None = Field(None, max_length=500)
    columns: list[str] = Field(max_length=200)
    rows: list[list[Cell]] = Field(max_length=100_000)


class ExportRequest(BaseModel):
    title: str = Field("Labour analysis", max_length=200)
    # one sheet per business partner in the BP bill check: four workbooks together can have many
    sheets: list[Table] = Field(min_length=1, max_length=250)


_BAD = re.compile(r"[\[\]:*?/\\]")
# Characters an .xlsx cannot hold (control characters, e.g. pasted into a cell from another
# program): openpyxl refuses the whole file for one of them, so they are dropped.
_ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def clean(value: Cell) -> Cell:
    return _ILLEGAL.sub("", value) if isinstance(value, str) else value


def sheet_title(name: str, taken: set[str]) -> str:
    """Excel sheet names: at most 31 characters, none of []:*?/\\, unique (case-insensitive)."""
    # Excel also refuses an apostrophe at either end and the name "History" (reserved)
    base = _BAD.sub(" ", clean(name)).strip().strip("'").strip()[:31] or "Sheet"
    if base.lower() == "history":
        base = "History (sheet)"
    title, n = base, 2
    while title.lower() in taken:
        suffix = f" ({n})"
        title, n = base[: 31 - len(suffix)] + suffix, n + 1
    taken.add(title.lower())
    return title


def build_xlsx(req: ExportRequest) -> bytes:
    # here, not at the top: openpyxl brings numpy and Pillow (~25 MB, kept for the whole day)
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    wb.remove(wb.active)
    taken: set[str] = set()
    head = Font(bold=True)
    fill = PatternFill("solid", fgColor="EEEAE2")
    for t in req.sheets:
        ws = wb.create_sheet(sheet_title(t.name, taken))
        r = 1
        if t.note:
            ws.cell(1, 1, clean(t.note)).font = Font(italic=True)
            r = 3
        ws.freeze_panes = ws.cell(r + 1, 1)  # the header row stays in view
        for c, label in enumerate(t.columns, 1):
            cell = ws.cell(r, c, clean(label))
            cell.font, cell.fill = head, fill
        for row in t.rows:
            r += 1
            for c, value in enumerate(row[: len(t.columns)], 1):
                value = clean(value)
                cell = ws.cell(r, c, value)
                if isinstance(value, str) and value.startswith("="):
                    cell.data_type = "s"  # text that looks like a formula stays text
        for c, label in enumerate(t.columns, 1):
            width = max(
                [len(str(label))] + [len(str(row[c - 1])) for row in t.rows[:500] if len(row) >= c]
            )
            ws.column_dimensions[get_column_letter(c)].width = min(max(width + 2, 8), 60)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


@router.post("/export")
def export(req: ExportRequest) -> Response:
    name = re.sub(r"[^\w .-]", "", req.title).strip() or "Labour analysis"
    return Response(
        build_xlsx(req),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'},
    )
