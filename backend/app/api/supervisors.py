"""Supervisors and their manpower sheets (``/api/supervisors``, ``/api/supervisor-sheets``).

At each push the user says whose manpower sheet (paper) the entries are from. The answer is kept
with the push in the change log (``sheet_owners``, see app/audit/store.py), so a day's entries can
be looked up later by supervisor and compared with that paper. The list of names offered is the
supervisors used so far (most recent first) plus names typed in by hand; removing a name only takes
it off that list: the sheets it was given stay.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.entries import run_service
from app.audit.store import Owned
from app.service import clean_name

router = APIRouter(prefix="/api")

KEY = "supervisors"  # in the settings file: {"names": [...typed by hand], "hidden": [...]}


class Supervisor(BaseModel):
    name: str
    last_used: str | None = None  # the latest push with this name (None: typed, not used yet)


class NameBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class RenameBody(BaseModel):
    old: str = Field(min_length=1, max_length=80)
    new: str = Field(min_length=1, max_length=80)


class ReassignBody(BaseModel):
    ids: list[int] = Field(min_length=1)
    supervisor: str = Field(min_length=1, max_length=80)


def _settings(request: Request):
    return request.app.state.session.settings


def _lists(request: Request) -> tuple[list[str], list[str]]:
    saved = _settings(request).get_key(KEY)
    names = [n for n in saved.get("names", []) if isinstance(n, str)]
    hidden = [n for n in saved.get("hidden", []) if isinstance(n, str)]
    return names, hidden


def _save(request: Request, names: list[str], hidden: list[str]) -> None:
    _settings(request).set_key(KEY, names=names, hidden=hidden)


@router.get("/supervisors", response_model=list[Supervisor])
async def supervisors(request: Request) -> list[Supervisor]:
    used = await run_service(request, lambda s: s.audit.supervisors())
    names, hidden = _lists(request)
    gone = {h.casefold() for h in hidden}
    out = [Supervisor(name=n, last_used=last) for n, last in used if n.casefold() not in gone]
    seen = {s.name.casefold() for s in out}
    extra = sorted((n for n in names if n.casefold() not in seen | gone), key=str.casefold)
    return out + [Supervisor(name=n) for n in extra]


@router.post("/supervisors", response_model=list[Supervisor])
async def add(body: NameBody, request: Request) -> list[Supervisor]:
    name = clean_name(body.name)
    if not name:
        raise HTTPException(422, "Type the supervisor's name.")
    names, hidden = _lists(request)
    hidden = [h for h in hidden if h.casefold() != name.casefold()]
    if all(n.casefold() != name.casefold() for n in names):
        names.append(name)
    _save(request, names, hidden)
    return await supervisors(request)


@router.post("/supervisors/remove", response_model=list[Supervisor])
async def remove(body: NameBody, request: Request) -> list[Supervisor]:
    """Off the list offered at push; the sheets already given to this name keep it."""
    name = clean_name(body.name)
    names, hidden = _lists(request)
    names = [n for n in names if n.casefold() != name.casefold()]
    if all(h.casefold() != name.casefold() for h in hidden):
        hidden.append(name)
    _save(request, names, hidden)
    return await supervisors(request)


@router.post("/supervisors/rename", response_model=list[Supervisor])
async def rename(body: RenameBody, request: Request) -> list[Supervisor]:
    """A name spelled wrong: every sheet given to it moves to the new spelling."""
    old, new = clean_name(body.old), clean_name(body.new)
    if not new:
        raise HTTPException(422, "Type the new name.")
    await run_service(request, lambda s: s.audit.rename_supervisor(old, new))
    names, hidden = _lists(request)
    names = [new if n == old else n for n in names]
    hidden = [h for h in hidden if h.casefold() != new.casefold()]
    _save(request, names, hidden)
    return await supervisors(request)


@router.get("/supervisor-sheets", response_model=list[Owned])
async def sheets(request: Request) -> list[Owned]:
    """Every entry of this workbook that was pushed with a supervisor (the latest push of each
    worker and day, undone pushes left out)."""
    return await run_service(request, lambda s: s.audit.owners(s.workbook.name))


@router.post("/supervisor-sheets/reassign", response_model=list[Owned])
async def reassign(body: ReassignBody, request: Request) -> list[Owned]:
    """The wrong supervisor was chosen at push: give these entries to another one."""
    name = clean_name(body.supervisor)
    if not name:
        raise HTTPException(422, "Type the supervisor's name.")
    await run_service(request, lambda s: s.audit.reassign(s.workbook.name, body.ids, name))
    return await sheets(request)
