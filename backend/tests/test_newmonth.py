"""Starting the next month: folder, name, what is cleared and what stays; made-up workbooks."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import setup as setup_api
from app.config import Config, TemplateConfig
from app.excel.fake_adapter import load_snapshot, save_snapshot
from app.main import create_app
from app.newmonth import (
    check_target,
    cleared_snapshot,
    default_folder,
    default_name,
    header_writes,
    next_month,
    plan_sheets,
)


def test_names_and_folders():
    nov = dt.date(2026, 11, 1)
    assert (
        default_name("Labour Entry Sheet October 2026 - INDIAN (2).xlsb", nov)
        == "Labour Entry Sheet November 2026 - INDIAN.xlsb"
    )  # noqa: E501
    assert default_name("LABOUR OCTOBER 2026.xlsb", nov) == "LABOUR NOVEMBER 2026.xlsb"
    assert default_name("Book1.xlsb", nov) == "Book1 - November 2026.xlsb"
    assert next_month(dt.date(2026, 12, 1)) == dt.date(2027, 1, 1)
    assert default_folder(Path("/site/October 2026/a.xlsb"), nov) == Path("/site/November 2026")
    assert default_folder(Path("/site/labour/a.xlsb"), nov) == Path("/site/labour/November 2026")


def test_target_checks(tmp_path):
    src = tmp_path / "a.xlsb"
    src.write_bytes(b"x")
    assert check_target(tmp_path / "Nov", "b", src).name == "b.xlsb"
    for bad in ["", "a/b", "c:d"]:
        with pytest.raises(ValueError):
            check_target(tmp_path, bad, src)
    with pytest.raises(FileExistsError):
        check_target(tmp_path, "a.xlsb", src)


def test_plan_clears_only_input_cells(small_snapshot):
    t = TemplateConfig()
    plans = plan_sheets(small_snapshot, t, dt.date(2026, 11, 1), [dt.date(2026, 11, 2)])
    day = next(p for p in plans if p.entries)
    r = next(d for d in small_snapshot.days if d.header.sheet == day.sheet).entries[0].row
    assert day.clear[:4] == [f"G{r}:H{r}", f"J{r}:K{r + 4}", f"L{r}", f"R{r}"]
    # every cleared cell is an input cell of a block (never a formula column)
    for p in plans:
        for a in p.clear:
            assert a[0] in "GHJKLR"
    by = {p.sheet: p for p in plans}
    assert by["1"].date == dt.date(2026, 11, 1) and by["1"].day_type == "Sunday"
    if "2" in by:
        assert by["2"].day_type == "Holiday"
    if "31" in by:
        assert by["31"].date is None  # November has no 31st: header left as it is
    writes = header_writes(plans, t)
    assert {w.address for w in writes} == {"F3", "H3", "F4"}
    assert not any(w.sheet == "31" for w in writes)


def test_cleared_snapshot_keeps_labour_detail(small_snapshot):
    plans = plan_sheets(small_snapshot, TemplateConfig(), dt.date(2026, 11, 1), [])
    new = cleared_snapshot(small_snapshot, plans, "x.json")
    assert sum(len(d.entries) for d in new.days) == 0
    assert new.master == small_snapshot.master
    assert new.days[0].header.date == dt.date(2026, 11, 1)
    assert new.days[0].block_names == small_snapshot.days[0].block_names


def test_endpoint_makes_the_next_month(small_snapshot, tmp_path):
    folder = tmp_path / "October 2026"
    folder.mkdir()
    src = save_snapshot(small_snapshot, folder / "Labour Entry Sheet October 2026 - DEMO.json")
    app = create_app(Config(month="2026-10", backups={"dir": tmp_path / "b"}))
    setup_api.choose(app, src, src.name, practice=True, real_file=True)
    client = TestClient(app)
    pre = client.post("/api/setup/new-month/preview", json={}).json()
    assert pre["month"] == "2026-11" and pre["problem"] is None
    assert pre["name"] == "Labour Entry Sheet November 2026 - DEMO.json"
    assert pre["folder"] == str(tmp_path / "November 2026") and not pre["folder_exists"]
    assert pre["workers"] == len(small_snapshot.master.workers)

    res = client.post("/api/setup/new-month", json={"name": "Nov labour - DEMO"})
    assert res.status_code == 200, res.text
    out = res.json()
    new = Path(out["path"])
    assert new == tmp_path / "November 2026" / "Nov labour - DEMO.json"
    assert out["entries_cleared"] == sum(len(d.entries) for d in small_snapshot.days)
    snap = load_snapshot(new)
    assert sum(len(d.entries) for d in snap.days) == 0
    assert snap.master == small_snapshot.master
    assert out["state"]["workbook"] == new.name  # it is the open workbook now
    assert load_snapshot(src).days == small_snapshot.days  # the old month is untouched
    # the new workbook is open now: its next month is December
    assert client.post("/api/setup/new-month/preview", json={}).json()["month"] == "2026-12"
    # the same file again: refused
    again = client.post(
        "/api/setup/new-month",
        json={"month": "2026-11", "name": "Nov labour - DEMO", "folder": str(new.parent)},
    )  # noqa: E501
    assert again.status_code == 409 and "already exists" in again.json()["detail"]


def test_dropped_copy_is_refused(small_snapshot, tmp_path):
    src = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
    app = create_app(Config(month="2026-10", backups={"dir": tmp_path / "b"}))
    setup_api.choose(app, src, src.name, practice=True, real_file=False)
    # practice copies made from a dropped file live in the session's work folder
    session = app.state.session
    dropped = session.work / "x" / src.name
    dropped.parent.mkdir(parents=True)
    dropped.write_bytes(src.read_bytes())
    session.book.service.source_path = dropped
    client = TestClient(app)
    assert client.post("/api/setup/new-month/preview", json={}).json()["problem"]
    assert client.post("/api/setup/new-month", json={}).status_code == 409


class FakeExcelBook:
    """Stands in for the copy opened in Excel: records what the tool asks of it."""

    def __init__(self, fail_on: str | None = None):
        self.cleared: dict[str, list[str]] = {}
        self.writes = []
        self.saved = self.closed = False
        self.fail_on = fail_on

    def clear_cells(self, sheet, addresses):
        if sheet == self.fail_on:
            raise RuntimeError("merged cell")
        self.cleared[sheet] = list(addresses)

    def write_ranges(self, writes):
        self.writes += writes

    def save(self):
        self.saved = True

    def close(self):
        self.closed = True


def test_excel_steps(small_snapshot, monkeypatch, tmp_path):
    from app.excel import xlwings_adapter

    plans = plan_sheets(small_snapshot, TemplateConfig(), dt.date(2026, 11, 1), [])
    book = FakeExcelBook()
    monkeypatch.setattr(xlwings_adapter, "connect_named", lambda name, path, config: book)
    setup_api._clear_in_excel(tmp_path / "n.xlsb", plans, Config(month="2026-11"))
    assert book.saved and not book.closed
    assert {s: len(a) for s, a in book.cleared.items()} == {p.sheet: len(p.clear) for p in plans}
    assert {w.address for w in book.writes} == {"F3", "H3", "F4"}

    bad = FakeExcelBook(fail_on=plans[0].sheet)
    monkeypatch.setattr(xlwings_adapter, "connect_named", lambda name, path, config: bad)
    with pytest.raises(RuntimeError):
        setup_api._clear_in_excel(tmp_path / "n.xlsb", plans, Config(month="2026-11"))
    assert bad.closed and not bad.saved  # closed without saving; the endpoint removes the copy
