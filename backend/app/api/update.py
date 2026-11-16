"""Updates of the Windows package (app/updater.py): what is installed, what is new, install."""

from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.updater import UpdateState, Updater

router = APIRouter(prefix="/api/update")


def _updater(request: Request) -> Updater:
    return request.app.state.updater


@router.get("", response_model=UpdateState)
def state(request: Request) -> UpdateState:
    return _updater(request).state


@router.post("/check", response_model=UpdateState)
async def check(request: Request) -> UpdateState:
    """Check now (and download a newer, signed version in the background of this request)."""
    return await run_in_threadpool(_updater(request).check)


class AutoRequest(BaseModel):
    auto: bool


@router.post("/auto", response_model=UpdateState)
def set_auto(body: AutoRequest, request: Request) -> UpdateState:
    return _updater(request).set_auto(body.auto)


@router.post("/install")
async def install(request: Request) -> dict:
    """Restart into the downloaded, verified version. The tool stops a moment later (after this
    answer has gone); the update script swaps the program folder and starts it again."""
    if not _updater(request).install():
        raise HTTPException(409, "No verified update is ready to install.")

    async def stop() -> None:
        await asyncio.sleep(1.0)
        os._exit(0)  # the swap script waits for this process to end

    asyncio.get_running_loop().create_task(stop())
    return {"restarting": True}
