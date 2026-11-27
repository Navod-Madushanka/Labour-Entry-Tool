"""Rolling snapshots of the open workbook (app/snapshots.py): the list, the switch, a copy now,
and opening a copy (or its folder) on this PC."""

from __future__ import annotations

import asyncio
import os
import sys

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app import snapshots
from app.api.entries import EXCEL_WAIT, STUCK, busy_text

router = APIRouter(prefix="/api/snapshots")


class SnapshotsView(BaseModel):
    on: bool
    every_min: int
    folder: str
    note: str | None = None
    items: list[snapshots.Snapshot]


async def _name(request: Request) -> str:
    service = request.app.state.get_service()
    return await request.app.state.get_worker().run(lambda: service.workbook.name)


@router.get("", response_model=SnapshotsView)
async def view(request: Request) -> SnapshotsView:
    name = await _name(request)
    service = request.app.state.get_service()
    return SnapshotsView(on=snapshots.enabled(request.app), every_min=int(snapshots.SNAP_EVERY // 60),
                         folder=str(snapshots.book_dir(name)), items=snapshots.listing(name),
                         note=getattr(service, "snapshot_note", None))  # fmt: skip


class OnRequest(BaseModel):
    on: bool


@router.post("/switch", response_model=SnapshotsView)
async def switch(body: OnRequest, request: Request) -> SnapshotsView:
    snapshots.set_enabled(request.app, body.on)
    return await view(request)


@router.post("/take", response_model=SnapshotsView)
async def take_now(request: Request) -> SnapshotsView:
    """A copy now (also in practice mode, to try it)."""
    worker = request.app.state.get_worker()
    if (stuck := worker.busy_for()) > STUCK:
        raise HTTPException(503, busy_text(stuck))
    try:
        await asyncio.wait_for(worker.run(snapshots.take, request.app.state.get_service()), EXCEL_WAIT)
    except TimeoutError as exc:
        raise HTTPException(504, busy_text(EXCEL_WAIT)) from exc
    except Exception as exc:
        raise HTTPException(409, f"The copy was not made: {exc}") from exc
    return await view(request)


class OpenRequest(BaseModel):
    file: str | None = None  # a listed copy; none: the folder


@router.post("/open")
async def open_copy(body: OpenRequest, request: Request) -> dict:
    """Open a copy in Excel (a separate workbook: the one in use is not touched), or the folder."""
    name = await _name(request)
    try:
        target = snapshots.resolve(name, body.file) if body.file else snapshots.book_dir(name)
    except FileNotFoundError as exc:
        raise HTTPException(404, "That copy is not there any more.") from exc
    target.mkdir(parents=True, exist_ok=True) if not body.file else None
    if sys.platform != "win32":
        raise HTTPException(501, f"Open it on the PC running the tool: {target}")
    os.startfile(str(target))  # noqa: S606 (a path the tool made itself)
    return {"opened": str(target)}
