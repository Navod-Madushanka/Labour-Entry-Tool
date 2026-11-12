"""Bills against the day sheets (roadmap #8): the workbook's BP Bill sheet, found and read
read-only from the saved .xlsb (or a copy sent here), and a supplier's claim (.xlsx or .csv)."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.api.entries import run_service
from app.books import workbook_kind
from app.bpbill import (
    ClaimCheck,
    Difference,
    Layout,
    compare_bill,
    compare_claim,
    describe,
    detect,
    read_bill,
    read_claim,
    rows_from_file,
    sheet_days,
)

router = APIRouter(prefix="/api/bp-bill")
KEY = "bp_layout"  # in the settings file, per kind of workbook: corrections to the found layout


def _grid_from_file(path: Path) -> tuple[str, dict]:
    """The BP Bill sheet of a workbook file as a grid (read-only)."""
    if path.suffix.lower() == ".xlsb":
        from app.excel.xlsb_reader import XlsbReader

        with XlsbReader(path) as r:
            name = next((s for s in r.sheet_names if "bp bill" in s.casefold()), None)
            if not name:
                raise HTTPException(422, f"{path.name} has no sheet called BP Bill.")
            return name, r.sheet_grid(name)
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook

        wb = load_workbook(path, read_only=True, data_only=True)
        try:
            ws = next((w for w in wb.worksheets if "bp bill" in w.title.casefold()), None)
            if ws is None:
                raise HTTPException(422, f"{path.name} has no sheet called BP Bill.")
            grid = {}
            for r, row in enumerate(ws.iter_rows(values_only=True), 1):
                if r > 5000:
                    break
                for c, v in enumerate(row[:120], 1):
                    if v not in (None, ""):
                        grid[(r, c)] = v
            return ws.title, grid
        finally:
            wb.close()
    raise HTTPException(422, "The BP Bill can be read from a .xlsb or .xlsx workbook.")


class BillCheck(BaseModel):
    source: str
    layout: Layout
    layout_text: str
    workers: int  # rows on the BP Bill
    differences: list[Difference]


def _override(request: Request, lay: Layout) -> Layout:
    book = request.app.state.session.book
    saved = (
        request.app.state.session.settings.get_key(KEY).get(workbook_kind(book.name))
        if book
        else None
    )
    if not saved:
        return lay
    fixed = lay.model_copy(
        update={k: v for k, v in saved.items() if k in Layout.model_fields and v is not None}
    )
    if saved.get("first_day_col"):  # day 1 in this column, the rest follow
        n = max(lay.day_cols) if lay.day_cols else 31
        fixed.day_cols = {d: saved["first_day_col"] + d - 1 for d in range(1, n + 1)}
    fixed.notes = [*lay.notes, "Layout corrected by hand on this PC."]
    return fixed


async def _check(request: Request, path: Path, source: str) -> BillCheck:
    sheet, grid = await asyncio.to_thread(_grid_from_file, path)
    lay = _override(request, detect(grid, sheet, request.app.state.config.month))
    bill = read_bill(grid, lay)
    snapshot = await run_service(request, lambda s: s.snapshot())
    diffs = compare_bill(bill, sheet_days(snapshot), lay) if lay.found else []
    return BillCheck(
        source=source, layout=lay, layout_text=describe(lay), workers=len(bill), differences=diffs
    )


@router.get("/check", response_model=BillCheck)
async def check_saved(request: Request) -> BillCheck:
    """The BP Bill of the open workbook's saved file against the day sheets."""
    book = request.app.state.session.book
    if book is None:
        raise HTTPException(409, "Choose the workbook first.")
    path = Path(book.path) if book.path else None
    if path is None or not path.exists() or path.suffix.lower() != ".xlsb":
        raise HTTPException(
            422,
            "The open workbook is not a saved .xlsb file here (practice copy?): "
            "send a copy of the workbook instead.",
        )
    return await _check(request, path, path.name)


@router.post("/check-file", response_model=BillCheck)
async def check_file(request: Request, filename: str = Query(...)) -> BillCheck:
    """A copy of the workbook (.xlsb or .xlsx) sent as the body: its BP Bill against the day
    sheets of the open workbook. The file is not kept."""
    name = Path(filename).name
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / name
        path.write_bytes(await request.body())
        return await _check(request, path, name)


class LayoutFix(BaseModel):
    header_row: int | None = None
    name_col: int | None = None
    first_day_col: int | None = None
    total_days_col: int | None = None
    total_hours_col: int | None = None
    bp_col: int | None = None
    mode: str | None = None  # "hours" or "days"


@router.post("/layout")
def save_layout(body: LayoutFix, request: Request) -> dict:
    """Correct the found layout (column numbers, 1 = A); kept per kind of workbook. Send all
    fields empty to go back to finding it."""
    book = request.app.state.session.book
    if book is None:
        raise HTTPException(409, "Choose the workbook first.")
    if body.mode not in (None, "hours", "days"):
        raise HTTPException(422, "mode is hours or days")
    settings = request.app.state.session.settings
    saved = dict(settings.get_key(KEY))
    fix = {k: v for k, v in body.model_dump().items() if v is not None}
    saved[workbook_kind(book.name)] = fix or None
    settings.set_key(KEY, **saved)
    return {"ok": True}


class ClaimResult(BaseModel):
    source: str
    rows: list[ClaimCheck]


@router.post("/claim", response_model=ClaimResult)
async def check_claim(request: Request, filename: str = Query(...)) -> ClaimResult:
    """A supplier's claim (.xlsx or .csv: Business partner, Calling name, Days billed, Hours
    billed) against the day sheets."""
    try:
        claim = read_claim(rows_from_file(filename, await request.body()))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    snapshot = await run_service(request, lambda s: s.snapshot())
    bp_of = {w.calling_name: str(w.bp or "").strip() for w in snapshot.master.workers}
    return ClaimResult(
        source=Path(filename).name, rows=compare_claim(claim, sheet_days(snapshot), bp_of)
    )
