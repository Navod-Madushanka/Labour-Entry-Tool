"""Calling-name grammar, employee codes, activity codes and normalisation (PLAN.md §5.7)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from app.domain.models import CellValue

EXCEL_ERRORS = frozenset(
    {"#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA",
     "#SPILL!", "#CALC!", "#FIELD!", "#BLOCKED!", "#UNKNOWN!", "#CONNECT!", "#BUSY!"}
)  # fmt: skip


def is_excel_error(value: CellValue) -> bool:
    return isinstance(value, str) and value in EXCEL_ERRORS


def cell_text(value: CellValue) -> str:
    """Cell value as text the way it reads on screen for codes/IDs (12345.0 -> '12345')."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


# --- Calling names ----------------------------------------------------------------------------

CALLING_NAME_RE = re.compile(
    r"^(?P<group>[A-Z]{2})(?P<trade>[A-Z]{1,2})-(?P<num>\d{2,3})(?: (?P<role>[A-Z]{1,3}))?$"
)

TRADE_NAMES = {
    "B": "Barbender",
    "C": "Carpenter",
    "H": "Helper",
    "M": "Mason",
    "R": "Rigger",
    "S": "Supervisor",
}
# Seen in other workbooks; their trade names are not confirmed yet.
OTHER_TRADE_LETTERS = frozenset({"E", "P", "PL", "W"})


@dataclass(frozen=True)
class CallingName:
    group: str
    trade: str
    num: str
    role: str | None = None

    @property
    def base(self) -> str:
        """The person's base code: 'INB-04 CH' -> 'INB-04'."""
        return f"{self.group}{self.trade}-{self.num}"

    @property
    def text(self) -> str:
        return f"{self.base} {self.role}" if self.role else self.base

    @property
    def trade_name(self) -> str | None:
        return TRADE_NAMES.get(self.trade)


def parse_calling_name(value: CellValue) -> CallingName | None:
    """Strict parse of the entry-sheet form (no trimming, uppercase only)."""
    if not isinstance(value, str):
        return None
    m = CALLING_NAME_RE.match(value)
    if not m:
        return None
    return CallingName(m["group"], m["trade"], m["num"], m["role"])


def normalise_code(value: CellValue) -> str:
    """Matching key: uppercase, trimmed, spaces and hyphens removed. 'INH22' == 'INH-22'."""
    return re.sub(r"[\s\-]", "", cell_text(value).upper())


def base_calling_name(value: CellValue) -> str | None:
    """Base code of a calling name, also for loosely typed input ('inb-04  ch' -> 'INB-04')."""
    parsed = parse_calling_name(value)
    if parsed is None and isinstance(value, str):
        parsed = parse_calling_name(re.sub(r"\s+", " ", value.strip().upper()))
    return parsed.base if parsed else None


def person_key(value: CellValue) -> str:
    """Key that treats a base code and its role-suffix codes as one person (W03)."""
    base = base_calling_name(value)
    return normalise_code(base if base is not None else value)


# --- Employee codes ---------------------------------------------------------------------------

EMPLOYEE_CODE_RE = re.compile(r"^(?:X\d{5}|XIN\d{3})$")


class EmployeeCodeStatus(StrEnum):
    VALID = "valid"
    MISSING = "missing"  # blank
    ERROR = "error"  # e.g. #N/A from the broken VLOOKUP in G214:G250
    ZERO = "zero"  # e.g. INH-21
    INVALID = "invalid"  # something else that is not X##### / XIN###


def employee_code_status(value: CellValue) -> EmployeeCodeStatus:
    if value is None or (isinstance(value, str) and not value.strip()):
        return EmployeeCodeStatus.MISSING
    if is_excel_error(value):
        return EmployeeCodeStatus.ERROR
    if cell_text(value).strip() == "0":
        return EmployeeCodeStatus.ZERO
    if isinstance(value, str) and EMPLOYEE_CODE_RE.match(value):  # stray spaces are invalid
        return EmployeeCodeStatus.VALID
    return EmployeeCodeStatus.INVALID


# --- Activity codes ---------------------------------------------------------------------------

ACTIVITY_SHAPE_RE = re.compile(r"^\d{2}-\d{2}-\d{2}-\d{2}(?:-[A-Za-z0-9]+)*$")


def normalise_activity(value: CellValue) -> str | None:
    """Trimmed activity code (always compare and write this form); None when blank."""
    text = cell_text(value).strip()
    return text or None


def has_activity_shape(code: str) -> bool:
    """`NN-NN-NN-NN` plus optional `-suffix` parts. Informational only: E04 checks the list."""
    return bool(ACTIVITY_SHAPE_RE.match(code))
