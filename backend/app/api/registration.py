"""Registration checks and employee-code fixes (PLAN.md §6 Phase 4).

``/api/registration`` reads the files in ``config.registration_files`` (read-only, no Excel).
``/api/codes`` proposes codes for Labour Detail rows with a blank/#N/A/0 code; ``/api/codes/write``
writes the ones the user approved into Labour Detail G (backup, audit, undo like any batch).
"""

from __future__ import annotations

import csv
import io
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.entries import run_service
from app.config import Config
from app.health import write_issues_csv
from app.registration.checks import RegistrationReport, check_registrations
from app.registration.proposals import CodeProposal, IdConflict, id_conflicts, propose_codes
from app.registration.reader import RegistrationFile, RegistrationRow, read_registration
from app.service import ActivityAddResult, CodeWrite, CodeWriteResult

router = APIRouter(prefix="/api")


class FileCache:
    """Registration workbooks, re-read only when a file changes."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._files: dict[str, tuple[tuple, RegistrationFile]] = {}

    def load(self, config: Config) -> tuple[list[RegistrationFile], list[str]]:
        files, missing = [], []
        with self._lock:
            for path in config.registration_files:
                p = Path(path)
                if not p.exists():
                    missing.append(str(p))
                    continue
                stat = p.stat()
                key = (stat.st_size, stat.st_mtime_ns)
                cached = self._files.get(str(p))
                if cached is None or cached[0] != key:
                    cached = (key, read_registration(p))
                    self._files[str(p)] = cached
                files.append(cached[1])
        return files, missing


class RegistrationResponse(RegistrationReport):
    missing: list[str] = Field(default_factory=list)  # configured files that are not there


class CodesResponse(BaseModel):
    files: list[str]
    proposals: list[CodeProposal]
    conflicts: list[IdConflict]


class CodeWriteRequest(BaseModel):
    user: str = Field(min_length=1)
    items: list[CodeWrite] = Field(min_length=1)
    approve: bool = False


def _files(request: Request) -> tuple[list[RegistrationFile], list[str]]:
    return request.app.state.registrations.load(request.app.state.config)


def _rows(files: list[RegistrationFile]) -> list[RegistrationRow]:
    return [r for f in files for r in f.rows]


@router.get("/registration", response_model=RegistrationResponse)
def registration(request: Request) -> RegistrationResponse:
    files, missing = _files(request)
    report = check_registrations(files)
    return RegistrationResponse(**report.model_dump(), missing=missing)


@router.get("/registration.csv")
def registration_csv(request: Request) -> Response:
    files, _ = _files(request)
    buf = io.StringIO()
    write_issues_csv(check_registrations(files).issues, buf)
    return _csv(buf.getvalue(), "registration_check.csv")


@router.get("/codes", response_model=CodesResponse)
async def codes(request: Request) -> CodesResponse:
    files, _ = _files(request)
    rows = _rows(files)

    def build(s):
        master = s.master(fresh=True)
        return CodesResponse(files=[f.name for f in files], proposals=propose_codes(master, rows),
                             conflicts=id_conflicts(master, rows))  # fmt: skip

    return await run_service(request, build)


@router.get("/codes/conflicts.csv")
async def conflicts_csv(request: Request) -> Response:
    files, _ = _files(request)
    rows = _rows(files)
    found = await run_service(request, lambda s: id_conflicts(s.master(), rows))
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["kind", "registration", "calling_name", "labour_detail", "message"])
    for c in found:
        writer.writerow([c.kind, c.registration, c.calling_name, c.worker or "", c.message])
    return _csv(buf.getvalue(), "registration_conflicts.csv")


@router.post("/codes/write", response_model=CodeWriteResult)
async def write_codes(body: CodeWriteRequest, request: Request) -> CodeWriteResult:
    """Labour Detail G is outside the normal input cells: the user must approve the list."""
    if not body.approve:
        raise HTTPException(422, "Writing employee codes needs the user's explicit approval.")
    return await run_service(request, lambda s: s.write_codes(body.items, body.user))


class ActivityAddRequest(BaseModel):
    codes: list[str] = Field(min_length=1, max_length=50)
    user: str = Field(min_length=1)
    approve: bool = False


@router.post("/activities/add", response_model=ActivityAddResult)
async def add_activities(body: ActivityAddRequest, request: Request) -> ActivityAddResult:
    """New codes go into the Labour Detail activity list, outside the input cells: the user must
    approve them."""
    if not body.approve:
        raise HTTPException(422, "Adding activity codes needs the user's explicit approval.")
    return await run_service(request, lambda s: s.add_activities(body.codes, body.user))


def _csv(text: str, name: str) -> Response:
    return Response("﻿" + text, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})  # fmt: skip
