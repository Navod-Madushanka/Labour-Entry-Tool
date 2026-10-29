"""Printing time cards (``/api/timecards``): one card per calling name, printed by Excel.

For each name the job writes it into the time card's Calling Name cell, lets Excel fill the card,
and prints the sheet with the page setup and printer chosen in Excel (no print dialog). It runs
card by card on the Excel thread, so it can be stopped between cards; at the end the cell gets
its original value back. Nothing is saved.
"""

from __future__ import annotations

import threading
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.entries import run_service
from app.excel.adapter import WorkbookError
from app.service import EntryService, TimeCardSheet

router = APIRouter(prefix="/api/timecards")

PAUSE = 1.0  # seconds between cards: lets the print queue take each job in turn


class PrintRequest(BaseModel):
    sheet: str
    cell: str
    names: list[str] = Field(min_length=1, max_length=2000)
    copies: int = Field(1, ge=1, le=5)
    user: str = Field(min_length=1)


class Job(BaseModel):
    running: bool = False
    practice: bool = False
    sheet: str | None = None
    total: int = 0
    done: int = 0
    current: str | None = None
    printed: list[str] = Field(default_factory=list)
    stopped: bool = False
    error: str | None = None
    user: str | None = None


class _State:
    def __init__(self) -> None:
        self.job = Job()
        self.stop = threading.Event()
        self.lock = threading.Lock()


def _state(request: Request) -> _State:
    if not hasattr(request.app.state, "timecards"):
        request.app.state.timecards = _State()
    return request.app.state.timecards


@router.get("", response_model=list[TimeCardSheet])
async def sheets(request: Request) -> list[TimeCardSheet]:
    return await run_service(request, lambda s: s.timecard_sheets())


@router.get("/job", response_model=Job)
def job(request: Request) -> Job:
    return _state(request).job


@router.post("/stop", response_model=Job)
def stop(request: Request) -> Job:
    _state(request).stop.set()
    return _state(request).job


@router.post("/print", response_model=Job)
async def start(body: PrintRequest, request: Request) -> Job:
    st = _state(request)
    with st.lock:
        if st.job.running:
            raise HTTPException(409, "Time cards are already printing. Wait, or press Stop.")
        service: EntryService = request.app.state.get_service()
        known = await run_service(request, lambda s: {w.calling_name for w in s.master().workers})
        missing = [n for n in body.names if n not in known]
        if missing:
            raise HTTPException(422, f"Not in Labour Detail: {', '.join(missing[:10])}")
        original = await run_service(request, lambda s: s.timecard_cell(body.sheet, body.cell))
        st.stop.clear()
        st.job = Job(running=True, practice=service.mode == "demo", sheet=body.sheet,
                     total=len(body.names), user=body.user)  # fmt: skip
    worker = request.app.state.worker
    threading.Thread(target=_run, args=(st, worker, service, body, original), daemon=True).start()
    return st.job


def _run(st: _State, worker, service: EntryService, body: PrintRequest, original) -> None:
    job = st.job
    try:
        for name in body.names:
            if st.stop.is_set():
                job.stopped = True
                break
            job.current = name
            worker.call(service.print_timecard, body.sheet, body.cell, name, body.copies)
            job.printed.append(name)
            job.done += 1
            time.sleep(0.15 if job.practice else PAUSE)
    except (WorkbookError, KeyError, ValueError) as exc:
        job.error = str(exc)
    except Exception as exc:  # keep the job state truthful whatever happens
        job.error = f"Printing stopped: {exc}"
    finally:
        try:
            worker.call(service.restore_timecard_cell, body.sheet, body.cell, original)
        except Exception as exc:
            job.error = (
                job.error + " " if job.error else ""
            ) + f"Could not put back {body.cell}: {exc}"
        job.current = None
        job.running = False
