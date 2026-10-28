"""Live workbook routes (PLAN.md §6 Phase 2): status, preview, entries, batches/undo, save.

Every call runs on the single Excel worker thread. Writes need a user name (asked once per
browser in the UI) and go through ``EntryService.commit``: nothing is written unless every entry
passes its checks and every warning is acknowledged.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.audit.store import Batch
from app.domain.daybuilder import DayBuild
from app.domain.writes import EntryInput, EntryPlan
from app.excel.adapter import NotConnectedError, WorkbookError
from app.service import (
    CommitResult,
    DayView,
    EntryService,
    HeaderFixResult,
    MasterView,
    MedicalPlan,
    MedicalRequest,
    MedicalResult,
    Status,
    UndoResult,
)

router = APIRouter(prefix="/api")


class PreviewRequest(BaseModel):
    entries: list[EntryInput] = Field(min_length=1)


class PreviewResponse(BaseModel):
    plans: list[EntryPlan]


class CommitRequest(PreviewRequest):
    user: str = Field(min_length=1)
    dry_run: bool = False


class UserRequest(BaseModel):
    user: str = Field(min_length=1)


class HeaderFixRequest(UserRequest):
    fields: list[Literal["date", "day_type", "sheet_no"]] = Field(min_length=1)
    approve: bool = False  # the user saw the old and new values and said yes


async def run_service(request: Request, fn: Callable[[EntryService], Any]) -> Any:
    """Run ``fn(service)`` on the Excel thread and map workbook errors to HTTP errors."""
    service: EntryService = request.app.state.get_service()
    try:
        return await request.app.state.worker.run(fn, service)
    except NotConnectedError as exc:
        service.disconnect()  # reattach on the next call
        raise HTTPException(503, str(exc)) from exc
    except WorkbookError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/status", response_model=Status)
async def get_status(request: Request) -> Status:
    if (reason := request.app.state.excel_disabled) is not None:
        return Status(connected=False, error=reason)
    if not request.app.state.has_service():
        return Status(connected=False, error="No workbook chosen yet.")
    return await run_service(request, lambda s: s.status())


@router.get("/master", response_model=MasterView)
async def master(request: Request, fresh: bool = False) -> MasterView:
    """Workers (Labour Detail order = block order), activity codes, day types, sheets."""
    return await run_service(request, lambda s: s.master_view(fresh))


@router.get("/days/{sheet}", response_model=DayView)
async def day(sheet: str, request: Request, fresh: bool = False) -> DayView:
    """One day sheet: header with its checks, and every entry with computed values and issues."""
    return await run_service(request, lambda s: s.day_view(sheet, fresh))


@router.get("/days/{sheet}/build", response_model=DayBuild)
async def day_build(sheet: str, request: Request, window: int = 3) -> DayBuild:
    """Crews for an empty sheet from each worker's last entry (up to ``window`` days back)."""
    return await run_service(request, lambda s: s.day_build(sheet, min(max(window, 1), 7)))


@router.post("/days/{sheet}/header-fix", response_model=HeaderFixResult)
async def header_fix(sheet: str, body: HeaderFixRequest, request: Request) -> HeaderFixResult:
    """Write the expected date / day type / sheet number (F3, H3, F4). Needs ``approve``: header
    cells are outside the normal input cells (PLAN.md §2 rule 2)."""
    if not body.approve:
        raise HTTPException(422, "A header fix needs the user's explicit approval.")
    return await run_service(request, lambda s: s.fix_header(sheet, body.fields, body.user))


class MedicalWriteRequest(MedicalRequest):
    user: str = Field(min_length=1)
    approve: bool = False  # adding a Labour Detail row needs the user's explicit approval


@router.post("/medical/preview", response_model=MedicalPlan)
async def medical_preview(body: MedicalRequest, request: Request) -> MedicalPlan:
    """The medical line, its Labour Detail row (new or existing), the dates and every check."""
    return await run_service(request, lambda s: s.medical_preview(body))


@router.post("/medical", response_model=MedicalResult)
async def medical(body: MedicalWriteRequest, request: Request) -> MedicalResult:
    """Add '<base> M' to Labour Detail if needed (one batch), then write the days (another)."""
    if not body.approve:
        raise HTTPException(422, "Medical leave needs the user's explicit approval.")
    req = MedicalRequest(**body.model_dump(exclude={"user", "approve"}))
    return await run_service(request, lambda s: s.medical_leave(req, body.user))


@router.post("/preview", response_model=PreviewResponse)
async def preview(body: PreviewRequest, request: Request) -> PreviewResponse:
    """Plan and check entries against the cached sheets (fast; for typing); writes nothing.
    A commit re-reads the sheets and checks again."""
    return PreviewResponse(plans=await run_service(request, lambda s: s.preview(body.entries)))


@router.post("/entries", response_model=CommitResult)
async def commit(body: CommitRequest, request: Request) -> CommitResult:
    """Write a batch (or check it with ``dry_run``). Status ``rejected`` lists what blocks it."""
    return await run_service(
        request, lambda s: s.commit(body.entries, body.user, dry_run=body.dry_run)
    )


@router.get("/batches", response_model=list[Batch])
async def batches(request: Request, limit: int = 20) -> list[Batch]:
    return await run_service(request, lambda s: s.recent_batches(min(max(limit, 1), 200)))


@router.post("/batches/{batch_id}/undo", response_model=UndoResult)
async def undo(batch_id: int, body: UserRequest, request: Request) -> UndoResult:
    return await run_service(request, lambda s: s.undo(batch_id, body.user))


@router.post("/save")
async def save(request: Request) -> dict[str, bool]:
    """Save the workbook in Excel (only on the user's request, PLAN.md §8)."""
    await run_service(request, lambda s: s.save())
    return {"saved": True}
