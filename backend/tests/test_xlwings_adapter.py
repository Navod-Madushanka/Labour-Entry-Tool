"""The xlwings adapter's logic, against a stand-in for xlwings' Book (no Excel on Linux/CI).

What only real Excel can show (protection, recalculation, SaveCopyAs, timing) is checked by
``scripts/excel_smoke.py`` on Windows.
"""

import datetime as dt

import pytest

from app.config import Config
from app.domain.writes import RangeWrite
from app.excel import xlwings_adapter as xa
from app.excel.adapter import NotConnectedError, ProtectionError, WorkbookBusyError, WorkbookError
from app.excel.fake_adapter import FakeWorkbook


class ComError(Exception):
    """Shaped like pywintypes.com_error: args = (hresult, text, excepinfo, argerror)."""

    def __init__(self, hresult, text=""):
        super().__init__(hresult, text, None, None)
        self.hresult = hresult


# --- pure helpers -------------------------------------------------------------------------------


def test_clean_value():
    assert xa.clean_value(None) is None and xa.clean_value("") is None
    assert xa.clean_value(7) == 7.0 and isinstance(xa.clean_value(7), float)
    assert xa.clean_value(True) is True and xa.clean_value("#N/A") == "#N/A"
    assert xa.clean_value(dt.datetime(2026, 10, 1)) == 46296.0  # F3 as pyxlsb returns it
    assert xa.clean_value(dt.datetime(2026, 10, 1, 12)) == 46296.5
    assert xa.clean_value(dt.date(2026, 10, 1)) == 46296.0


def test_grid_from_rows():
    assert xa.grid_from_rows([[None, "a"], [3, ""]], first_row=9) == {(9, 2): "a", (10, 1): 3.0}


def test_match_books():
    names = [
        "Labour Entry Sheet October 2026 - INDIAN (2).xlsb",
        "Book1",
        "labour entry sheet x - indian.xlsb",
    ]
    assert xa.match_books(names, "Labour Entry Sheet * - INDIAN*.xlsb") == [names[0], names[2]]


def test_retry_busy_backs_off_then_succeeds():
    calls, sleeps, now = [], [], [0.0]

    def fn():
        calls.append(1)
        if len(calls) < 4:
            raise ComError(xa.RPC_E_CALL_REJECTED)
        return "ok"

    def sleep(s):
        sleeps.append(s)
        now[0] += s

    assert xa.retry_busy(fn, 10, sleep=sleep, clock=lambda: now[0]) == "ok"
    assert sleeps == [0.1, 0.2, 0.4]


def test_retry_busy_gives_up_and_passes_other_errors():
    now = [0.0]

    def busy():
        raise ComError(xa.VBA_E_IGNORE)

    def sleep(s):
        now[0] += s

    with pytest.raises(ComError):
        xa.retry_busy(busy, 2, sleep=sleep, clock=lambda: now[0])
    assert now[0] <= 2
    with pytest.raises(ValueError):
        xa.retry_busy(lambda: (_ for _ in ()).throw(ValueError()), 10, sleep=sleep)


def test_translate_com_error():
    assert isinstance(xa.translate_com_error(ComError(xa.RPC_E_CALL_REJECTED)), WorkbookBusyError)
    assert isinstance(xa.translate_com_error(ComError(-2147023174)), NotConnectedError)
    err = xa.translate_com_error(ComError(-2146827284, "The cell is on a protected sheet."))
    assert isinstance(err, ProtectionError)
    assert type(xa.translate_com_error(ComError(-1, "boom"))) is WorkbookError


def test_connect_without_xlwings_is_a_clear_error(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def no_xlwings(name, *a, **kw):
        if name == "xlwings":
            raise ImportError("No module named 'xlwings'")
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", no_xlwings)
    with pytest.raises(NotConnectedError, match="not available"):
        xa.connect(Config(month="2026-10"))


# --- the adapter against a stand-in Book --------------------------------------------------------


class Range:
    def __init__(self, sheet, address):
        self.sheet, self.address, self._opts = sheet, address, {}

    def options(self, **opts):
        self._opts = opts
        return self

    @property
    def value(self):
        app = self.sheet.book.app
        if app.busy:
            app.busy -= 1
            raise ComError(xa.RPC_E_CALL_REJECTED)
        assert self._opts == {"ndim": 2, "err_to_str": True}
        return self.sheet.book.fake.read_range(self.sheet.name, self.address)

    @value.setter
    def value(self, values):
        app = self.sheet.book.app
        app.log.append((self.address, app.calculation, app.screen_updating))
        self.sheet.book.fake.write_ranges(
            [RangeWrite(sheet=self.sheet.name, address=self.address, values=values)]
        )


class Sheet:
    def __init__(self, book, name):
        self.book, self.name = book, name

    def range(self, address):
        return Range(self, address)

    @property
    def used_range(self):
        last = max(r for r, _ in self.book.fake.master_grid)
        return type("Used", (), {"last_cell": type("Cell", (), {"row": last})()})()


class App:
    def __init__(self):
        self.calculation, self.screen_updating = "automatic", True
        self.busy, self.log, self.calculated = 0, [], 0

    def calculate(self):
        self.calculated += 1


class Book:
    def __init__(self, fake):
        self.fake, self.app, self.name = fake, App(), fake.name
        self.saved, self.copies = 0, []
        self.api = type("Api", (), {"SaveCopyAs": lambda _, p: self.copies.append(p)})()

    @property
    def sheets(self):
        book = self

        class Sheets:
            def __getitem__(self, name):
                if name != book.fake.template.master_sheet and name not in book.fake.grids:
                    raise ComError(-2147352565, "Invalid index.")
                return Sheet(book, name)

        return Sheets()

    def save(self):
        self.saved += 1


@pytest.fixture
def book(small_snapshot):
    return Book(FakeWorkbook(small_snapshot))


@pytest.fixture
def wb(book):
    return xa.XlwingsWorkbook(book, book.fake.template, busy_timeout=1)


def test_reads_build_the_same_models(wb, book):
    assert wb.name == book.fake.name
    assert wb.read_master() == book.fake.read_master()
    assert wb.read_day("1") == book.fake.read_day("1")
    with pytest.raises(KeyError):
        wb.read_day("32")


def test_write_batch_pauses_and_restores_calculation(wb, book):
    writes = [RangeWrite(sheet="1", address="G16:H16", values=[[7.0, 19.0]]),
              RangeWrite(sheet="1", address="J16:K16", values=[["03-11-00-00", 11.0]])]  # fmt: skip
    wb.write_ranges(writes)
    assert book.app.log == [("G16:H16", "manual", False), ("J16:K16", "manual", False)]
    assert (book.app.calculation, book.app.screen_updating, book.app.calculated) == (
        "automatic", True, 1,
    )  # fmt: skip
    assert wb.read_range("1", "E16:E16") == [[11.0]]


def test_write_failure_still_restores_calculation(wb, book):
    with pytest.raises(ProtectionError):
        wb.write_ranges([RangeWrite(sheet="1", address="I16", values=[["x"]])])
    assert (book.app.calculation, book.app.screen_updating) == ("automatic", True)


def test_busy_reads_are_retried(wb, book):
    book.app.busy = 2
    assert wb.read_range("1", "G9:H9") == [[7.0, 19.0]]
    book.app.busy = 1000
    with pytest.raises(WorkbookBusyError, match="Finish editing"):
        wb.read_range("1", "G9:H9")


def test_save_and_copy(wb, book, tmp_path):
    wb.save()
    wb.save_copy(tmp_path / "b" / "copy.xlsb")
    assert book.saved == 1 and book.copies == [str((tmp_path / "b" / "copy.xlsb").resolve())]


def test_calculation_restore_failure_is_reported(wb, book):
    class StuckApp(App):
        def __setattr__(self, name, value):
            if name == "calculation" and value == "automatic" and getattr(self, "stuck", False):
                raise ComError(-1, "refused")
            super().__setattr__(name, value)

    book.app = StuckApp()
    book.app.stuck = True
    with pytest.raises(WorkbookError, match="Calculation Options > Automatic"):
        wb.write_ranges([RangeWrite(sheet="1", address="G16:H16", values=[[7.0, 19.0]])])
    assert book.app.screen_updating is True and book.app.calculated == 1  # the rest still ran
    assert book.fake.read_range("1", "G16:H16") == [[7.0, 19.0]]  # and the data is in


def test_master_read_is_capped(wb, book, monkeypatch):
    seen = []
    real = wb.read_range
    monkeypatch.setattr(
        wb, "read_range", lambda sheet, address: seen.append(address) or real(sheet, address)
    )
    huge = type("U", (), {"last_cell": type("C", (), {"row": 1048576})()})()
    monkeypatch.setattr(Sheet, "used_range", property(lambda self: huge))  # restored afterwards
    wb.read_master()
    assert seen == ["A1:N1002"]  # 502 worker rows + 500 margin, not a million


# --- attaching to the workbook chosen on the start page --------------------------------------


def _fake_xlwings(monkeypatch, open_names, opened):
    import sys
    import types

    def book(name):
        return types.SimpleNamespace(name=name)

    apps = [types.SimpleNamespace(books=[book(n) for n in open_names])]
    module = types.SimpleNamespace(apps=apps, Book=lambda p: opened.append(p) or book(p))
    monkeypatch.setitem(sys.modules, "xlwings", module)


def test_connect_named(monkeypatch, tmp_path):
    cfg = Config(month="2026-10")
    opened = []
    _fake_xlwings(monkeypatch, ["Book1", "Labour October 2026.xlsb"], opened)
    wb = xa.connect_named("labour october 2026.xlsb", None, cfg)  # case-insensitive, like Windows
    assert wb.book.name == "Labour October 2026.xlsb" and opened == []
    assert xa.open_workbook_names() == ["Book1", "Labour October 2026.xlsb"]

    with pytest.raises(NotConnectedError, match="not open in Excel"):
        xa.connect_named("Other.xlsb", None, cfg)
    with pytest.raises(NotConnectedError, match="not open in Excel"):
        xa.connect_named("Other.xlsb", tmp_path / "missing.xlsb", cfg)
    path = tmp_path / "Other.xlsb"
    path.write_bytes(b"x")
    xa.connect_named("Other.xlsb", path, cfg)  # browsed to it: Excel opens it
    assert opened == [str(path.resolve())]

    _fake_xlwings(monkeypatch, ["A.xlsb", "a.xlsb"], opened)
    with pytest.raises(NotConnectedError, match="open twice"):
        xa.connect_named("A.xlsb", None, cfg)
