"""Read registration workbooks (.xlsx) with openpyxl, read-only (PLAN.md §5.8).

Columns are found by header text, never by position: the Indian file has an extra second
Designation column, so the supply files' columns sit one to the left. A sheet without such a
header that holds only calling names (one per row) is read as a plain list.
"""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from app.domain.codes import cell_text
from app.domain.models import CellValue
from app.excel.refs import index_to_col

# Normalised header text -> field. Normalised = lowercase letters only.
HEADERS = {
    "callingname": "calling_name",
    "empcode": "emp_code",
    "employeecode": "emp_code",
    "title": "title",
    "lastname": "name",
    "name": "name",
    "gender": "gender",
    "designation": "designation",
    "tradegroup": "trade_group",
    "department": "department",
    "idnumber": "id_no",
    "nicnumber": "id_no",
    "nicno": "id_no",
    "passportnumber": "id_no",
    "businesspartner": "bp",
    "dateofbirth": "dob",
    "firstdateofemployment": "start",
}

LOOSE_CALLING_NAME = re.compile(r"^[A-Za-z]{2,4}\s*-?\s*\d{2,3}(?:\s+[A-Za-z]{1,3})?$")


class RegistrationRow(BaseModel):
    file: str
    sheet: str
    row: int
    calling_name: str | None = None  # as written (often without the hyphen)
    emp_code: CellValue = None
    title: CellValue = None
    name: CellValue = None
    gender: CellValue = None
    designation: CellValue = None
    designation2: CellValue = None  # the Indian file's extra column
    trade_group: CellValue = None
    department: CellValue = None
    id_no: CellValue = None
    bp: CellValue = None
    dob: CellValue = None
    start: CellValue = None
    cols: dict[str, str] = Field(default_factory=dict)  # field -> column letter

    def cell(self, field: str) -> str | None:
        col = self.cols.get(field)
        return f"{col}{self.row}" if col else None

    @property
    def where(self) -> str:
        return f"{Path(self.file).stem} / {self.sheet.strip()}"


class RegistrationSheet(BaseModel):
    title: str
    kind: Literal["registration", "list", "other"]
    rows: int = 0


class RegistrationFile(BaseModel):
    path: str
    name: str
    sheets: list[RegistrationSheet] = Field(default_factory=list)
    rows: list[RegistrationRow] = Field(default_factory=list)

    @property
    def kind(self) -> str:
        kinds = {s.kind for s in self.sheets} - {"other"}
        return "registration" if "registration" in kinds else "list" if kinds else "other"


def _norm(text: object) -> str:
    return re.sub(r"[^a-z]", "", str(text or "").lower())


def _clean(value: object) -> CellValue:
    """Blank -> None; a real Excel date -> ISO text 'YYYY-MM-DD' (the checks read it as a date)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, dt.datetime | dt.date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, bool | int | float | str):
        return value
    return str(value)


def read_registration(path: str | Path) -> RegistrationFile:
    path = Path(path)
    import openpyxl  # here: only needed when a registration file is read (saves start-up time)

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = RegistrationFile(path=str(path), name=path.name)
    try:
        for ws in wb.worksheets:
            rows = list(ws.iter_rows(values_only=True))
            header_at, fields = _find_header(rows)
            if header_at is not None:
                count = 0
                for i, values in enumerate(rows[header_at + 1 :], start=header_at + 2):
                    rec = {
                        f: _clean(values[j]) if j < len(values) else None for j, f in fields.items()
                    }
                    if not any(v is not None for v in rec.values()):
                        continue
                    cols = {f: index_to_col(j + 1) for j, f in fields.items()}
                    calling = rec.pop("calling_name", None)
                    out.rows.append(RegistrationRow(
                        file=path.name, sheet=ws.title, row=i,
                        calling_name=cell_text(calling).strip() or None, cols=cols, **rec,
                    ))  # fmt: skip
                    count += 1
                out.sheets.append(
                    RegistrationSheet(title=ws.title, kind="registration", rows=count)
                )
            elif (names := _calling_name_list(rows)) is not None:
                col = {"calling_name": "A"}
                for i, name in names:
                    row = RegistrationRow(file=path.name, sheet=ws.title, row=i, calling_name=name)
                    out.rows.append(row.model_copy(update={"cols": col}))
                out.sheets.append(RegistrationSheet(title=ws.title, kind="list", rows=len(names)))
            else:
                out.sheets.append(RegistrationSheet(title=ws.title, kind="other"))
    finally:
        wb.close()
    return out


def _find_header(rows: list[tuple]) -> tuple[int | None, dict[int, str]]:
    for i, values in enumerate(rows[:15]):
        fields: dict[int, str] = {}
        for j, v in enumerate(values):
            field = HEADERS.get(_norm(v))
            if field == "designation" and "designation" in fields.values():
                field = "designation2"
            if field and field not in fields.values():
                fields[j] = field
        if "calling_name" in fields.values() and len(fields) >= 3:
            return i, fields
    return None, {}


def _calling_name_list(rows: list[tuple]) -> list[tuple[int, str]] | None:
    """Rows that each hold just one calling-name-like value (e.g. a list sent to the office)."""
    found = []
    for i, values in enumerate(rows, start=1):
        cells = [v for v in values if v not in (None, "")]
        if not cells:
            continue
        if len(cells) != 1 or not LOOSE_CALLING_NAME.match(str(cells[0]).strip()):
            return None
        found.append((i, str(cells[0]).strip()))
    return found or None
