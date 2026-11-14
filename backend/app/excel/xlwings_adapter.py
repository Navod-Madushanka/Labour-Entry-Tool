"""Live Excel through xlwings/COM (Windows only, PLAN.md §8). Implements ``LiveWorkbook``.

- Attaches to the workbook the user picked on the start page (or the one open workbook matching
  ``workbook_pattern``). Opens it only when the user browsed to its file; never closes or
  unprotects it.
- Bulk reads only: one range read per sheet, turned into the same grid the pyxlsb reader builds.
- One batch per write: calculation set to manual and screen updating off, every range written,
  then both restored and the workbook recalculated.
- COM "call rejected" (the user is editing a cell) is retried for ``busy_timeout`` seconds.

Every call must happen on the ``ExcelWorker`` thread (``com_init``/``com_uninit`` set it up).
The pure helpers at the top run anywhere and are unit-tested on Linux.
"""

from __future__ import annotations

import datetime as dt
import fnmatch
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, TypeVar

from app.config import Config, TemplateConfig
from app.domain.models import CellValue, DaySheet, MasterData, SnapshotMeta, WorkbookSnapshot
from app.domain.writes import RangeWrite
from app.excel.adapter import (
    NotConnectedError,
    ProtectionError,
    WorkbookBusyError,
    WorkbookError,
)
from app.excel.grid import (
    Grid,
    clean_value,
    day_from_grid,
    day_max_col,
    grid_from_rows,
    master_from_grid,
    master_max_col,
)
from app.excel.refs import index_to_col

T = TypeVar("T")

# HRESULTs: Excel busy / in edit mode, and Excel gone.
RPC_E_CALL_REJECTED = -2147418111  # 0x80010001
VBA_E_IGNORE = -2146777998  # 0x800AC472, Excel is in edit mode
RPC_E_SERVERCALL_RETRYLATER = -2147417846  # 0x8001010A
BUSY_HRESULTS = frozenset({RPC_E_CALL_REJECTED, VBA_E_IGNORE, RPC_E_SERVERCALL_RETRYLATER})
RPC_S_CALL_FAILED = -2147023170  # 0x800706BE "the remote procedure call failed"
# RPC server unavailable, call failed, object disconnected: Excel gone (after the retries)
GONE_HRESULTS = frozenset({-2147023174, RPC_S_CALL_FAILED, -2147417848})
# Seen for a moment while Excel prints (or shows a dialog): retried like "busy" before the
# connection is called lost. Not for the print itself, which must never run twice.
TRANSIENT_HRESULTS = frozenset({RPC_S_CALL_FAILED})
PRINT_PATIENCE = 120.0  # seconds a printing Excel may stay busy before the next card gives up

MASTER_MARGIN = 500  # rows read past Labour Detail's last worker row
BLOCK_MARGIN = 10  # day-sheet blocks read past the one of Labour Detail's last worker


# --- Pure helpers ------------------------------------------------------------------------------


def match_books(names: Sequence[str], pattern: str) -> list[str]:
    """Open workbook names matching the config pattern (case-insensitive, like Windows)."""
    return [n for n in names if fnmatch.fnmatch(n.casefold(), pattern.casefold())]


def hresult(exc: BaseException) -> int | None:
    code = getattr(exc, "hresult", None)
    if code is None and exc.args and isinstance(exc.args[0], int):
        code = exc.args[0]
    return code


def is_busy_error(exc: BaseException) -> bool:
    return hresult(exc) in BUSY_HRESULTS


def is_transient_error(exc: BaseException) -> bool:
    """Busy, or a failed call Excel usually answers again a moment later."""
    return hresult(exc) in BUSY_HRESULTS | TRANSIENT_HRESULTS


XL_REFUSED = -2146827284  # 0x800A03EC: Excel's "can't do that here" (protected sheet, bad range…)


def excel_scode(exc: BaseException) -> int | None:
    """The Excel error inside a DISP_E_EXCEPTION: args = (hresult, text, excepinfo, argerr) and
    excepinfo = (wcode, source, description, helpfile, helpcontext, scode)."""
    args = getattr(exc, "args", ())
    info = args[2] if len(args) > 2 else None
    return info[5] if isinstance(info, tuple) and len(info) > 5 else None


def excel_description(exc: BaseException) -> str | None:
    args = getattr(exc, "args", ())
    info = args[2] if len(args) > 2 else None
    return info[2] if isinstance(info, tuple) and len(info) > 2 and info[2] else None


def translate_com_error(exc: BaseException) -> WorkbookError:
    """A COM error as something the user can act on."""
    text = " ".join(str(a) for a in getattr(exc, "args", ()) if a)
    described = excel_description(exc)
    if is_busy_error(exc):
        return WorkbookBusyError(
            "Excel is busy. Finish editing the cell in Excel (press Enter or Esc), then try again."
        )
    if hresult(exc) in GONE_HRESULTS:
        return NotConnectedError("Lost the connection to Excel. Is the workbook still open?")
    if "protect" in text.casefold():
        return ProtectionError(f"Excel refused to change a protected cell: {described or text}")
    if excel_scode(exc) == XL_REFUSED:
        return WorkbookError(
            "Excel refused the request"
            + (f": {described}" if described else ". The sheet may be protected, or a cell locked.")
        )
    return WorkbookError(f"Excel error: {described or text or exc!r}")


def retry_busy(
    fn: Callable[[], T],
    timeout: float,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    transient: bool = True,
) -> T:
    """Call ``fn``; while Excel rejects the call as busy, retry with backoff up to ``timeout``.
    ``transient``: also retry a call that failed for a moment (only for calls safe to repeat)."""
    retry = is_transient_error if transient else is_busy_error
    deadline, delay = clock() + timeout, 0.1
    while True:
        try:
            return fn()
        except Exception as exc:
            if not retry(exc) or clock() + delay > deadline:
                raise
            sleep(delay)
            delay = min(delay * 2, 1.0)


# --- COM thread setup ----------------------------------------------------------------------------


def com_init() -> None:
    import pythoncom  # pywin32

    pythoncom.CoInitialize()


def com_uninit() -> None:
    import pythoncom

    pythoncom.CoUninitialize()


# --- The adapter ---------------------------------------------------------------------------------


def _open_books(xw: Any, timeout: float) -> list[Any]:
    """Every workbook open in Excel. Excel busy (printing, a cell being edited) is waited for: a
    busy Excel is not a lost one."""
    return retry_busy(lambda: [book for app in xw.apps for book in app.books], timeout)


def connect(config: Config) -> XlwingsWorkbook:
    """Attach to the single open workbook matching ``config.workbook_pattern``."""
    try:
        import xlwings as xw
    except ImportError as exc:  # not Windows, or not installed
        raise NotConnectedError(f"Live Excel is not available on this computer ({exc}).") from exc
    try:
        books = _open_books(xw, config.excel.busy_timeout)
    except Exception as exc:
        raise translate_com_error(exc) from exc
    names = match_books([b.name for b in books], config.workbook_pattern)
    if not names:
        raise NotConnectedError(
            f"No open workbook matches {config.workbook_pattern!r}. Open it in Excel first."
        )
    if len(names) > 1:
        raise NotConnectedError(
            f"{len(names)} open workbooks match {config.workbook_pattern!r} ({', '.join(names)}). "
            "Close the others."
        )
    book = next(b for b in books if b.name == names[0])
    return XlwingsWorkbook(book, config.template, config.excel.busy_timeout)


def open_workbook_names() -> list[str]:
    """Names of every workbook open in Excel (empty when Excel is not running)."""
    try:
        import xlwings as xw
    except ImportError:
        return []
    try:
        return retry_busy(lambda: [book.name for app in xw.apps for book in app.books], 10.0)
    except Exception as exc:
        raise translate_com_error(exc) from exc


def connect_named(name: str, path: Path | None, config: Config) -> XlwingsWorkbook:
    """Attach to the open workbook called ``name`` (the one the user picked on the start page).
    Not open and ``path`` known: open it in Excel. Not open and no path: ask the user to open it."""
    try:
        import xlwings as xw
    except ImportError as exc:
        raise NotConnectedError(f"Live Excel is not available on this computer ({exc}).") from exc
    try:
        books = _open_books(xw, config.excel.busy_timeout)
        found = [b for b in books if b.name.casefold() == name.casefold()]
        if len(found) > 1:
            raise NotConnectedError(f"{name} is open twice in Excel. Close one of them.")
        if found:
            book = found[0]
        elif path is not None and Path(path).exists():
            book = xw.Book(str(Path(path).resolve()))
        else:
            raise NotConnectedError(
                f"{name} is not open in Excel. Open it, then press Check again."
            )
    except WorkbookError:
        raise
    except Exception as exc:
        raise translate_com_error(exc) from exc
    return XlwingsWorkbook(book, config.template, config.excel.busy_timeout)


class XlwingsWorkbook:
    def __init__(self, book: Any, template: TemplateConfig, busy_timeout: float = 10.0):
        self.book = book
        self.template = template
        self.busy_timeout = busy_timeout
        # Day-sheet blocks that can hold a worker (block k shows Labour Detail row k): set by
        # read_master, so a day read stops after them instead of reading all 500 blocks through
        # Excel. None until Labour Detail has been read: then the whole sheet is read.
        self._blocks: int | None = None
        self._name: tuple[float, str] | None = None  # (when read, name): see status_name

    def _com(self, fn: Callable[[], T], timeout: float | None = None, transient: bool = True) -> T:
        try:
            return retry_busy(
                fn, self.busy_timeout if timeout is None else timeout, transient=transient
            )
        except WorkbookError:
            raise
        except Exception as exc:
            raise translate_com_error(exc) from exc

    @property
    def name(self) -> str:
        name = self._com(lambda: self.book.name)
        self._name = (time.monotonic(), name)
        return name

    NAME_FRESH = 30.0  # seconds

    def status_name(self) -> str:
        """The name for the status line, polled all day: asked of Excel at most every 30 s (each
        call waits its turn on the Excel thread and can catch Excel mid-edit). Every other use
        (audit log, backups) reads ``name`` fresh. A closed workbook still shows within 30 s."""
        if self._name is None or time.monotonic() - self._name[0] > self.NAME_FRESH:
            return self.name
        return self._name[1]

    @property
    def full_path(self) -> Path | None:
        """Where the workbook is saved (None for a new, unsaved one)."""
        full = self._com(lambda: self.book.fullname)
        return Path(full) if full and ("\\" in full or "/" in full) else None

    # --- reads ---

    def _sheet(self, sheet: str) -> Any:
        try:
            return self._com(lambda: self.book.sheets[sheet])
        except WorkbookError as exc:
            raise KeyError(f"no sheet {sheet!r} in the workbook") from exc

    def read_range(self, sheet: str, address: str) -> list[list[CellValue]]:
        sht = self._sheet(sheet)
        rows = self._com(lambda: sht.range(address).options(ndim=2, err_to_str=True).value)
        return [[clean_value(v) for v in row] for row in rows]

    def _grid(self, sheet: str, last_row: int, last_col: int) -> Grid:
        return grid_from_rows(self.read_range(sheet, f"A1:{index_to_col(last_col)}{last_row}"))

    def read_master(self) -> MasterData:
        t = self.template
        sht = self._sheet(t.master_sheet)
        used = self._com(lambda: sht.used_range.last_cell.row)
        # Formatting far down can stretch the used range to a million rows: never read past the
        # worker rows / activity list (plus a margin for a longer list).
        last = min(max(used, t.master_rows[1]), t.master_rows[1] + MASTER_MARGIN)
        grid = self._grid(t.master_sheet, last, master_max_col(t))
        master = master_from_grid(grid, t)
        if master.workers:
            last_block = t.block_for_master_row(max(w.row for w in master.workers))
            self._blocks = min(t.blocks, last_block + 1 + BLOCK_MARGIN)
        return master

    def day_sheet_names(self) -> list[str]:
        return self.template.day_sheet_names()

    def read_day(self, sheet: str) -> DaySheet:
        """Rows past the blocks that can hold a worker are not read: those blocks have no name,
        so they come out empty, as they are (the INDIAN file: 1,780 rows instead of 3,508)."""
        t = self.template
        last_row = (
            t.block_row(self._blocks - 1) + t.block_size - 1 if self._blocks else t.last_block_row
        )
        return day_from_grid(sheet, self._grid(sheet, last_row, day_max_col(t)), t)

    def snapshot(self) -> WorkbookSnapshot:
        return WorkbookSnapshot(
            meta=SnapshotMeta(source_name=self.name, read_at=dt.datetime.now().astimezone()),
            master=self.read_master(),
            days=[self.read_day(s) for s in self.day_sheet_names()],
        )

    # --- writes ---

    def write_ranges(self, writes: Sequence[RangeWrite]) -> None:
        app = self._com(lambda: self.book.app)
        calculation = self._com(lambda: app.calculation)
        screen = self._com(lambda: app.screen_updating)
        self._com(lambda: setattr(app, "screen_updating", False))
        self._com(lambda: setattr(app, "calculation", "manual"))
        try:
            for w in writes:
                try:
                    sht = self._sheet(w.sheet)
                except KeyError as exc:
                    raise WorkbookError(str(exc)) from exc
                rng = self._com(lambda sht=sht, w=w: sht.range(w.address))
                self._com(lambda rng=rng, w=w: setattr(rng, "value", w.values))
        except BaseException:
            self._restore(app, calculation, screen, report=False)  # the write error wins
            raise
        self._restore(app, calculation, screen, report=True)

    def _restore(self, app: Any, calculation: str, screen: bool, report: bool) -> None:
        """Put calculation and screen updating back. Each step is tried even if another fails;
        a workbook left on manual calculation would silently stop updating its formulas."""
        failed = []
        for label, step in (
            ("calculation", lambda: setattr(app, "calculation", calculation)),
            ("screen updating", lambda: setattr(app, "screen_updating", screen)),
            ("recalculation", app.calculate),
        ):
            try:
                self._com(step)
            except WorkbookError:
                failed.append(label)
        if failed and report:
            raise WorkbookError(
                f"Written, but Excel did not take back: {', '.join(failed)}. In Excel, set "
                f"Formulas > Calculation Options > {calculation.title()} and press F9."
            )

    # --- time cards ---

    def all_sheet_names(self) -> list[str]:
        return self._com(lambda: [s.name for s in self.book.sheets])

    def calling_name_cell(self, sheet: str) -> tuple[str | None, CellValue]:
        """Where the time card's calling name is typed, and what it holds now."""
        from app.timecards import find_input_cell

        sht = self._sheet(sheet)
        values = self._com(lambda: sht.range("A1:L60").options(ndim=2).value)
        try:
            formulas = self._com(lambda: sht.range("A1:L60").formula)
        except WorkbookError:  # a protected sheet with hidden formulas: find it by labels only
            formulas = ()
        cell = find_input_cell(values, formulas)
        current = clean_value(self._com(lambda: sht.range(cell).value)) if cell else None
        return cell, current

    def set_cell(self, sheet: str, cell: str, value: CellValue) -> None:
        sht = self._sheet(sheet)
        self._com(lambda: setattr(sht.range(cell), "value", value))

    def print_card(self, sheet: str, cell: str, calling_name: str, copies: int = 1) -> None:
        """Calling name in, Excel recalculates the card, the sheet prints with its own page setup
        on Excel's current printer (no print dialog)."""
        sht = self._sheet(sheet)
        wait = max(self.busy_timeout, PRINT_PATIENCE)  # the card before may still be printing
        try:
            self._com(lambda: setattr(sht.range(cell), "value", calling_name), timeout=wait)
        except WorkbookBusyError as exc:
            raise WorkbookBusyError(
                f"Excel stayed busy for {wait:.0f} s (still printing the card before, or a message "
                f"open), so {calling_name}'s card was not printed. Check Excel and the printer, "
                "then press Continue."
            ) from exc
        except WorkbookError as exc:
            raise WorkbookError(
                f"Excel did not accept the calling name in {sheet}!{cell} ({exc}). If the sheet is "
                f"protected, unlock {cell} (Format Cells > Protection > untick Locked) or "
                "unprotect the sheet, then try again."
            ) from exc
        try:
            app = self._com(lambda: self.book.app, timeout=wait)
            self._com(app.calculate, timeout=wait)
            # never repeated: a failed-looking print may have printed (only "busy, not started" is)
            self._com(lambda: sht.api.PrintOut(Copies=copies), timeout=wait, transient=False)
        except WorkbookBusyError as exc:
            raise WorkbookBusyError(
                f"Excel stayed busy for {wait:.0f} s, so {calling_name}'s card was not printed. "
                "Check Excel and the printer for an open message (paper, printer offline), close "
                "it, then press Continue."
            ) from exc
        self._wait_ready(app, wait)

    def _wait_ready(self, app: Any, timeout: float) -> None:
        """After PrintOut Excel goes on spooling (its "Printing…" box) and turns calls away: wait
        until it is ready again, so the next card or entry does not find it busy."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                if app.api.Ready:
                    return
            except AttributeError:  # not real Excel (tests)
                return
            except Exception as exc:
                if not is_transient_error(exc):
                    return  # the next call reports it
            time.sleep(0.25)

    def save(self) -> None:
        self._com(self.book.save)

    def save_copy(self, path: Path) -> None:
        path = Path(path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._com(lambda: self.book.api.SaveCopyAs(str(path)))
