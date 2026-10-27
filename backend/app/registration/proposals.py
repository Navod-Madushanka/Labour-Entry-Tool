"""Employee-code proposals for Labour Detail and the registration conflict report (Phase 4).

Pure functions. For every worker whose code is blank, ``#N/A``, 0 or malformed:
- the code from a registration row with the same calling name (normalised: ``INH22`` = ``INH-22``);
- otherwise, for a role-suffix code (``INC-46 M``), its base code's employee code;
- otherwise no proposal (e.g. ``INH-21``: not registered) — left for the office.

Calling names are authoritative (office decision); an ID that disagrees is reported, not blocking.
A code already used by a different person is a hard conflict: never pre-selected.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from typing import Literal

from pydantic import BaseModel, Field, computed_field

from app.domain.codes import (
    EMPLOYEE_CODE_RE,
    EmployeeCodeStatus,
    base_calling_name,
    cell_text,
    employee_code_status,
    normalise_code,
    parse_calling_name,
    person_key,
)
from app.domain.models import CellValue, MasterData, Worker
from app.registration.checks import entry_form, id_kind
from app.registration.reader import RegistrationRow


class CodeProposal(BaseModel):
    row: int
    calling_name: str
    current: CellValue = None
    status: EmployeeCodeStatus
    proposed: str | None = None
    source: Literal["registration", "base code"] | None = None
    found_in: str | None = None  # "file / sheet row n" or the base calling name
    notes: list[str] = Field(default_factory=list)  # soft: shown, still selectable
    conflicts: list[str] = Field(default_factory=list)  # hard: not selectable

    @computed_field
    @property
    def selectable(self) -> bool:
        return self.proposed is not None and not self.conflicts


class IdConflict(BaseModel):
    kind: Literal["name differs", "one character", "not found"]
    registration: str  # where: file / sheet row
    calling_name: str  # as registered (entry-sheet form)
    worker: str | None = None  # Labour Detail calling name with that ID
    message: str


def _id(value: CellValue) -> str | None:
    text = normalise_code(value)
    return text or None


def _code(value: CellValue) -> str | None:
    text = cell_text(value).strip().upper()
    return text if EMPLOYEE_CODE_RE.match(text) else None


def propose_codes(
    master: MasterData, registrations: Iterable[RegistrationRow]
) -> list[CodeProposal]:
    workers = master.workers
    by_name = {normalise_code(w.calling_name): w for w in workers}
    used: dict[str, list[Worker]] = defaultdict(list)  # valid code -> workers holding it
    for w in workers:
        if employee_code_status(w.employee_code) == EmployeeCodeStatus.VALID:
            used[w.employee_code].append(w)

    registered: dict[str, list[RegistrationRow]] = defaultdict(list)  # name -> rows with a code
    code_names: dict[str, set[str]] = defaultdict(set)  # code -> registered calling names
    for r in registrations:
        form, code = entry_form(r.calling_name), _code(r.emp_code)
        if form and code:
            registered[normalise_code(form)].append(r)
            code_names[code].add(normalise_code(form))

    out: list[CodeProposal] = []
    for w in workers:
        status = employee_code_status(w.employee_code)
        if status == EmployeeCodeStatus.VALID:
            continue
        p = CodeProposal(row=w.row, calling_name=w.calling_name, current=w.employee_code,
                         status=status)  # fmt: skip
        rows = registered.get(normalise_code(w.calling_name), [])
        codes = {_code(r.emp_code) for r in rows}
        if len(codes) > 1:
            p.conflicts.append(f"Registered with {len(codes)} different codes: "
                               f"{', '.join(sorted(codes))}.")  # fmt: skip
        elif rows:
            r = rows[0]
            p.proposed, p.source = _code(r.emp_code), "registration"
            p.found_in = f"{r.where} row {r.row}"
            reg_id, ld_id = _id(r.id_no), _id(w.id_no)
            if reg_id and ld_id and reg_id != ld_id:
                p.notes.append("ID number differs from the registration (calling names win).")
            if len(code_names[p.proposed]) > 1:
                others = sorted(code_names[p.proposed] - {normalise_code(w.calling_name)})
                p.notes.append(f"The registration also gives {p.proposed} to {', '.join(others)}.")
        else:
            parsed = parse_calling_name(w.calling_name)
            base = by_name.get(normalise_code(base_calling_name(w.calling_name) or ""))
            if parsed and parsed.role and base is not None:
                if employee_code_status(base.employee_code) == EmployeeCodeStatus.VALID:
                    p.proposed, p.source = base.employee_code, "base code"
                    p.found_in = base.calling_name
                    if _id(w.id_no) is None:
                        p.notes.append(f"No ID on this row; {base.calling_name} has one.")
                else:
                    p.conflicts.append(f"Base {base.calling_name} has no valid code either.")
            else:
                p.conflicts.append("No registration row with a code for it in the loaded files.")
        if p.proposed:  # the same code on a different person is never pre-selected
            holders = [h for h in used.get(p.proposed, [])
                       if person_key(h.calling_name) != person_key(w.calling_name)]  # fmt: skip
            if holders:
                names = ", ".join(h.calling_name for h in holders)
                p.conflicts.append(f"{p.proposed} is already used by {names} in Labour Detail.")
        out.append(p)
    return out


def id_conflicts(master: MasterData, registrations: Iterable[RegistrationRow]) -> list[IdConflict]:
    """Registration rows of this workbook's groups (e.g. IN) checked against Labour Detail IDs."""
    groups = {p.group for w in master.workers if (p := parse_calling_name(w.calling_name))}
    by_id: dict[str, list[Worker]] = defaultdict(list)
    for w in master.workers:
        if (key := _id(w.id_no)) is not None:
            by_id[key].append(w)
    out: list[IdConflict] = []
    for r in registrations:
        form = entry_form(r.calling_name)
        if not form or form[:2] not in groups or r.id_no is None:
            continue
        reg_id = _id(r.id_no)
        where = f"{r.where} row {r.row}"
        matches = by_id.get(reg_id or "", [])
        if matches:
            names = {normalise_code(m.calling_name) for m in matches}
            if normalise_code(form) not in names:
                worker = ", ".join(m.calling_name for m in matches)
                out.append(IdConflict(kind="name differs", registration=where, calling_name=form,
                                      worker=worker, message=f"Registered as {form}; the same ID "
                                      f"is {worker} in Labour Detail."))  # fmt: skip
            continue
        near = [w for key, ws in by_id.items() if _one_apart(key, reg_id or "") for w in ws]
        if near:
            worker = ", ".join(w.calling_name for w in near)
            out.append(IdConflict(kind="one character", registration=where, calling_name=form,
                                  worker=worker, message=f"{form}'s ID differs by one character "
                                  f"from {worker}'s in Labour Detail."))  # fmt: skip
        elif id_kind(r.id_no)[0] != "blank":
            out.append(IdConflict(kind="not found", registration=where, calling_name=form,
                                  message=f"{form}'s ID is not in Labour Detail."))  # fmt: skip
    return out


def _one_apart(a: str, b: str) -> bool:
    """Edit distance exactly 1 (one character changed, added or removed)."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b, strict=True)) == 1
    short, long_ = sorted((a, b), key=len)
    return any(long_[:i] + long_[i + 1 :] == short for i in range(len(long_)))
