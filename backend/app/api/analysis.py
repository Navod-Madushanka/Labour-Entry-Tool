"""``POST /api/analysis/export``: the Analysis tab's tables as an .xlsx file (openpyxl).

The page works out every figure itself from the month it has loaded; this only lays the tables
out as worksheets, so nothing here reads or changes the workbook open in Excel.
"""

from __future__ import annotations

import io
import re

from fastapi import APIRouter
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
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
    sheets: list[Table] = Field(min_length=1, max_length=50)


_BAD = re.compile(r"[\[\]:*?/\\]")


def sheet_title(name: str, taken: set[str]) -> str:
    """Excel sheet names: at most 31 characters, none of []:*?/\\, unique (case-insensitive)."""
    base = _BAD.sub(" ", name).strip()[:31] or "Sheet"
    title, n = base, 2
    while title.lower() in taken:
        suffix = f" ({n})"
        title, n = base[: 31 - len(suffix)] + suffix, n + 1
    taken.add(title.lower())
    return title


def build_xlsx(req: ExportRequest) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    taken: set[str] = set()
    head = Font(bold=True)
    fill = PatternFill("solid", fgColor="EEEAE2")
    for t in req.sheets:
        ws = wb.create_sheet(sheet_title(t.name, taken))
        r = 1
        if t.note:
            ws.cell(1, 1, t.note).font = Font(italic=True)
            r = 3
        ws.freeze_panes = ws.cell(r + 1, 1)  # the header row stays in view
        for c, label in enumerate(t.columns, 1):
            cell = ws.cell(r, c, label)
            cell.font, cell.fill = head, fill
        for row in t.rows:
            r += 1
            for c, value in enumerate(row[: len(t.columns)], 1):
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
