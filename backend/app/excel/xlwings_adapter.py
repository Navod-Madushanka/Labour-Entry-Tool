"""Live Excel through xlwings/COM (Windows only, PLAN.md §8). Implements ``LiveWorkbook``.

- Attaches to the one open workbook whose name matches ``workbook_pattern``; never opens, closes
  or unprotects it.
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
    EXCEL_EPOCH,
    Grid,
    day_from_grid,
    day_max_col,
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
GONE_HRESULTS = frozenset({-2147023174, -2147023170, -2147417848})  # RPC unavailable / disconnected

EXCEL_EPOCH_DT = dt.datetime.combine(EXCEL_EPOCH, dt.time())
MASTER_MARGIN = 500  # rows read past Labour Detail's last worker row


# --- Pure helpers ------------------------------------------------------------------------------


def clean_value(value: Any) -> CellValue:
    """xlwings value -> CellValue: dates back to Excel serials (as pyxlsb returns them), '' -> None,
    ints -> float. Errors arrive as text ('#N/A') because reads use ``err_to_str=True``."""
    if value is None or value == "":
        return None
    if isinstance(value, bool | str | float):
        return value
    if isinstance(value, int):
        return float(value)
    if isinstance(value, dt.datetime):
        delta = value.replace(tzinfo=None) - EXCEL_EPOCH_DT
        return delta.days + delta.seconds / 86400
    if isinstance(value, dt.date):
        return float((value - EXCEL_EPOCH).days)
    if isinstance(value, dt.timedelta):
        return value.total_seconds() / 86400
    return str(value)


def grid_from_rows(rows: Sequence[Sequence[Any]], first_row: int = 1, first_col: int = 1) -> Grid:
    grid: Grid = {}
    for i, row in enumerate(rows):
        for j, value in enumerate(row):
            if (clean := clean_value(value)) is not None:
                grid[(first_row + i, first_col + j)] = clean
    return grid


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


def translate_com_error(exc: BaseException) -> WorkbookError:
    """A COM error as something the user can act on."""
    text = " ".join(str(a) for a in getattr(exc, "args", ()) if a)
    if is_busy_error(exc):
        return WorkbookBusyError(
            "Excel is busy. Finish editing the cell in Excel (press Enter or Esc), then try again."
        )
    if hresult(exc) in GONE_HRESULTS:
        return NotConnectedError("Lost the connection to Excel. Is the workbook still open?")
    if "protect" in text.casefold():
        return ProtectionError(f"Excel refused to change a protected cell: {text}")
    return WorkbookError(f"Excel error: {text or exc!r}")


def retry_busy(
    fn: Callable[[], T],
    timeout: float,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> T:
    """Call ``fn``; while Excel rejects the call as busy, retry with backoff up to ``timeout``."""
    deadline, delay = clock() + timeout, 0.1
    while True:
        try:
            return fn()
        except Exception as exc:
            if not is_busy_error(exc) or clock() + delay > deadline:
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


def connect(config: Config) -> XlwingsWorkbook:
    """Attach to the single open workbook matching ``config.workbook_pattern``."""
    try:
        import xlwings as xw
    except ImportError as exc:  # not Windows, or not installed
        raise NotConnectedError(f"Live Excel is not available on this computer ({exc}).") from exc
    try:
        books = [book for app in xw.apps for book in app.books]
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


class XlwingsWorkbook:
    def __init__(self, book: Any, template: TemplateConfig, busy_timeout: float = 10.0):
        self.book = book
        self.template = template
        self.busy_timeout = busy_timeout

    def _com(self, fn: Callable[[], T]) -> T:
        try:
            return retry_busy(fn, self.busy_timeout)
        except WorkbookError:
            raise
        except Exception as exc:
            raise translate_com_error(exc) from exc

    @property
    def name(self) -> str:
        return self._com(lambda: self.book.name)

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
        return master_from_grid(grid, t)

    def day_sheet_names(self) -> list[str]:
        return self.template.day_sheet_names()

    def read_day(self, sheet: str) -> DaySheet:
        t = self.template
        return day_from_grid(sheet, self._grid(sheet, t.last_block_row, day_max_col(t)), t)

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

    def save(self) -> None:
        self._com(self.book.save)

    def save_copy(self, path: Path) -> None:
        path = Path(path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._com(lambda: self.book.api.SaveCopyAs(str(path)))
