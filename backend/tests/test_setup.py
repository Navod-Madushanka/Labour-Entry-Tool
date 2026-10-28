"""The start page: choose the workbook, check it, fix it, readiness (api/setup.py, app/setup.py)."""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.api import setup as setup_api
from app.config import Config, default_config, load_config
from app.excel.fake_adapter import save_snapshot
from app.main import create_app
from app.setup import guess_month, month_from_name, next_sheet

from .conftest import FIXTURES

REAL = FIXTURES / "private" / "Labour Entry Sheet October 2026 - INDIAN (2).xlsb"
USER = "Navod"


def test_month_from_name():
    assert month_from_name("Labour Entry Sheet October 2026 - INDIAN (2).xlsb") == "2026-10"
    assert month_from_name("labour sep_2026.xlsb") == "2026-09"
    assert month_from_name("Labour Entry Sheet - INDIAN.xlsb") is None
    assert month_from_name("Sheet 2026.xlsb") is None  # 'Sheet' is no month


def test_guess_month(small_snapshot):
    assert guess_month("x October 2026.xlsb", small_snapshot).model_dump() == {
        "month": "2026-10", "source": "file name", "note": None,
    }  # fmt: skip
    guess = guess_month("Labour November 2026.xlsb", small_snapshot)
    assert guess.month == "2026-11" and "most sheet dates are in October 2026" in guess.note
    assert guess_month("labour.xlsb", small_snapshot).source == "sheet dates"


def test_next_sheet(small_snapshot):
    assert next_sheet(small_snapshot) == "1"  # the last sheet, even when it has entries
    day2 = small_snapshot.days[0].model_copy(deep=True)
    day2.header.sheet, day2.entries = "2", []
    small_snapshot.days.append(day2)
    assert next_sheet(small_snapshot) == "2"  # the day after the last one entered
    for d in small_snapshot.days:
        d.entries.clear()
    assert next_sheet(small_snapshot) == "1"


def test_default_config_without_a_file(monkeypatch, tmp_path):
    monkeypatch.setattr("app.config.REPO_ROOT", tmp_path)
    monkeypatch.delenv("LABOUR_TOOL_CONFIG", raising=False)
    monkeypatch.setenv("LABOUR_TOOL_DATA", str(tmp_path / "data"))
    cfg = load_config()
    assert cfg.month == f"{dt.date.today():%Y-%m}" and cfg.holidays == []
    assert cfg.backups.dir == tmp_path / "data" / "backups"
    assert default_config().audit.db == tmp_path / "data" / "audit.sqlite"


@pytest.fixture
def app(tmp_path):
    return create_app(Config(month="2000-01", backups={"dir": tmp_path / "b"}))


def test_nothing_chosen_yet(app):
    with TestClient(app) as c:
        state = c.get("/api/setup").json()
        assert state["workbook"] is None and not state["ready"]
        assert c.get("/api/status").json()["error"] == "No workbook chosen yet."
        assert c.get("/api/master").status_code == 409
        assert c.post("/api/setup/check").status_code == 409


def test_upload_rejects_other_files(app):
    with TestClient(app) as c:
        res = c.post("/api/setup/upload?filename=book.xlsx", content=b"x")
        assert res.status_code == 422 and "not a .xlsb file" in res.json()["detail"]
        assert c.post("/api/setup/upload?filename=a.xlsb", content=b"").status_code == 422
        res = c.post("/api/setup/upload?filename=a.xlsb", content=b"not a workbook")
        assert res.status_code == 422 and "Could not read a.xlsb" in res.json()["detail"]
        assert c.get("/api/setup").json()["workbook"] is None  # nothing chosen


def test_live_only_routes_off_this_platform(app, monkeypatch):
    monkeypatch.setattr(setup_api.sys, "platform", "linux")
    with TestClient(app) as c:
        assert c.post("/api/setup/open", json={"name": "a.xlsb"}).status_code == 501
        assert c.post("/api/setup/browse", json={}).status_code == 501


def test_practice_flow(app, small_snapshot, tmp_path):
    """Choose -> check -> fix a header -> readiness -> ready, all on a copy in memory."""
    small_snapshot.days[0].header.day_type = "Saturday"  # 1 Oct 2026 is a Thursday: H02
    path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
    state = setup_api.choose(app, path, path.name, practice=True, real_file=False)
    assert (state.mode, state.month) == ("demo", "2026-10")
    with TestClient(app) as c:
        assert c.get("/api/status").json()["mode"] == "demo"
        report = c.post("/api/setup/check").json()
        assert report["month"] == "2026-10"
        assert "H02" in {i["rule"] for i in report["issues"]}
        ready = c.get("/api/setup/readiness").json()
        assert not ready["ready"]
        assert {x["id"]: x["status"] for x in ready["checks"]}["headers"] == "fail"

        fix = c.post("/api/days/1/header-fix",
                     json={"user": USER, "fields": ["day_type"], "approve": True})  # fmt: skip
        assert fix.json()["status"] == "written"
        ready = c.get("/api/setup/readiness").json()
        checks = {x["id"]: x for x in ready["checks"]}
        assert ready["ready"] and ready["next_sheet"] == "1"
        assert checks["headers"]["status"] == "ok" and checks["formulas"]["status"] == "ok"
        assert "agree with Excel's on" in checks["formulas"]["detail"]

        assert c.post("/api/setup/ready", json={"ready": True}).json()["ready"]
        assert c.get("/api/setup").json()["ready"]
        assert c.get("/api/master").json()["month"] == "2026-10"


def test_holidays_change_the_checks(app, small_snapshot, tmp_path):
    path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
    setup_api.choose(app, path, path.name, practice=True, real_file=False)
    with TestClient(app) as c:
        assert "H02" not in {i["rule"] for i in c.post("/api/setup/check").json()["issues"]}
        state = c.post("/api/setup/holidays", json={"holidays": ["2026-10-01"]}).json()
        assert state["holidays"] == ["2026-10-01"]
        h02 = [i for i in c.post("/api/setup/check").json()["issues"] if i["rule"] == "H02"]
        assert [i["sheet"] for i in h02] == ["1"]  # sheet 1 should now say Holiday
        assert c.get("/api/master").json()["holidays"] == ["2026-10-01"]


def test_registration_upload(app, small_snapshot, tmp_path):
    path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
    setup_api.choose(app, path, path.name, practice=True, real_file=False)
    with TestClient(app) as c:
        res = c.post("/api/setup/registration?filename=reg.csv", content=b"x")
        assert res.status_code == 422
        state = c.post("/api/setup/registration?filename=Reg.xlsx", content=b"x").json()
        assert [p.rsplit("/", 1)[-1].rsplit("\\", 1)[-1] for p in state["registration_files"]] == [
            "Reg.xlsx"
        ]
        state = c.post("/api/setup/registration?filename=Reg.xlsx", content=b"y").json()
        assert len(state["registration_files"]) == 1  # the same name replaces the older copy


@pytest.mark.golden
@pytest.mark.skipif(not REAL.exists(), reason="real workbook not present (git-ignored)")
def test_upload_real_workbook(app):
    with TestClient(app) as c:
        state = c.post(f"/api/setup/upload?filename={REAL.name}&practice=true",
                       content=REAL.read_bytes()).json()  # fmt: skip
        assert (state["mode"], state["month"], state["month_note"]) == ("demo", "2026-10", None)
        report = c.post("/api/setup/check").json()
        assert report["stats"]["workers"] > 100
        ready = c.get("/api/setup/readiness").json()
        assert {x["id"] for x in ready["checks"]} >= {"workbook", "headers", "daybuilder"}
