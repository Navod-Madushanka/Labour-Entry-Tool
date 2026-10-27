"""Whole-workbook health check, its CLI and its API (PLAN.md §6 Phase 1) on fake data."""

import csv
import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app import health as cli
from app.config import Config
from app.domain.health import run_health
from app.domain.models import ActivityCode, DayHeader, DaySheet
from app.excel.fake_adapter import save_snapshot
from app.main import bind_host, create_app
from tests.conftest import make_entry

OCT = dt.date(2026, 10, 1)


def by_rule(report, rule):
    return [i for i in report.issues if i.rule == rule]


def test_small_snapshot(small_snapshot):
    r = run_health(small_snapshot, OCT)
    assert r.stats.by_rule == {"M02": 2, "M03": 1, "M05": 1, "W07": 1}
    assert r.stats.entries == 2 and r.stats.complete_entries == 2
    assert r.stats.effective_hours == 24

    m02 = {i.calling_name: i.message for i in by_rule(r, "M02")}
    assert m02 == {"INC-02": "Employee code shows #N/A (broken lookup formula).",
                   "INH-03": "Employee code is 0."}  # fmt: skip
    [m03] = by_rule(r, "M03")  # same ID and name (case/spaces ignored), codes X10001 and 0
    assert m03.cell == "G3" and "two employee codes" in m03.message
    [m05] = by_rule(r, "M05")
    assert m05.cell == "L5" and m05.suggestion == "Use '03-20-00-00-C-8'."
    [w07] = by_rule(r, "W07")  # INC-02: 1 activity line + OT line, employee blank
    assert (w07.calling_name, w07.sheet, w07.cell) == ("INC-02", "Labour Detail", "G5")
    assert w07.message.startswith("2 upload lines on 1 day(s)")


def test_messages_carry_no_names_or_ids(small_snapshot):
    text = " ".join(f"{i.message} {i.suggestion}" for i in run_health(small_snapshot, OCT).issues)
    for secret in ("Alpha", "alpha", "Bravo", "P1234567", "12345678", "E-77", "Clerk"):
        assert secret not in text


def test_issues_sorted_by_severity(small_snapshot):
    snap = small_snapshot.model_copy(deep=True)
    snap.days[0].entries.append(make_entry("1", 3, "INH-03", None, 19.0, remark="x"))
    r = run_health(snap, OCT)
    assert r.issues[0].rule == "E01"
    assert [i.severity for i in r.issues] == sorted(
        (i.severity for i in r.issues), key=["BLOCK", "WARN", "INFO"].index
    )


def _two_days(small_snapshot, day1, day2):
    snap = small_snapshot.model_copy(deep=True)
    h = snap.days[0].header
    snap.days = [
        DaySheet(header=h, entries=day1),
        DaySheet(header=h.model_copy(update={"sheet": "2", "date": dt.date(2026, 10, 2),
                                             "sheet_no": 2.0}), entries=day2),
    ]  # fmt: skip
    return snap


def test_rest_between_days(small_snapshot):
    act = [("03-11-00-00", 18.0)]
    snap = _two_days(
        small_snapshot,
        [make_entry("1", 0, "INB-01", 7.0, 27.0, act)],  # out 03:00 next morning
        [make_entry("2", 0, "INB-01", 7.0, 19.0, [("03-11-00-00", 11.0)])],
    )
    [w02] = by_rule(run_health(snap, OCT), "W02")
    assert (w02.sheet, w02.cell, w02.calling_name) == ("1", "H9", "INB-01")
    assert w02.message.endswith("4 h rest.")
    # 8 h rest exactly is fine.
    snap.days[0].entries[0].time_out = 23.0
    assert by_rule(run_health(snap, OCT), "W02") == []


def test_double_booking(small_snapshot):
    snap = small_snapshot.model_copy(deep=True)
    # INB-01 and INB-01 CH: same base code, ID and employee code. Back to back is fine.
    snap.days[0].entries = [
        make_entry("1", 0, "INB-01", 7.0, 18.0, [("03-11-00-00", 10.0)]),
        make_entry("1", 1, "INB-01 CH", 18.0, 23.5, [("03-11-00-00", 3.5)]),
    ]
    assert by_rule(run_health(snap, OCT), "W03") == []
    snap.days[0].entries[0].time_out = 19.0
    [w03] = by_rule(run_health(snap, OCT), "W03")
    assert (w03.calling_name, w03.cell) == ("INB-01 CH", "G16")
    assert "same base code, same employee code, same ID" in w03.message


def test_header_impact_in_message(small_snapshot):
    snap = small_snapshot.model_copy(deep=True)
    snap.days[0].header = DayHeader(sheet="4", date=dt.date(2026, 10, 4), day_type="Saturday",
                                    sheet_no=4.0)  # fmt: skip
    [h02] = by_rule(run_health(snap, OCT), "H02")
    # INB-01 11 h and INC-02 13 h effective: Saturday OT 5.5 + 7.5; Sunday rule OT = all hours.
    assert h02.message.endswith("2 worker-days, 24 h effective. OT is 13 h now; the Sunday rule "
                                "gives 24 h.")  # fmt: skip


def test_master_checks(small_snapshot):
    snap = small_snapshot.model_copy(deep=True)
    w = snap.master.workers
    w[1].calling_name = "INB-01 "  # stray space
    w[2].trade_group = "Masan"
    w[3].calling_name = "inh03"
    w[3].trade_group = "Superviser"
    snap.master.activities.append(ActivityCode(row=6, raw="03-11-00-00"))
    r = run_health(snap, OCT)
    m01 = sorted(i.message for i in by_rule(r, "M01"))
    assert m01 == [
        "Calling name 'INB-01 ' has stray spaces.",
        "Calling name 'inh03' does not follow the INX-00 [ROLE] format.",
        "Duplicate calling names: 'INB-01' (row 3), 'INB-01 ' (row 4).",
    ]
    assert {i.suggestion for i in by_rule(r, "M04")} == {"Use 'Mason'.", "Use 'Supervisor'."}
    assert any("listed 2 times (cells L3, L6)" in i.message for i in by_rule(r, "M05"))


# --- CLI --------------------------------------------------------------------------------------


@pytest.fixture
def snap_file(tmp_path, small_snapshot):
    snap = small_snapshot.model_copy(deep=True)
    snap.days.append(DaySheet(header=DayHeader(sheet="25", date=dt.date(2026, 10, 25),
                                               day_type="Holiday", sheet_no=25.0)))  # fmt: skip
    return save_snapshot(snap, tmp_path / "snap.json")


def test_cli_writes_csv(snap_file, tmp_path, capsys):
    out = tmp_path / "report.csv"
    assert cli.main([str(snap_file), "--csv", str(out), "--holiday", "2026-10-25"]) == 0
    printed = capsys.readouterr().out
    assert "Holidays used for H02: 2026-10-25" in printed
    assert "Labour Detail!G5 INC-02" in printed
    with out.open(encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    assert [r["rule"] for r in rows] == ["M02", "M02", "M03", "W07", "M05"]
    assert rows[0]["title"] == "Employee code missing, broken or shared"


def test_cli_holiday_override(snap_file, tmp_path, capsys):
    cli.main([str(snap_file), "--csv", str(tmp_path / "a.csv"), "--no-holidays"])
    assert "sheet 25 H3: Day type marked Holiday, but 2026-10-25 is not in the holiday list" in (
        capsys.readouterr().out
    )


def test_cli_needs_a_workbook(monkeypatch, tmp_path):
    with pytest.raises(SystemExit):
        cli.main([str(tmp_path / "missing.xlsb")])


# --- API --------------------------------------------------------------------------------------


@pytest.fixture
def client(snap_file):
    config = Config(month="2026-10", workbook_file=snap_file, holidays=[dt.date(2026, 10, 25)])
    return TestClient(create_app(config))


def test_api_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["holidays"] == ["2026-10-25"]
    assert body["stats"]["by_rule"] == {"M02": 2, "M03": 1, "M05": 1, "W07": 1}


def test_api_holiday_override(client):
    body = client.get("/api/health", params={"holidays": ""}).json()
    assert body["holidays"] == [] and body["stats"]["by_rule"]["H02"] == 1
    assert client.get("/api/health", params={"holidays": "25/10/2026"}).status_code == 422


def test_api_csv_and_rules(client):
    res = client.get("/api/health.csv")
    assert res.headers["content-type"].startswith("text/csv")
    assert 'filename="synthetic_health.csv"' in res.headers["content-disposition"]
    assert res.text.lstrip("﻿").startswith("severity,rule,title,")
    assert client.get("/api/rules").json()["E05"]["severity"] == "BLOCK"


def test_pages(client):
    assert "Workbook health check" in client.get("/health").text
    res = client.get("/", follow_redirects=True)  # the entry UI when built, else the report
    assert res.status_code == 200 and ('id="root"' in res.text or "health check" in res.text)


def test_api_without_workbook():
    res = TestClient(create_app(Config(month="2026-10"))).get("/api/health")
    assert res.status_code == 503


def test_lan_off_binds_localhost():
    cfg = Config(month="2026-10", server={"host": "0.0.0.0", "allow_lan": False})
    assert bind_host(cfg) == "127.0.0.1"
    cfg = Config(month="2026-10", server={"host": "0.0.0.0", "allow_lan": True})
    assert bind_host(cfg) == "0.0.0.0"
