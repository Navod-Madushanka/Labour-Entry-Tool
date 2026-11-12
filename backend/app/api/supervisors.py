"""Supervisors and their manpower sheets (``/api/supervisors``, ``/api/supervisor-sheets``).

At each push the user says whose manpower sheet (paper) the entries are from. The answer is kept
with the push in the change log (``sheet_owners``, see app/audit/store.py), so a day's entries can
be looked up later by supervisor and compared with that paper. The list of names offered is the
supervisors used so far (most recent first) plus names typed in by hand; removing a name only takes
it off that list: the sheets it was given stay.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.entries import run_service
from app.audit.store import Lost, Owned, Review
from app.domain.losttime import CAUSE_IDS, CAUSES, Cause
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


class ReviewBody(BaseModel):
    sheet: str = Field(min_length=1)
    supervisor: str = Field(min_length=1, max_length=80)
    status: Literal["ok", "problem", "cleared"]
    note: str | None = Field(None, max_length=500)
    fingerprint: str = Field(max_length=200)  # the sheet as reviewed, to see later changes
    user: str = Field(min_length=1)


@router.get("/supervisor-reviews", response_model=list[Review])
async def reviews(request: Request) -> list[Review]:
    """The latest review of each supervisor's sheet in this workbook."""
    return await run_service(request, lambda s: s.audit.reviews(s.workbook.name))


@router.post("/supervisor-reviews", response_model=list[Review])
async def add_review(body: ReviewBody, request: Request) -> list[Review]:
    """A supervisor's sheet checked against the paper: matches (ok), or a problem (with a note);
    "cleared" takes a review back."""
    note = (body.note or "").strip() or None
    if body.status == "problem" and not note:
        raise HTTPException(422, "Say what the problem is.")

    def save(s):
        s.audit.review(body.user.strip(), s.workbook.name, body.sheet, body.supervisor,
                       body.status, note, body.fingerprint)  # fmt: skip
        return s.audit.reviews(s.workbook.name)

    return await run_service(request, save)


# --- lost-time reasons and day disruptions (roadmap #5) -------------------------------------------


class LostView(BaseModel):
    causes: list[Cause]
    items: list[Lost]


class LostBody(BaseModel):
    user: str = Field(min_length=1, max_length=80)
    sheet: str = Field(min_length=1, max_length=10)
    supervisor: str | None = Field(None, max_length=80)  # None: the whole day
    causes: list[str] = Field(default_factory=list, max_length=8)
    note: str | None = Field(None, max_length=300)


@router.get("/lost-time", response_model=LostView)
async def lost_time(request: Request) -> LostView:
    """The causes to choose from, and every reason and day tag given in this workbook."""
    return LostView(
        causes=CAUSES, items=await run_service(request, lambda s: s.audit.lost(s.workbook.name))
    )


@router.post("/lost-time", response_model=LostView)
async def set_lost_time(body: LostBody, request: Request) -> LostView:
    """Give (or change, or clear with no causes) the reason for a supervisor sheet's unallocated
    hours, or the disruption of a whole day. Kept in the tool's log; Excel is not changed."""
    if bad := [c for c in body.causes if c not in CAUSE_IDS]:
        raise HTTPException(422, f"Unknown cause: {bad[0]}")
    causes = list(dict.fromkeys(body.causes))
    note = (body.note or "").strip() or None
    supervisor = clean_name(body.supervisor or "") or None

    def save(s):
        s.audit.set_lost(body.user.strip(), s.workbook.name, body.sheet, supervisor, causes, note)
        return LostView(causes=CAUSES, items=s.audit.lost(s.workbook.name))

    return await run_service(request, save)
