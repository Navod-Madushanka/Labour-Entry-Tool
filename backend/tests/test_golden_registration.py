"""Phase 4 on the real files (local only; skipped without them): the September 2026 supply
registration plus its calling-name list, and the INDIAN workbook's employee codes."""

from collections import Counter

import pytest

from app.config import TemplateConfig
from app.registration.checks import check_registrations
from app.registration.proposals import id_conflicts, propose_codes
from app.registration.reader import read_registration
from tests.conftest import FIXTURES

PRIVATE = FIXTURES / "private"
SEPTEMBER = PRIVATE / "Labour Registration Supply September.xlsx"
LIST = PRIVATE / "Supply Labour Registeration.xlsx"

pytestmark = [
    pytest.mark.golden,
    pytest.mark.skipif(
        not (SEPTEMBER.exists() and LIST.exists()), reason="no supply registration files"
    ),
]


@pytest.fixture(scope="module")
def files():
    return [read_registration(SEPTEMBER), read_registration(LIST)]


def test_supply_files_read(files):
    sep, lst = files
    assert [(s.title, s.kind, s.rows) for s in sep.sheets] == [
        ("External ", "registration", 55), ("Re-Designations", "registration", 16),
    ]  # fmt: skip
    assert lst.kind == "list" and len(lst.rows) == 73
    assert all(r.emp_code is None for r in sep.rows)  # no employee codes in this file


def test_supply_checks(files):
    report = check_registrations(files)
    assert report.by_rule == {"R03": 3, "R04": 8, "R05": 4, "R06": 2}
    r04 = Counter("NIC says" in i.message for i in report.issues if i.rule == "R04")
    assert r04 == {True: 5, False: 3}  # 5 DOB vs NIC mismatches, 3 invalid NIC numbers
    r05 = Counter("not a readable date" in i.message for i in report.issues if i.rule == "R05")
    assert r05 == {True: 2, False: 2}  # 2 unreadable DOBs, 2 written yyyy.mm.dd
    assert sorted(i.calling_name for i in report.issues if i.rule == "R06") == ["BAM-03", "BAS-02"]
    assert sum("Supervior" in i.message for i in report.issues) == 2


def _indian_master():
    xlsb = sorted(PRIVATE.glob("*INDIAN*.xlsb"))
    if xlsb:
        from app.excel.xlsb_reader import XlsbReader

        with XlsbReader(xlsb[0], TemplateConfig()) as reader:
            return reader.read_master()
    json = sorted((FIXTURES / "sanitized").glob("*indian*.json"))
    if json:
        from app.excel.fake_adapter import load_snapshot

        return load_snapshot(json[0]).master
    pytest.skip("no INDIAN workbook or snapshot")


def test_indian_codes_without_the_indian_registration(files):
    """Only INC-46 M can be proposed (from its base code); the 36 Indian #N/A rows and INH-21
    wait for the Indian registration / the office. The supply rows touch no Indian worker."""
    master = _indian_master()
    rows = [r for f in files for r in f.rows]
    props = propose_codes(master, rows)
    assert len(props) == 38
    chosen = [(p.calling_name, p.proposed, p.source) for p in props if p.selectable]
    assert chosen == [("INC-46 M", "X49917", "base code")]
    assert id_conflicts(master, rows) == []
