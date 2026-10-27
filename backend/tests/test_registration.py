"""Phase 4: registration reader, R checks, employee-code proposals and the approved code write.

All registration workbooks here are built in the test with made-up data.
"""

import datetime as dt

import openpyxl
import pytest

from app.audit.backups import BackupManager
from app.audit.store import AuditStore
from app.config import Config, TemplateConfig
from app.domain.writes import RangeWrite, unwritable_cells
from app.excel.fake_adapter import FakeWorkbook
from app.registration.checks import (
    check_registrations,
    entry_form,
    next_free_numbers,
    nic_birth,
    parse_date,
)
from app.registration.proposals import id_conflicts, propose_codes
from app.registration.reader import read_registration
from app.service import CodeWrite, EntryService

INDIAN_HEADER = ["", "Project", "Emp. code", "Title", "Last Name", "CallingName", "Gender",
                 "Designation", "Trade group", "Department  ", "ID number", "Internal / External",
                 "Designation", "Business partner", "Permanent Address", "Contact No.",
                 "G/S Division", "Police Station", "Contact in an emergency", "Date of birth",
                 "First date of employment"]  # fmt: skip
SUPPLY_HEADER = [h for i, h in enumerate(INDIAN_HEADER) if i != 12]  # no 2nd Designation


def write_xlsx(path, sheets: dict[str, list[list]]):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for title, rows in sheets.items():
        ws = wb.create_sheet(title)
        for r in rows:
            ws.append(r)
    wb.save(path)
    return path


def indian_row(code, name, id_no, designation, dob="02.05.1990", start="22.09.2026"):
    return ["", 525, code, "Mr", "Test Person", name, "Male", designation, "SUS",
            "525M - KMTT", id_no, "External", "Carpenter", "BP1019692", "addr", 0, "", "", 0,
            dob, start]  # fmt: skip


def supply_row(
    name, id_no, dob, gender="Male", designation="Supply-Rigger", trade=None, start="01.09.2026"
):
    trade = trade or name.split("-")[0]
    return ["", 525, None, "Mr", "Test Person", name, gender, designation, trade, "525M - KMTT",
            id_no, "External", "BP1000001", "addr", 0, "", "", 0, dob, start]  # fmt: skip


@pytest.fixture
def indian_file(tmp_path):
    return write_xlsx(tmp_path / "indian.xlsx", {"External ": [
        INDIAN_HEADER,
        indian_row("XIN090", "INC02", 12345678, "Indian-Carpenter"),  # = Labour Detail INC-02 ID
        indian_row("XIN091", "INH03", "P7654321", "Indian-Helper"),  # ID differs from Labour Detail
        indian_row("XIN091", "AYR10", "199012300123", "Supply-Rigger"),  # leftover, same code
        indian_row("XIN092", "INB01", "P1234568", "Indian-Barbender"),  # INB-01 has X10001
        indian_row("XIN093", "INB-77", "P1234567", "Indian-Barbender"),  # ID of INB-01
    ]})  # fmt: skip


@pytest.fixture
def supply_file(tmp_path):
    return write_xlsx(tmp_path / "supply.xlsx", {
        "External ": [
            SUPPLY_HEADER,
            supply_row("AYR-01", "199012300123", "30.04.1990"),  # day 123 -> 3 May: mismatch
            supply_row("AYR-02", "199062300123", "03.05.1990", gender="Male"),  # 623 = female
            supply_row("AYR-03", "901230123V", "03.05.1990"),  # old NIC, fine
            supply_row("AYR-04", "90123012V", "1990.05.03"),  # bad NIC; other date format
            supply_row("AYH-05", "200912300123", "03.05.2009", designation="Supply-Helpr"),
            supply_row("AYR-06", "199012300123", "03.05.199"),  # unreadable date; same ID
            supply_row("AYR-06", "199112300123", "03.05.1991", trade="AYH"),  # duplicate name
        ],
        "Re-Designations": [SUPPLY_HEADER, supply_row("AYR-09", "199112300123", "03.05.1991",
                                                       designation="Supply-Mason")],
    })  # fmt: skip


@pytest.fixture
def list_file(tmp_path):
    return write_xlsx(tmp_path / "list.xlsx", {"Sheet1": [["AYR-01"], ["AYR-03"], ["AYR-99"]]})


# --- reader -------------------------------------------------------------------------------------


def test_reader_finds_columns_by_header(indian_file, supply_file, list_file):
    ind = read_registration(indian_file)
    assert ind.kind == "registration" and len(ind.rows) == 5
    r = ind.rows[0]
    assert (r.calling_name, r.emp_code, r.id_no, r.designation2) == (
        "INC02",
        "XIN090",
        12345678,
        "Carpenter",
    )
    assert (r.cell("emp_code"), r.cell("dob"), r.cell("start")) == ("C2", "T2", "U2")
    sup = read_registration(supply_file)
    assert [s.rows for s in sup.sheets] == [7, 1]
    assert sup.rows[0].cell("dob") == "S2" and sup.rows[0].designation2 is None  # shifted left
    lst = read_registration(list_file)
    assert lst.kind == "list" and [r.calling_name for r in lst.rows] == [
        "AYR-01",
        "AYR-03",
        "AYR-99",
    ]


def test_real_excel_dates_become_iso(tmp_path):
    row = supply_row(
        "AYR-01", "199012300123", dt.datetime(1990, 5, 3), start=dt.datetime(2026, 9, 1)
    )
    path = write_xlsx(tmp_path / "d.xlsx", {"S": [SUPPLY_HEADER, row]})
    r = read_registration(path).rows[0]
    assert (r.dob, r.start) == ("1990-05-03", "2026-09-01")
    assert parse_date(r.dob) == (dt.date(1990, 5, 3), "date")


# --- helpers ------------------------------------------------------------------------------------


def test_entry_form():
    assert entry_form("INH22") == "INH-22" and entry_form("inh - 22") == "INH-22"
    assert entry_form("INC46 M") == "INC-46 M" and entry_form("CSPL-01") == "CSPL-01"
    assert entry_form("Mr Smith") is None


@pytest.mark.parametrize(
    ("nic", "expected"),
    [
        ("901230123V", (dt.date(1990, 5, 2), False)),  # day 123 counting Feb as 29 days
        ("199012300123", (dt.date(1990, 5, 2), False)),
        ("199062300123", (dt.date(1990, 5, 2), True)),  # +500 = female
        ("200006000123", (dt.date(2000, 2, 29), False)),  # day 60 = 29 Feb
        ("199006100123", (dt.date(1990, 3, 1), False)),  # day 61 = 1 Mar, every year
        ("199006000123", "day of year"),  # 29 Feb 1990 does not exist
        ("199036700123", "day of year"),
        ("90123012V", "format"),
    ],
)
def test_nic_birth(nic, expected):
    assert nic_birth(nic) == expected


def test_parse_date_formats():
    assert parse_date("03.05.1990") == (dt.date(1990, 5, 3), "dd.mm.yyyy")
    assert parse_date("1990.05.03") == (dt.date(1990, 5, 3), "yyyy.mm.dd")
    assert parse_date(32996.0) == (dt.date(1990, 5, 3), "serial")
    assert parse_date("03.051990")[0] is None and parse_date(12.031990)[0] is None


def test_next_free_numbers():
    assert next_free_numbers(["AYR-07", "AYR-12", "ADH-239", "ADH-05", "INB-04 CH"]) == {
        "ADH": "ADH-240", "AYR": "AYR-13", "INB": "INB-05",
    }  # fmt: skip


# --- R checks -----------------------------------------------------------------------------------


def test_checks_on_supply_and_list(supply_file, list_file):
    report = check_registrations([read_registration(supply_file), read_registration(list_file)])
    found = {(i.rule, i.calling_name, i.cell) for i in report.issues}
    assert ("R04", "AYR-01", "S2") in found  # DOB 30.04.1990 vs NIC 02.05.1990
    assert ("R04", "AYR-02", "G3") in found  # gender: NIC says female
    assert ("R04", "AYR-04", "K5") in found  # 8 digits + V
    assert ("R05", "AYR-04", "S5") in found  # yyyy.mm.dd among dd.mm.yyyy
    assert ("R05", "AYR-06", "S7") in found  # 03.05.199 unreadable
    assert ("R05", "AYH-05", "S6") in found  # under 18 on 01.09.2026
    assert ("R03", "AYH-05", "H6") in found  # Supply-Helpr
    assert ("R03", "AYR-06", "I8") in found  # trade group AYH on an AYR name
    assert ("R03", "AYR-09", "H2") in found  # Mason designation on an R (Rigger) name
    assert ("R01", "AYR-06", "F8") in found  # registered twice
    assert ("R02", "AYR-06", "K7") in found  # ID also on AYR-01 / AYR-02 rows
    assert ("R06", "AYR-99", "A3") in found  # list only
    assert ("R06", "AYR-02", "F3") in found  # registered, not listed
    helpr = next(i for i in report.issues if i.cell == "H6")
    assert helpr.suggestion == "Use 'Supply-Helper'."
    assert report.next_numbers["AYR"] == "AYR-100"
    # Messages never quote ID numbers.
    assert not any("1990123" in f"{i.message} {i.suggestion}" for i in report.issues)


def test_indian_rows_skip_nic_rules(indian_file):
    report = check_registrations([read_registration(indian_file)])
    # Passports on the IN rows: no NIC rules. Only XIN091 on INH-03 and AYR-10 is reported.
    assert [(i.rule, i.calling_name) for i in report.issues] == [("R02", "AYR-10")]
    assert report.no_hyphen == 4  # INC02, INH03, AYR10, INB01


# --- proposals ----------------------------------------------------------------------------------


def test_proposals(small_snapshot, indian_file):
    rows = read_registration(indian_file).rows
    props = {p.calling_name: p for p in propose_codes(small_snapshot.master, rows)}
    assert set(props) == {"INC-02", "INH-03"}  # the two without a valid code
    inc = props["INC-02"]
    assert (inc.proposed, inc.source, inc.selectable, inc.notes) == (
        "XIN090",
        "registration",
        True,
        [],
    )
    assert inc.found_in == "indian / External row 2"
    inh = props["INH-03"]
    assert inh.proposed == "XIN091" and inh.selectable
    assert inh.notes == ["ID number differs from the registration (calling names win).",
                         "The registration also gives XIN091 to AYR10."]  # fmt: skip


def test_base_code_proposal_and_hard_conflicts(small_snapshot):
    master = small_snapshot.master.model_copy(deep=True)
    master.workers[1].employee_code = "#N/A"  # INB-01 CH: role code of INB-01 (X10001)
    master.workers[2].employee_code = None  # INC-02, registered with INB-01's code below
    from app.registration.reader import RegistrationRow

    reg = [
        RegistrationRow(file="r.xlsx", sheet="S", row=2, calling_name="INC02", emp_code="X10001")
    ]
    props = {p.calling_name: p for p in propose_codes(master, reg)}
    ch = props["INB-01 CH"]
    assert (ch.proposed, ch.source, ch.found_in, ch.selectable) == (
        "X10001",
        "base code",
        "INB-01",
        True,
    )
    inc = props["INC-02"]
    assert inc.proposed == "X10001" and not inc.selectable
    assert inc.conflicts == ["X10001 is already used by INB-01 in Labour Detail."]
    assert props["INH-03"].conflicts == [
        "No registration row with a code for it in the loaded files."
    ]


def test_id_conflicts(small_snapshot, indian_file):
    out = id_conflicts(small_snapshot.master, read_registration(indian_file).rows)
    kinds = {(c.calling_name, c.kind, c.worker) for c in out}
    assert kinds == {
        ("INH-03", "not found", None),  # P7654321 nowhere in Labour Detail
        ("INB-01", "one character", "INB-01, INB-01 CH, INH-03"),  # P1234568 vs P1234567
        ("INB-77", "name differs", "INB-01, INB-01 CH, INH-03"),
    }  # AYR10 is not an IN worker: not compared with this workbook


# --- approved write into Labour Detail G ----------------------------------------------------------


def test_guard_is_sheet_aware():
    t = TemplateConfig()
    g9_master = [RangeWrite(sheet="Labour Detail", address="G9", values=[["X1"]])]
    assert unwritable_cells(g9_master, t) == ["Labour Detail!G9"]  # day-sheet cell, wrong sheet
    assert unwritable_cells(g9_master, t, allow_codes=True) == []
    assert unwritable_cells([RangeWrite(sheet="Labour Detail", address="A9", values=[["x"]])], t,
                            allow_codes=True) == ["Labour Detail!A9"]  # fmt: skip
    assert unwritable_cells([RangeWrite(sheet="SUMMARY ", address="G9", values=[[1]])], t) == [
        "SUMMARY !G9"
    ]
    assert unwritable_cells(
        [RangeWrite(sheet="1", address="G503", values=[[1]])], t, allow_codes=True
    )


@pytest.fixture
def service(small_snapshot, tmp_path):
    fake = FakeWorkbook(small_snapshot)
    svc = EntryService(lambda: fake, Config(month="2026-10"), AuditStore(), BackupManager(tmp_path))
    return svc, fake


def test_write_codes_and_undo(service):
    svc, fake = service
    res = svc.write_codes([CodeWrite(row=5, calling_name="INC-02", code="xin090")], "Navod")
    assert res.status == "written" and res.mismatches == []
    assert res.written == {"G5": ("#N/A", "XIN090")}
    assert fake.read_range("Labour Detail", "G5") == [["XIN090"]]
    # The upload lines on the day sheets pick the new code up (INC-02's OT line).
    assert fake.read_day("1").entries[1].cached.upload[6].employee == "XIN090"
    assert svc.master_view().workers[2].code_status == "valid"
    assert svc.audit.batch(res.batch_id).note == "employee codes" and fake.copies
    undo = svc.undo(res.batch_id, "Navod")
    assert undo.status == "undone" and "blank now" in undo.note
    assert fake.read_range("Labour Detail", "G5") == [[None]]  # formula result cannot come back


def test_write_codes_refusals(service):
    svc, fake = service
    res = svc.write_codes([
        CodeWrite(row=5, calling_name="INB-01", code="XIN090"),  # row moved
        CodeWrite(row=3, calling_name="INB-01", code="XIN090"),  # already valid
        CodeWrite(row=6, calling_name="INH-03", code="X1"),  # malformed
        # INH-03 shares INB-01's ID and name but not its base code: X10001 stays INB-01's.
        CodeWrite(row=6, calling_name="INH-03", code="X10001"),
    ], "Navod")  # fmt: skip
    assert res.status == "rejected"
    assert res.problems == ["Row 5 is INC-02 now, not INB-01.", "INB-01 already has X10001.",
                            "'X1' for INH-03 is not X##### or XIN###.",
                            "X10001 is already used by INB-01, INB-01 CH."]  # fmt: skip
    assert fake.batches == []


# --- API ------------------------------------------------------------------------------------------


def test_api(small_snapshot, indian_file, supply_file, tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    fake = FakeWorkbook(small_snapshot)
    config = Config(
        month="2026-10", registration_files=[indian_file, supply_file, tmp_path / "gone.xlsx"]
    )

    def factory(cfg):
        return EntryService(lambda: fake, cfg, AuditStore(), BackupManager(tmp_path / "b"))

    with TestClient(create_app(config, service_factory=factory)) as c:
        rep = c.get("/api/registration").json()
        assert rep["missing"] == [str(tmp_path / "gone.xlsx")] and rep["by_rule"]["R04"] >= 3
        assert c.get("/api/registration.csv").text.lstrip("\ufeff").startswith("severity,rule,")
        codes = c.get("/api/codes").json()
        assert {p["calling_name"]: p["selectable"] for p in codes["proposals"]} == {
            "INC-02": True, "INH-03": True,
        }  # fmt: skip
        assert len(codes["conflicts"]) == 3
        assert "one character" in c.get("/api/codes/conflicts.csv").text
        item = {"row": 5, "calling_name": "INC-02", "code": "XIN090"}
        body = {"user": "Navod", "items": [item]}
        assert c.post("/api/codes/write", json=body).status_code == 422  # not approved
        res = c.post("/api/codes/write", json={**body, "approve": True}).json()
        assert res["status"] == "written" and res["written"] == {"G5": ["#N/A", "XIN090"]}
        assert [p["calling_name"] for p in c.get("/api/codes").json()["proposals"]] == ["INH-03"]
