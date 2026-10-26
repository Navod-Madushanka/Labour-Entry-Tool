import pytest

from app.domain import codes
from app.domain.codes import EmployeeCodeStatus as S


@pytest.mark.parametrize(
    ("text", "group", "trade", "num", "role"),
    [
        ("INB-04", "IN", "B", "04", None),
        ("INB-04 CH", "IN", "B", "04", "CH"),
        ("INC-46 M", "IN", "C", "46", "M"),
        ("INH-123", "IN", "H", "123", None),
        ("INPL-01", "IN", "PL", "01", None),
        ("SUE-12 S", "SU", "E", "12", "S"),
    ],
)
def test_parse_calling_name(text, group, trade, num, role):
    cn = codes.parse_calling_name(text)
    assert (cn.group, cn.trade, cn.num, cn.role) == (group, trade, num, role)
    assert cn.text == text


@pytest.mark.parametrize(
    "text",
    ["INB04", "inb-04", "INB-04  CH", "INB-4", "INB-0004", " INB-04", "INB-04 ", "INB-04 CHXX",
     "IINBB-04", "INB_04", None, 4.0],
)  # fmt: skip
def test_parse_calling_name_rejects(text):
    assert codes.parse_calling_name(text) is None


def test_base_and_trade_name():
    cn = codes.parse_calling_name("INB-04 CH")
    assert cn.base == "INB-04"
    assert cn.trade_name == "Barbender"
    assert codes.parse_calling_name("INPL-01").trade_name is None


@pytest.mark.parametrize(
    ("a", "b"), [("INH22", "INH-22"), (" inh-22 ", "INH-22"), ("INB-04 CH", "inb04ch")]
)
def test_normalise_matches(a, b):
    assert codes.normalise_code(a) == codes.normalise_code(b)


def test_normalise_keeps_role_distinct_from_base():
    assert codes.normalise_code("INB-04 CH") != codes.normalise_code("INB-04")


def test_base_calling_name_loose_input():
    assert codes.base_calling_name("INB-04 CH") == "INB-04"
    assert codes.base_calling_name(" inb-04   ch ") == "INB-04"
    assert codes.base_calling_name("garbage") is None


def test_person_key_joins_role_suffix_with_base():
    assert codes.person_key("INB-04 CH") == codes.person_key("INB-04") == "INB04"
    assert codes.person_key("INC-46 M") == codes.person_key("INC-46")
    assert codes.person_key("INC-46") != codes.person_key("INC-47")


@pytest.mark.parametrize(
    ("value", "status"),
    [
        ("X12345", S.VALID),
        ("XIN089", S.VALID),
        ("#N/A", S.ERROR),
        (0.0, S.ZERO),
        ("0", S.ZERO),
        (None, S.MISSING),
        ("  ", S.MISSING),
        ("X1234", S.INVALID),
        ("XIN12", S.INVALID),
        (" X12345", S.INVALID),
        ("x12345", S.INVALID),
        (12345.0, S.INVALID),
    ],
)
def test_employee_code_status(value, status):
    assert codes.employee_code_status(value) == status


def test_activity_normalisation_and_shape():
    assert codes.normalise_activity(" 03-11-00-00 ") == "03-11-00-00"
    assert codes.normalise_activity("   ") is None
    assert codes.normalise_activity(None) is None
    for good in ["03-11-00-00", "03-11-00-00-P", "03-20-00-00-C-8"]:
        assert codes.has_activity_shape(good)
    for bad in ["3-11-00-00", "03-11-00", "03-11-00-00-", "03 11 00 00"]:
        assert not codes.has_activity_shape(bad)


def test_cell_text():
    assert codes.cell_text(12345678.0) == "12345678"
    assert codes.cell_text(7.5) == "7.5"
    assert codes.cell_text(None) == ""
    assert codes.cell_text(True) == "TRUE"


def test_is_excel_error():
    assert codes.is_excel_error("#N/A")
    assert not codes.is_excel_error("N/A")
    assert not codes.is_excel_error(0.0)
