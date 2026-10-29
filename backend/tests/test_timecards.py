"""Printing time cards: finding the Calling Name cell, and the print job (practice mode)."""

import time

from fastapi.testclient import TestClient

from app.api import setup as setup_api
from app.config import Config
from app.excel.fake_adapter import save_snapshot
from app.main import create_app
from app.timecards import find_input_cell, time_card_sheets


def grid(rows: int, cols: int, cells: dict[str, object]) -> list[list[object]]:
    g = [[None] * cols for _ in range(rows)]
    for addr, v in cells.items():
        col, row = ord(addr[0]) - 65, int(addr[1:]) - 1
        g[row][col] = v
    return g


def test_time_card_sheets():
    names = ["Labour Detail", "1", "Time Card (Internal)", "Time Card (External)", "SUMMARY "]
    assert time_card_sheets(names) == ["Time Card (Internal)", "Time Card (External)"]


def test_input_cell_is_the_one_the_card_refers_to():
    # As on "Time Card (Internal)": label in B8 (and its merged copy in C8), the name in E8,
    # "Employee Code" label in G8, the looked-up code in I8.
    values = grid(10, 10, {"B8": "Calling Name", "C8": "Calling Name", "E8": "INS-01",
                           "G8": "Employee Code", "I8": "X49881", "E5": "Anil"})  # fmt: skip
    formulas = grid(10, 10, {"E5": "=VLOOKUP($E$8,'Labour Detail'!A:H,2,0)",
                             "I8": "=VLOOKUP(E8,'Labour Detail'!A:H,7,0)"})  # fmt: skip
    assert find_input_cell(values, formulas) == "E8"


def test_input_cell_without_formulas_or_value():
    values = grid(10, 8, {"B8": "Calling Name:"})
    assert find_input_cell(values, grid(10, 8, {})) == "C8"  # the first cell right of the label
    values = grid(10, 8, {"B8": "Calling Name", "D8": "INB-04"})
    assert find_input_cell(values, grid(10, 8, {})) == "D8"  # the one holding a name
    assert find_input_cell(grid(5, 5, {"A1": "Name"}), grid(5, 5, {})) is None


def practice_app(small_snapshot, tmp_path):
    app = create_app(Config(month="2026-10", backups={"dir": tmp_path / "b"}))
    path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
    setup_api.choose(app, path, path.name, practice=True, real_file=False)
    return app


def wait_done(c):
    for _ in range(100):
        job = c.get("/api/timecards/job").json()
        if not job["running"]:
            return job
        time.sleep(0.05)
    raise AssertionError("print job did not finish")


def test_print_job_in_practice_mode(small_snapshot, tmp_path, monkeypatch):
    app = practice_app(small_snapshot, tmp_path)
    with TestClient(app) as c:
        sheets = c.get("/api/timecards").json()
        assert sheets[0] == {"sheet": "Time Card (Internal)", "cell": "E8", "current": None,
                             "practice": True, "note": None}  # fmt: skip
        body = {"sheet": "Time Card (Internal)", "cell": "E8", "names": ["INB-01", "INC-02"],
                "user": "Navod"}  # fmt: skip
        job = c.post("/api/timecards/print", json=body).json()
        assert job["running"] and job["total"] == 2 and job["practice"]
        job = wait_done(c)
        assert job["printed"] == ["INB-01", "INC-02"] and job["error"] is None
        fake = app.state.service.workbook
        assert fake.printed == [
            ("Time Card (Internal)", "INB-01", 1),
            ("Time Card (Internal)", "INC-02", 1),
        ]


def test_print_job_refuses_bad_requests(small_snapshot, tmp_path):
    app = practice_app(small_snapshot, tmp_path)
    with TestClient(app) as c:
        base = {"sheet": "Time Card (Internal)", "cell": "E8", "user": "Navod"}
        res = c.post("/api/timecards/print", json={**base, "names": ["INB-01", "XYZ-99"]})
        assert res.status_code == 422 and "XYZ-99" in res.json()["detail"]
        res = c.post("/api/timecards/print", json={**base, "sheet": "1", "names": ["INB-01"]})
        assert res.status_code == 422 and "not a time card sheet" in res.json()["detail"]
        res = c.post("/api/timecards/print", json={**base, "cell": "E8:F9", "names": ["INB-01"]})
        assert res.status_code == 422


def test_print_job_stops_between_cards(small_snapshot, tmp_path):
    app = practice_app(small_snapshot, tmp_path)
    with TestClient(app) as c:
        names = ["INB-01", "INC-02", "INH-03", "INB-01 CH"] * 5
        body = {"sheet": "Time Card (Internal)", "cell": "E8", "names": names, "user": "Navod"}
        c.post("/api/timecards/print", json=body)
        c.post("/api/timecards/stop")
        job = wait_done(c)
        assert job["stopped"] and job["done"] < len(names)
