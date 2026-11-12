"""Month history (``/api/history``, roadmap #9): save this month, add a past month from its
.xlsb (read with pyxlsb: Excel is not used), list, delete, and the stored rows for Analysis."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.books import workbook_kind
from app.history import HistoryQuantity, HistoryRow, MonthInfo, month_rows
from app.setup import guess_month

router = APIRouter(prefix="/api/history")


def _history(request: Request):
    return request.app.state.get_history()


def _read(path: Path):
    """A workbook file as a snapshot: a .xlsb through pyxlsb, a practice snapshot as JSON."""
    if path.suffix.lower() == ".json":
        from app.excel.fake_adapter import load_snapshot

        return load_snapshot(path)
    from app.excel.xlsb_reader import XlsbReader

    with XlsbReader(path) as reader:
        return reader.snapshot()


class SaveResult(BaseModel):
    month: MonthInfo
    note: str | None = None  # e.g. unsaved changes in Excel are not in the file yet


@router.get("", response_model=list[MonthInfo])
def months(request: Request) -> list[MonthInfo]:
    return _history(request).months()


@router.post("/save", response_model=SaveResult)
async def save_current(request: Request) -> SaveResult:
    """Store the open workbook's month: read from its file on disk (save it in Excel first), or
    from the practice copy in memory."""
    session = request.app.state.session
    book = session.book
    if book is None:
        raise HTTPException(409, "Choose the workbook first.")
    service = request.app.state.get_service()
    config = request.app.state.config
    path = book.path if book.path and Path(book.path).exists() else None
    note = None
    if path is not None and Path(path).suffix.lower() == ".xlsb":
        snapshot = await asyncio.to_thread(_read, Path(path))
        if service.unsaved:
            note = "Excel has changes not saved yet: they are not in this history until you save the workbook and save the month again."  # noqa: E501
    else:
        from app.api.entries import run_service

        snapshot = await run_service(request, lambda s: s.snapshot())
    owners = {(o.sheet, o.calling_name): o.supervisor for o in service.audit.owners(book.name)}
    rows = month_rows(snapshot, service.trade_letters, owners)
    info = _history(request).save(workbook_kind(book.name), config.month, book.name, rows,
                                  config.quantities, config.units)  # fmt: skip
    return SaveResult(month=info, note=note)


@router.post("/import", response_model=SaveResult)
async def import_month(request: Request, filename: str = Query(...)) -> SaveResult:
    """A past month's workbook (.xlsb), sent as the request body: read with pyxlsb and stored;
    the file is not kept."""
    name = Path(filename).name
    if Path(name).suffix.lower() not in (".xlsb", ".json"):
        raise HTTPException(422, "Choose a monthly workbook (.xlsb).")
    body = await request.body()
    if not body:
        raise HTTPException(422, "The file is empty.")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / name
        path.write_bytes(body)
        try:
            snapshot = await asyncio.to_thread(_read, path)
        except Exception as exc:  # not a workbook of this layout
            raise HTTPException(422, f"Could not read {name}: {exc}") from exc
    guess = guess_month(name, snapshot)
    if not guess.month:
        raise HTTPException(422, f"Which month is {name}? Its name and sheet dates do not say.")
    letters = request.app.state.config.trade_letters or {}
    rows = month_rows(snapshot, letters)
    return SaveResult(month=_history(request).save(workbook_kind(name), guess.month, name, rows))


@router.delete("/{month_id}", response_model=list[MonthInfo])
def delete(month_id: int, request: Request) -> list[MonthInfo]:
    _history(request).delete(month_id)
    return _history(request).months()


class RowsView(BaseModel):
    rows: list[HistoryRow]
    quantities: list[HistoryQuantity]


@router.get("/rows", response_model=RowsView)
def rows(request: Request, ids: str = Query("")) -> RowsView:
    """The stored rows (and quantities) of the given months, e.g. ``?ids=1,2``."""
    want = [int(x) for x in ids.split(",") if x.strip().isdigit()]
    h = _history(request)
    return RowsView(rows=h.rows(want), quantities=h.quantities(want))


@router.get("/carry")
def carry(request: Request) -> dict[str, int]:
    """Days in a row each person had at the end of the previous month (of this kind), so a run
    that crosses the month end is not cut at day 1."""
    book = request.app.state.session.book
    if book is None:
        return {}
    return _history(request).trailing_runs(workbook_kind(book.name), request.app.state.config.month)
