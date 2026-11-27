"""``GET /api/recovery``: what the change log says the tool wrote, against the open workbook."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request

from app.api.entries import EXCEL_WAIT, STUCK, busy_text
from app.excel.adapter import NotConnectedError, WorkbookError
from app.recovery import RecoveryResult, check_sheet, expected_cells, group_by_sheet

router = APIRouter(prefix="/api")


@router.get("/recovery", response_model=RecoveryResult)
async def recovery(request: Request) -> RecoveryResult:
    """Pushed entries still in the workbook, lost from it (to put back on the manpower sheet), or
    changed since. Read-only: one read per day sheet with pushes, one sheet per job (the tool
    keeps answering meanwhile)."""
    service = request.app.state.get_service()
    worker = request.app.state.get_worker()

    async def job(fn, *args):
        if (stuck := worker.busy_for()) > STUCK:
            raise HTTPException(503, busy_text(stuck))
        try:
            return await asyncio.wait_for(worker.run(fn, *args), EXCEL_WAIT)
        except TimeoutError as exc:
            raise HTTPException(504, busy_text(EXCEL_WAIT)) from exc
        except NotConnectedError as exc:
            raise HTTPException(503, str(exc)) from exc
        except WorkbookError as exc:
            raise HTTPException(409, str(exc)) from exc

    blocks, others, pushes = await job(expected_cells, service)
    name = await job(lambda: service.workbook.name)
    result = RecoveryResult(workbook=name, pushes=pushes, entries=len(blocks), other_names=others)
    by_sheet = group_by_sheet(blocks)
    for sheet in sorted(by_sheet, key=lambda s: (len(s), s)):
        lost, changed, present = await job(check_sheet, service, sheet, by_sheet[sheet])
        result.lost += lost
        result.changed += changed
        result.present += present
    return result
