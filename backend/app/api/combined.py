"""Several workbooks at once for Analysis (advanced mode): each open workbook's Labour Detail, day
sheets and supervisors, so the BP bill check (and the other views) can cover every labour source
of the month together. Read-only: nothing is written anywhere.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from app.api.entries import EXCEL_WAIT, STUCK, WITHOUT_CACHED, busy_text
from app.excel.adapter import WorkbookError

router = APIRouter(prefix="/api/combined")


@router.get("")
async def combined(request: Request, name: list[str] = Query(default=[])) -> JSONResponse:
    """``?name=A.xlsb&name=B.xlsb``: each workbook's master view, day views (without Excel's cached
    formula results) and owners. Days already read are taken from the tool's copy; days not read
    yet are read through Excel, one workbook after the other on the Excel thread."""
    session = request.app.state.session
    worker = request.app.state.get_worker()
    out, notes = [], []
    for n in dict.fromkeys(name):
        book = session.books.get(n)
        if book is None:
            notes.append(f"{n} is not open in the tool.")
            continue
        if (stuck := worker.busy_for()) > STUCK:
            raise HTTPException(503, busy_text(stuck))

        def read(service, workbook=n) -> dict:
            master = service.master_view()
            days = {
                s: service.day_view(s).model_dump(mode="json", exclude=WITHOUT_CACHED)
                for s in service.workbook.day_sheet_names()
            }
            owners = [
                {"sheet": o.sheet, "calling_name": o.calling_name, "supervisor": o.supervisor}
                for o in service.audit.owners(service.workbook.name)
            ]
            return {"workbook": workbook, "master": master.model_dump(mode="json"), "days": days,
                    "owners": owners}  # fmt: skip

        try:
            out.append(await asyncio.wait_for(worker.run(read, book.service), EXCEL_WAIT))
        except TimeoutError as exc:
            raise HTTPException(504, busy_text(EXCEL_WAIT)) from exc
        except (WorkbookError, KeyError, ValueError) as exc:
            notes.append(f"{n} could not be read: {exc}")
    return JSONResponse({"books": out, "notes": notes})
