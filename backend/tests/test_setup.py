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


def test_live_only_routes_off_this_platform(monkeypatch, tmp_path):
    monkeypatch.setattr(setup_api.sys, "platform", "linux")  # before the app looks for Excel
    app = create_app(Config(month="2000-01", backups={"dir": tmp_path / "b"}))
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


def test_start_page_does_not_wait_forever_for_excel(app, monkeypatch):
    """Excel with a dialog open answers nothing: the start page must still load."""
    import time as _time

    from app.excel import xlwings_adapter

    monkeypatch.setattr(setup_api, "OPEN_BOOKS_WAIT", 0.3)
    monkeypatch.setattr(xlwings_adapter, "open_workbook_names", lambda: _time.sleep(2) or [])
    app.state.session.state.live_available = True
    with TestClient(app) as c:
        started = _time.monotonic()
        state = c.get("/api/setup").json()
        assert _time.monotonic() - started < 1.5
        assert state["open_workbooks"] == [] and "Excel isn't answering" in state["excel_note"]


def test_requests_give_up_on_a_silent_excel(app, small_snapshot, tmp_path, monkeypatch):
    import time as _time

    from app.api import entries

    path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
    setup_api.choose(app, path, path.name, practice=True, real_file=False)
    monkeypatch.setattr(entries, "EXCEL_WAIT", 0.3)
    service = app.state.service
    monkeypatch.setattr(service, "master_view", lambda fresh=False: _time.sleep(2))
    with TestClient(app) as c:
        res = c.get("/api/master")
        assert res.status_code == 504 and "Excel isn't answering" in res.json()["detail"]


# --- several workbooks, activity checks per workbook ----------------------------------------


def test_workbook_kind():
    from app.books import workbook_kind

    a = workbook_kind("Labour Entry Sheet October 2026 - SUB CONTRACT.xlsb")
    assert a == workbook_kind("Labour Entry Sheet November 2026 - SUB CONTRACT (2).xlsb")
    assert a == "labour entry sheet sub contract"
    assert a != workbook_kind("Labour Entry Sheet October 2026 - INDIAN.xlsb")


def _named(snapshot, name):
    snap = snapshot.model_copy(deep=True)
    snap.meta.source_name = name
    return snap


def _no_codes(snapshot):
    """The made-up workbook kept like the sub-contract one: no activity list, no codes typed."""
    snap = snapshot.model_copy(deep=True)
    snap.master.activities = []
    for d in snap.days:
        for e in d.entries:
            e.activities = []
    return snap


def test_activity_checks_follow_the_workbook(app, small_snapshot, tmp_path):
    indian = tmp_path / "Labour Entry Sheet October 2026 - INDIAN.json"
    sub = tmp_path / "Labour Entry Sheet October 2026 - SUB CONTRACT.json"
    save_snapshot(_named(small_snapshot, indian.name), indian)
    save_snapshot(_named(_no_codes(small_snapshot), sub.name), sub)
    setup_api.choose(app, indian, indian.name, practice=True, real_file=False)
    state = setup_api.choose(app, sub, sub.name, practice=True, real_file=False)
    assert [b.name for b in state.books] == [indian.name, sub.name]
    assert state.workbook == sub.name and not state.check_activities  # told from the empty list
    with TestClient(app) as c:
        rules = {i["rule"] for i in c.post("/api/setup/check").json()["issues"]}
        assert not rules & {"E04", "E05", "W08", "M05"}
        checks = {x["id"]: x for x in c.get("/api/setup/readiness").json()["checks"]}
        assert checks["activities"]["status"] == "ok" and "medical" not in checks
        assert c.get("/api/master").json()["check_activities"] is False

        # The other workbook is still open, with its own checks.
        state = c.post("/api/setup/switch", json={"name": indian.name}).json()
        assert state["workbook"] == indian.name and state["check_activities"]
        master = c.get("/api/master").json()
        assert master["workbook"] == indian.name and master["check_activities"]
        assert c.post("/api/setup/switch", json={"name": "nope.xlsb"}).status_code == 404

        # Switched on by hand for the sub-contract workbook: the activity rules come back.
        c.post("/api/setup/switch", json={"name": sub.name})
        state = c.post("/api/setup/options", json={"check_activities": True}).json()
        assert state["check_activities"]
        acts = {x["id"]: x for x in c.get("/api/setup/readiness").json()["checks"]}["activities"]
        assert acts["status"] == "fail" and "untick" in acts["detail"]

        state = c.post("/api/setup/close", json={"name": sub.name}).json()
        assert state["workbook"] == indian.name
        assert [b["name"] for b in state["books"]] == [indian.name]


def test_ready_is_kept_per_workbook(app, small_snapshot, tmp_path):
    a = save_snapshot(small_snapshot, tmp_path / "A October 2026.json")
    b = save_snapshot(small_snapshot, tmp_path / "B October 2026.json")
    setup_api.choose(app, a, a.name, practice=True, real_file=False)
    with TestClient(app) as c:
        c.post("/api/setup/check")
        assert c.post("/api/setup/ready", json={"ready": True}).json()["ready"]
        setup_api.choose(app, b, b.name, practice=True, real_file=False)
        assert not c.get("/api/setup").json()["ready"]  # B still needs its check
        assert c.post("/api/setup/switch", json={"name": a.name}).json()["ready"]  # A doesn't


def test_activity_setting_is_remembered_for_next_month(tmp_path, small_snapshot):
    cfg = Config(month="2000-01", backups={"dir": tmp_path / "b"},
                 settings_file=tmp_path / "workbooks.json")  # fmt: skip
    oct_ = save_snapshot(small_snapshot, tmp_path / "Labour October 2026 - SUB CONTRACT.json")
    app1 = create_app(cfg)
    setup_api.choose(app1, oct_, oct_.name, practice=True, real_file=False)
    with TestClient(app1) as c:
        assert c.get("/api/setup").json()["check_activities"]  # codes are in this copy
        c.post("/api/setup/options", json={"check_activities": False})
    # A new start, next month's file: the choice holds even though this file has codes.
    nov = save_snapshot(small_snapshot, tmp_path / "Labour November 2026 - SUB CONTRACT (2).json")
    app2 = create_app(cfg)
    state = setup_api.choose(app2, nov, nov.name, practice=True, real_file=False)
    assert state.check_activities is False


def test_entry_without_activities_has_no_activity_issues():
    from app.domain.validators import check_entry

    from .conftest import make_entry

    e = make_entry("1", 0, "INB-01", 7.0, 19.0, [])
    assert "W08" in {i.rule for i in check_entry(e, "Normal Day", set())}
    assert check_entry(e, "Normal Day", set(), check_activities=False) == []
    bad = make_entry("1", 0, "INB-01", 7.0, 19.0, [("NOPE", "x")])
    assert {i.rule for i in check_entry(bad, "Normal Day", set(), check_activities=False)} == set()


# --- place names in activity codes ------------------------------------------------------------


def test_place_suffix():
    from app.domain.places import place_suffix, work_part

    assert place_suffix("03-11-00-00-P") == "P"
    assert place_suffix(" 03-20-00-00-C-8") == "C-8"
    assert place_suffix("03-44-13-15-05-A") == "A"  # the extra pair is detail, not a place
    assert place_suffix("03-44-13-15-05") is None
    assert place_suffix("03-11-00-00") is None and place_suffix("ZIDLE") is None
    assert work_part("03-11-00-00-C-8") == "03-11-00-00"


def test_place_names_asked_once_per_project(tmp_path, small_snapshot):
    cfg = Config(month="2000-01", backups={"dir": tmp_path / "b"},
                 settings_file=tmp_path / "workbooks.json")  # fmt: skip
    a = save_snapshot(_named(small_snapshot, "A"), tmp_path / "Labour October 2026 - A.json")
    app1 = create_app(cfg)
    setup_api.choose(app1, a, a.name, practice=True, real_file=False)
    with TestClient(app1) as c:
        c.post("/api/setup/check")
        view = c.get("/api/setup/places").json()
        assert view["project"] == "kmtt"  # from the sheets, so every workbook of the site shares it
        assert {p["suffix"] for p in view["places"]} == {"P", "C-8"} and set(view["new"]) == {
            "P",
            "C-8",
        }
        c.post("/api/setup/places", json={"names": {"P": "Parking area", "C-8": ""}})
        assert c.get("/api/master").json()["places"] == {"P": "Parking area"}
        assert c.get("/api/setup/places").json()["new"] == []  # C-8 left blank: not asked again

    # Another workbook of the same project, after a restart: nothing to ask, the names are there.
    b = save_snapshot(_named(small_snapshot, "B"), tmp_path / "Other November 2026.json")
    app2 = create_app(cfg)
    setup_api.choose(app2, b, b.name, practice=True, real_file=False)
    with TestClient(app2) as c:
        assert c.get("/api/setup/places").json()["new"] == []
        assert c.get("/api/master").json()["places"] == {"P": "Parking area"}
