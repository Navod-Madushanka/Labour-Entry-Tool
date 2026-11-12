"""BP Bill and supplier claims against the day sheets (roadmap #8). The BP Bill's real layout is not
known: these made-up sheets cover the layouts it is likely to have, and the finder must cope."""

import datetime as dt
import io

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.api import setup as setup_api
from app.bpbill import (
    Layout,
    compare_bill,
    compare_claim,
    describe,
    detect,
    read_bill,
    read_claim,
    rows_from_file,
    sheet_days,
)
from app.config import Config
from app.excel.fake_adapter import save_snapshot
from app.main import create_app


def grid_of(rows, top=1):
    return {
        (top + r, c + 1): v
        for r, row in enumerate(rows)
        for c, v in enumerate(row)
        if v not in (None, "")
    }


def guessed_bill(sheets, mode="hours"):
    """The layout guessed first: a title, a header row with Calling Name, days 1-31, totals."""
    head = [
        "No",
        "Calling Name",
        "Name",
        "Trade",
        *range(1, 32),
        "Total Days",
        "Total Hours",
        "Amount (Rs)",
    ]
    rows = [["BP BILL - OCTOBER 2026"], [], head]
    for i, (name, days) in enumerate(sorted(sheets.items()), 1):
        cells = [
            (1 if h >= 6 else 0) if mode == "days" else h
            for h in (days.get(d, "") for d in range(1, 32))
        ]
        cells = ["" if c == "" else c for c in cells]
        total_days = sum(1 for h in days.values() if h >= 6)
        rows.append(
            [i, name, f"Person {i}", "Carpenter", *cells, total_days, sum(days.values()), 0]
        )
    return grid_of(rows)


SHEETS = {"INB-01": {1: 11, 2: 11, 3: 5}, "INC-02": {1: 8}, "INH-03": {2: 13.5}}


def test_finds_the_guessed_layout():
    lay = detect(guessed_bill(SHEETS))
    assert lay.found and lay.header_row == 3 and lay.name_col == 2
    assert lay.day_cols[1] == 5 and lay.day_cols[31] == 35
    assert (lay.total_days_col, lay.total_hours_col, lay.amount_col) == (36, 37, 38)
    assert lay.mode == "hours"
    assert describe(lay).startswith("header row 3, calling names in B, days 1–31 in E–AI (hours)")
    bill = read_bill(guessed_bill(SHEETS), lay)
    assert bill["INB-01"].days == {1: 11, 2: 11, 3: 5} and bill["INB-01"].total_days == 2
    assert compare_bill(bill, SHEETS, lay) == []  # the same as the sheets: nothing to report


def test_other_layouts_and_differences():
    # no "Calling Name" heading; day counts; dates as the day headings, a row above the names
    days = [dt.date(2026, 10, d) for d in range(1, 32)]
    rows = [["", "", *days], ["Code", "Worker", *[""] * 31, "No. of days"]]
    rows += [
        ["INB01", "x", 1, 1, *[""] * 29, 2],
        ["INC-02", "y", 1, *[""] * 30, 1],
        ["INH-03", "z", *[""] * 31, 0],
    ]
    g = grid_of(rows)
    lay = detect(g, month="2026-10")
    assert lay.found and lay.name_col == 1 and lay.day_cols[1] == 3 and lay.mode == "days"
    assert lay.total_days_col == 34 and any("calling names" in n for n in lay.notes)
    diffs = compare_bill(read_bill(g, lay), SHEETS, lay)
    got = {(d.name, d.day, d.note) for d in diffs}
    # INC-02 had 8 h (6+), counted: fine. INH-03 worked 13.5 h on day 2 but the bill has nothing.
    assert ("INH-03", 2, "6+ h on the sheets, not counted on the BP Bill") in got
    assert ("INH-03", None, "total days differ from the days at 6+ h on the sheets") in got
    assert not any(d.name in ("INB01", "INC-02") for d in diffs), diffs  # INB01 matches INB-01

    # a worker on the sheets missing from the bill, and one billed with no hours
    lay2 = detect(guessed_bill(SHEETS))
    bill = read_bill(guessed_bill({**SHEETS, "INR-09": {4: 11}}), lay2)
    del bill["INC-02"]
    diffs = {(d.name, d.note) for d in compare_bill(bill, SHEETS, lay2)}
    assert ("INC-02", "days at 6+ h on the sheets, not on the BP Bill") in diffs
    assert ("INR-09", "on the BP Bill, but no hours on the day sheets") in diffs


def test_nothing_found_says_so():
    lay = detect(grid_of([["Some", "other", "sheet"], [1, 2, 3]]))
    assert not lay.found and lay.notes and describe(lay) == "Layout not found"
    assert read_bill({}, Layout()) == {}


def test_supplier_claim():
    csv = (
        b"Business Partner,Calling Name,Days Billed,Hours Billed\nBP1,INB-01,3,27\nBP1,INX-77,4,\n"
    )
    claim = read_claim(rows_from_file("claim.csv", csv))
    assert [(c.bp, c.name, c.days, c.hours) for c in claim] == [
        ("BP1", "INB-01", 3, 27),
        ("BP1", "INX-77", 4, None),
    ]
    out = {
        c.name: c
        for c in compare_claim(claim, SHEETS, {"INB-01": "BP1", "INC-02": "BP1", "INH-03": "BP2"})
    }
    assert out["INB-01"].sheet_days == 2 and "1 day(s) more" in out["INB-01"].note
    assert "no hours on the day sheets" in out["INX-77"].note
    assert out["INC-02"].note == "on the day sheets, not on the claim"  # BP1's worker, not billed
    assert "INH-03" not in out  # another business partner's worker


def test_api_with_a_workbook_copy_and_a_claim(small_snapshot, tmp_path):
    cfg = Config(
        month="2026-10", backups={"dir": tmp_path / "b"}, settings_file=tmp_path / "s.json"
    )
    app = create_app(cfg)
    path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
    setup_api.choose(app, path, path.name, practice=True, real_file=False)
    sheets = sheet_days(small_snapshot)
    wb = Workbook()
    ws = wb.active
    ws.title = "BP Bill"
    for (r, c), v in guessed_bill(sheets).items():
        ws.cell(r, c, v)
    buf = io.BytesIO()
    wb.save(buf)
    with TestClient(app) as c:
        c.post("/api/setup/check")
        assert c.get("/api/bp-bill/check").status_code == 422  # a practice copy: send a file
        res = c.post("/api/bp-bill/check-file?filename=copy.xlsx", content=buf.getvalue()).json()
        assert res["layout_text"].startswith("header row 3") and res["differences"] == []
        assert res["workers"] == len(sheets)
        # a correction by hand: day 1 is in column F (one too far): every day now differs
        c.post("/api/bp-bill/layout", json={"first_day_col": 6})
        moved = c.post("/api/bp-bill/check-file?filename=copy.xlsx", content=buf.getvalue()).json()
        assert moved["differences"] and "corrected by hand" in " ".join(moved["layout"]["notes"])
        c.post("/api/bp-bill/layout", json={})  # back to finding it
        claim = (
            b"Calling name,Days\n" + "\n".join(f"{n},{len(d)}" for n, d in sheets.items()).encode()
        )
        rows = c.post("/api/bp-bill/claim?filename=c.csv", content=claim).json()["rows"]
        assert rows and all(r["name"] in sheets for r in rows)
        assert c.post("/api/bp-bill/claim?filename=c.txt", content=b"x").status_code == 422
