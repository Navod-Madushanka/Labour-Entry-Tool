"""The start page (``/api/setup``): choose the workbook, check it, fix it, get ready.

1. The user drops the .xlsb on the page, browses to it (a file dialog on this PC), or picks a
   workbook already open in Excel.
2. ``check`` reads every sheet and runs the health check; header fixes and employee codes go
   through the normal routes (``/api/days/{sheet}/header-fix``, ``/api/codes/write``).
3. ``readiness`` runs the checks the automation depends on; ``ready`` opens the entry screen.

Live mode writes into the workbook open in Excel (Windows). Practice mode keeps a copy of the
file in memory: nothing reaches Excel or the file.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import sys
import tempfile
import threading
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.api.entries import run_service
from app.audit.backups import BackupManager
from app.audit.store import AuditStore
from app.config import Config
from app.domain.health import HealthReport, run_health
from app.domain.models import SnapshotMeta, WorkbookSnapshot
from app.excel.adapter import WorkbookError
from app.service import EntryService
from app.setup import Readiness, guess_month, month_from_name, next_sheet, readiness

router = APIRouter(prefix="/api/setup")

MAX_UPLOAD = 100 * 1024 * 1024
OPEN_BOOKS_WAIT = 5.0  # seconds
EXCEL_NOT_ANSWERING = (
    "Excel isn't answering. Check Excel for an open message box or dialog (or a cell being "
    "edited), close it, then press Check again."
)
WORKBOOK_TYPES = (".xlsb",)
REGISTRATION_TYPES = (".xlsx", ".xlsm")


class SetupState(BaseModel):
    workbook: str | None = None  # the chosen workbook's file name
    path: str | None = None  # where the tool read it from (a dropped file is a copy)
    mode: Literal["live", "demo"] | None = None
    month: str | None = None
    month_note: str | None = None
    holidays: list[dt.date] = Field(default_factory=list)
    registration_files: list[str] = Field(default_factory=list)
    live_available: bool = False  # Excel can be driven from here (Windows with xlwings)
    browse_available: bool = False  # a file dialog can be shown on this PC
    open_workbooks: list[str] = Field(default_factory=list)  # .xlsb files open in Excel now
    excel_note: str | None = None  # Excel did not answer (a dialog open in it?)
    ready: bool = False  # the user finished the start page


class Session:
    """What the start page has chosen so far (one per server: the tool is for one PC)."""

    def __init__(self, base: Config):
        self.base = base
        self.state = SetupState(
            holidays=list(base.holidays),
            registration_files=[str(p) for p in base.registration_files],
            live_available=live_available(),
            browse_available=sys.platform == "win32",
        )
        self.work = Path(tempfile.mkdtemp(prefix="labour_tool_"))
        self.lock = threading.Lock()
        self._uploads = 0

    def save_upload(self, filename: str, data: bytes) -> Path:
        with self.lock:
            self._uploads += 1
            folder = self.work / str(self._uploads)
        folder.mkdir(parents=True)
        path = folder / (Path(filename).name or "workbook.xlsb")
        path.write_bytes(data)
        return path

    def config(self) -> Config:
        s = self.state
        update: dict = {
            "holidays": s.holidays,
            "registration_files": [Path(p) for p in s.registration_files],
        }
        if s.month:
            update["month"] = s.month
        if s.path:
            update["workbook_file"] = Path(s.path)
        return self.base.model_copy(update=update)


def live_available() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import xlwings  # noqa: F401
    except ImportError:
        return False
    return True


def live_named_service(config: Config, name: str, path: Path | None) -> EntryService:
    from app.excel import xlwings_adapter

    return EntryService(
        lambda: xlwings_adapter.connect_named(name, path, config),
        config,
        AuditStore(config.audit.db),
        BackupManager(config.backups.dir, config.backups.keep),
    )


def practice_service(config: Config, snapshot: WorkbookSnapshot, work: Path) -> EntryService:
    from app.excel.fake_adapter import FakeWorkbook

    fake = FakeWorkbook(snapshot, config.template)
    folder = Path(tempfile.mkdtemp(prefix="practice_", dir=work))
    return EntryService(
        lambda: fake,
        config,
        AuditStore(folder / "audit.sqlite"),
        BackupManager(folder / "backups", config.backups.keep),
        mode="demo",
    )


def _session(request: Request) -> Session:
    return request.app.state.session


def _read(path: Path, config: Config) -> WorkbookSnapshot:
    from app.health import read_snapshot

    try:
        return read_snapshot(path, config.template)
    except Exception as exc:  # not a workbook, wrong layout, damaged
        raise HTTPException(
            422,
            f"Could not read {path.name} as a labour entry workbook ({exc}). "
            "Choose the monthly .xlsb file.",
        ) from exc


def choose(app, path: Path | None, name: str, practice: bool, real_file: bool) -> SetupState:
    """Make ``name`` the workbook of this session. ``path``: a file to read (a dropped copy or the
    real file); ``real_file``: Excel may open ``path`` itself when the workbook is not open."""
    session: Session = app.state.session
    s = session.state
    live = s.live_available and not practice
    snapshot = _read(path, session.base) if path is not None else None
    if snapshot is None and not live:
        raise HTTPException(422, "Practice mode needs the file: drop it here or browse to it.")
    guess = guess_month(name, snapshot) if snapshot else None
    s.workbook, s.path = name, str(path) if path else None
    s.mode, s.ready = ("live" if live else "demo"), False
    s.month = guess.month if guess else month_from_name(name)
    s.month_note = guess.note if guess else None
    config = session.config()
    if live:
        service = live_named_service(config, name, path if real_file else None)
    else:
        service = practice_service(config, snapshot, session.work)
    app.state.set_service(service, config)
    return s


async def _open_books(request: Request) -> list[str]:
    from app.excel import xlwings_adapter

    s = _session(request).state
    try:
        # Excel answers no program while a dialog or message box is open in it: never let that
        # hold up the start page.
        names = await asyncio.wait_for(
            request.app.state.get_worker().run(xlwings_adapter.open_workbook_names), OPEN_BOOKS_WAIT
        )
    except TimeoutError:
        s.excel_note = EXCEL_NOT_ANSWERING
        return []
    except WorkbookError:
        return []
    s.excel_note = None
    return [n for n in names if n.lower().endswith(WORKBOOK_TYPES)]


@router.get("", response_model=SetupState)
async def get_setup(request: Request) -> SetupState:
    s = _session(request).state
    if s.live_available:
        s.open_workbooks = await _open_books(request)
    return s


def _check_name(filename: str, types: tuple[str, ...]) -> str:
    name = Path(filename).name
    if not name.lower().endswith(types):
        raise HTTPException(422, f"{name or 'That file'} is not a {' or '.join(types)} file.")
    return name


async def _body(request: Request) -> bytes:
    data = await request.body()
    if not data:
        raise HTTPException(422, "The file is empty.")
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "The file is too large.")
    return data


@router.post("/upload", response_model=SetupState)
async def upload(request: Request, filename: str = Query(...), practice: bool = False):
    """The file dropped on the page (sent as the raw request body). In live mode it is only
    read for the check; entries go into the workbook of that name open in Excel."""
    name = _check_name(filename, WORKBOOK_TYPES)
    path = _session(request).save_upload(name, await _body(request))
    return choose(request.app, path, name, practice, real_file=False)


class BrowseRequest(BaseModel):
    practice: bool = False


_dialog = threading.Lock()


def ask_for_file(title: str, types: list[tuple[str, str]]) -> Path | None:
    """A file dialog on this PC, in front of the browser."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        picked = filedialog.askopenfilename(parent=root, title=title, filetypes=types)
    finally:
        root.destroy()
    return Path(picked) if picked else None


@router.post("/browse")
def browse(body: BrowseRequest, request: Request) -> dict:
    """Browse for the workbook; Excel opens it if it is not open yet (live mode)."""
    if not _session(request).state.browse_available:
        raise HTTPException(501, "Browsing is not available here: drag the file onto the page.")
    if not _dialog.acquire(blocking=False):
        raise HTTPException(409, "A file dialog is already open (it may be behind this window).")
    try:
        path = ask_for_file(
            "Choose the labour entry workbook",
            [("Excel binary workbook", "*.xlsb"), ("All files", "*.*")],
        )
    except Exception as exc:
        msg = f"Could not show a file dialog ({exc}). Drag the file onto the page."
        raise HTTPException(501, msg) from exc
    finally:
        _dialog.release()
    if path is None:
        return {"cancelled": True}
    name = _check_name(path.name, WORKBOOK_TYPES)
    state = choose(request.app, path, name, body.practice, real_file=True)
    return {"cancelled": False, "state": state.model_dump(mode="json")}


class OpenRequest(BaseModel):
    name: str = Field(min_length=1)


@router.post("/open", response_model=SetupState)
def use_open(body: OpenRequest, request: Request) -> SetupState:
    """Use a workbook that is already open in Excel (live mode only)."""
    if not _session(request).state.live_available:
        raise HTTPException(501, "Live Excel is not available on this computer.")
    return choose(request.app, None, _check_name(body.name, WORKBOOK_TYPES), False, False)


def _require(request: Request) -> Session:
    session = _session(request)
    if session.state.workbook is None:
        raise HTTPException(409, "Choose the workbook first.")
    return session


@router.post("/check", response_model=HealthReport)
async def check(request: Request) -> HealthReport:
    """Read every sheet of the chosen workbook (fresh) and run the health check."""
    session = _require(request)

    def run(service: EntryService) -> HealthReport:
        snap = service.snapshot()
        s = session.state
        if s.path is None:  # chosen from Excel's open workbooks: the sheets tell the month too
            guess = guess_month(s.workbook, snap)
            if guess.month and guess.month != s.month:
                s.month, s.month_note = guess.month, guess.note
                _apply(request, session)
        if s.month is None:
            raise ValueError(
                "Could not tell which month this workbook is for: put the month in the file "
                "name (e.g. 'October 2026') or the date in F3 of sheet 1."
            )
        config = request.app.state.config
        return run_health(snap, config.month_start, config.holidays, config.template)

    return await run_service(request, run)


def _apply(request: Request, session: Session) -> None:
    config = session.config()
    request.app.state.config = config
    if (service := request.app.state.service) is not None:
        service.set_config(config)


class HolidaysRequest(BaseModel):
    holidays: list[dt.date]


@router.post("/holidays", response_model=SetupState)
def set_holidays(body: HolidaysRequest, request: Request) -> SetupState:
    """Holidays for this session (the office confirms them month by month)."""
    session = _session(request)
    session.state.holidays = sorted(set(body.holidays))
    _apply(request, session)
    return session.state


@router.post("/registration", response_model=SetupState)
async def add_registration(request: Request, filename: str = Query(...)) -> SetupState:
    """A registration workbook dropped on the page, for the employee-code proposals."""
    session = _session(request)
    name = _check_name(filename, REGISTRATION_TYPES)
    path = session.save_upload(name, await _body(request))
    files = [p for p in session.state.registration_files if Path(p).name != name]
    session.state.registration_files = [*files, str(path)]
    _apply(request, session)
    return session.state


@router.get("/readiness", response_model=Readiness)
async def get_readiness(request: Request) -> Readiness:
    """The checks the automation depends on, on the sheets as read by the last check (and any
    fix since)."""
    _require(request)

    def run(service: EntryService) -> Readiness:
        snap = WorkbookSnapshot(
            meta=_meta(service),
            master=service.master(),
            days=[service.day(s) for s in service.workbook.day_sheet_names()],
        )
        config = service.config
        crews = None
        if (start := next_sheet(snap)) is not None and start.isdigit():
            try:
                build = service.day_build(start)
                crews = (build.candidates, len(build.crews))
            except (KeyError, ValueError):
                pass
        return readiness(
            snap,
            config.month_start,
            config.holidays,
            config.template,
            service.mode,
            service.backups.directory,
            crews,
        )

    return await run_service(request, run)


def _meta(service: EntryService) -> SnapshotMeta:
    return SnapshotMeta(source_name=service.workbook.name, read_at=dt.datetime.now().astimezone())


class ReadyRequest(BaseModel):
    ready: bool = True


@router.post("/ready", response_model=SetupState)
def set_ready(body: ReadyRequest, request: Request) -> SetupState:
    session = _require(request) if body.ready else _session(request)
    session.state.ready = body.ready
    return session.state
