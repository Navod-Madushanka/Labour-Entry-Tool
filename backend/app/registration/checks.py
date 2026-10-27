"""Read-only checks of registration files (PLAN.md §6 Phase 4, rules R01-R06).

R01 calling name: format, duplicates            R04 NIC: format, NIC vs date of birth / gender
R02 employee code or ID used twice               R05 dates: unreadable, mixed formats, under 18
R03 designation / trade group spelling           R06 calling-name list vs registration

Messages name workers by calling name; they quote dates where a fix needs them, never ID numbers.
"""

from __future__ import annotations

import datetime as dt
import difflib
import re
from collections import Counter, defaultdict
from collections.abc import Iterable

from pydantic import BaseModel

from app.domain.codes import (
    CALLING_NAME_RE,
    EMPLOYEE_CODE_RE,
    OTHER_TRADE_LETTERS,
    TRADE_NAMES,
    cell_text,
    normalise_code,
)
from app.domain.models import CellValue, Issue
from app.domain.validators import make_issue
from app.registration.reader import RegistrationFile, RegistrationRow

# Trade letters of the calling name -> trade word in a designation ("Supply-Rigger").
TRADE_WORDS = {**TRADE_NAMES, "P": "Painter", "W": "Welder", "E": "Electrician", "PL": "Plumber"}
KNOWN_TRADES = sorted({*TRADE_WORDS.values(), "Carpenter", "Cook", "Cook Helper", "Labourer"})
assert set(TRADE_WORDS) >= OTHER_TRADE_LETTERS

LOOSE_NAME_RE = re.compile(r"^([A-Z]{2,4})\s*-?\s*(\d{2,3})(?:\s+([A-Z]{1,3}))?$")
OLD_NIC_RE = re.compile(r"^(\d{2})(\d{3})\d{4}[VX]$")
NEW_NIC_RE = re.compile(r"^(\d{4})(\d{3})\d{5}$")
PASSPORT_RE = re.compile(r"^[A-Z]{1,2}\d{6,8}$")
INDIAN_GROUP = "IN"  # calling-name group of the Indian workers (PLAN.md §5.7)


class RegistrationReport(BaseModel):
    files: list[dict]
    rows: int
    no_hyphen: int  # calling names written without the hyphen (normal in these files)
    next_numbers: dict[str, str]  # prefix -> next free calling name
    issues: list[Issue]
    by_rule: dict[str, int]


# --- Helpers -----------------------------------------------------------------------------------


def entry_form(text: str | None) -> str | None:
    """'INH22' / 'inh - 22' -> 'INH-22' (the entry-sheet form); None when not name-like."""
    if not text:
        return None
    m = LOOSE_NAME_RE.match(re.sub(r"\s+", " ", text.strip().upper()))
    if not m:
        return None
    letters, num, role = m.groups()
    return f"{letters}-{num}" + (f" {role}" if role else "")


def prefix_of(name: str) -> str | None:
    m = re.match(r"^([A-Z]{2,4})-", name)
    return m.group(1) if m else None


def trade_letters(name: str) -> str | None:
    """'AYR-07' -> 'R', 'CSPL-01' -> 'PL' (group = first 2 letters)."""
    p = prefix_of(name)
    return p[2:] if p and len(p) > 2 else None


def parse_date(value: CellValue) -> tuple[dt.date | None, str]:
    """A registration date and how it was written. ISO text = a real Excel date cell."""
    if value is None:
        return None, "blank"
    if isinstance(value, int | float) and not isinstance(value, bool):
        if 20000 <= value <= 80000:  # an Excel serial date (1954-2119)
            return dt.date(1899, 12, 30) + dt.timedelta(days=int(value)), "serial"
        return None, "number"
    text = str(value).strip()
    for fmt, label in (("%Y-%m-%d", "date"), ("%d.%m.%Y", "dd.mm.yyyy"), ("%Y.%m.%d", "yyyy.mm.dd"),
                       ("%d/%m/%Y", "dd/mm/yyyy"), ("%d-%m-%Y", "dd-mm-yyyy")):  # fmt: skip
        try:
            return dt.datetime.strptime(text, fmt).date(), label
        except ValueError:
            pass
    return None, "text"


def nic_birth(nic: str) -> tuple[dt.date, bool] | str:
    """Date of birth and female flag from a Sri Lankan NIC, or why it cannot be read.

    Old: 9 digits + V/X (YY + day of year); new: 12 digits (YYYY + day of year). Day of year above
    500 means female. The day of year counts February as 29 days in every year.
    """
    if m := OLD_NIC_RE.match(nic):
        year, doy = 1900 + int(m.group(1)), int(m.group(2))
    elif m := NEW_NIC_RE.match(nic):
        year, doy = int(m.group(1)), int(m.group(2))
    else:
        return "format"
    female = doy > 500
    doy -= 500 if female else 0
    if not 1 <= doy <= 366:
        return "day of year"
    month_day = dt.date(2000, 1, 1) + dt.timedelta(days=doy - 1)  # 2000: Feb has 29 days
    try:
        return dt.date(year, month_day.month, month_day.day), female
    except ValueError:  # 29 Feb in a non-leap year
        return "day of year"


def id_kind(value: CellValue) -> tuple[str, str]:
    """('nic' | 'passport' | 'bad' | 'blank', normalised text)."""
    text = re.sub(r"\s+", "", cell_text(value)).upper()
    if not text:
        return "blank", text
    if OLD_NIC_RE.match(text) or NEW_NIC_RE.match(text):
        return "nic", text
    if PASSPORT_RE.match(text):
        return "passport", text
    return "bad", text


def age_on(born: dt.date, day: dt.date) -> int:
    return day.year - born.year - ((day.month, day.day) < (born.month, born.day))


# --- Checks ------------------------------------------------------------------------------------


def check_registrations(
    files: Iterable[RegistrationFile], workbook_names: Iterable[str] = ()
) -> RegistrationReport:
    """All R checks over the given files. ``workbook_names`` (Labour Detail calling names) only
    feed the next-free-number table."""
    files = list(files)
    issues: list[Issue] = []
    reg_rows = [r for f in files if f.kind == "registration" for r in f.rows if r.calling_name]
    list_rows = [r for f in files if f.kind == "list" for r in f.rows if r.calling_name]

    def issue(rule: str, r: RegistrationRow, field: str, message: str, suggestion=None) -> None:
        issues.append(make_issue(rule, message, sheet=r.where, cell=r.cell(field),
                                 calling_name=entry_form(r.calling_name) or r.calling_name,
                                 suggestion=suggestion))  # fmt: skip

    no_hyphen = 0
    by_name: dict[str, list[RegistrationRow]] = defaultdict(list)
    for r in reg_rows + list_rows:
        form = entry_form(r.calling_name)
        if form is None or not CALLING_NAME_RE.match(form):
            issue("R01", r, "calling_name", f"Calling name {r.calling_name!r} is not in the "
                  "XXX-00 [ROLE] form.")  # fmt: skip
            continue
        no_hyphen += "-" not in r.calling_name
        if r in reg_rows:
            by_name[normalise_code(form)].append(r)
    for rows in by_name.values():
        if len(rows) > 1:
            where = "; ".join(f"{x.where} row {x.row}" for x in rows)
            issue("R01", rows[1], "calling_name", f"Calling name registered {len(rows)} times "
                  f"({where}).")  # fmt: skip

    _check_duplicates(reg_rows, issue)
    _check_designations(reg_rows, issue)
    for r in reg_rows:
        _check_nic_and_dates(r, issue)
    _check_date_formats(reg_rows, issue)

    if reg_rows and list_rows:  # R06
        registered = {
            normalise_code(entry_form(r.calling_name) or r.calling_name) for r in reg_rows
        }
        listed = {normalise_code(entry_form(r.calling_name) or r.calling_name) for r in list_rows}
        for r in list_rows:
            if normalise_code(entry_form(r.calling_name) or r.calling_name) not in registered:
                issue("R06", r, "calling_name", "On the calling-name list but in no registration "
                      "file.")  # fmt: skip
        for r in reg_rows:
            if normalise_code(entry_form(r.calling_name) or r.calling_name) not in listed:
                issue("R06", r, "calling_name", "Registered but not on the calling-name list.")

    names = [entry_form(r.calling_name) for r in reg_rows + list_rows] + list(workbook_names)
    return RegistrationReport(
        files=[
            {"name": f.name, "kind": f.kind, "sheets": [s.model_dump() for s in f.sheets]}
            for f in files
        ],
        rows=len(reg_rows) + len(list_rows),
        no_hyphen=no_hyphen,
        next_numbers=next_free_numbers(n for n in names if n),
        issues=issues,
        by_rule=dict(sorted(Counter(i.rule for i in issues).items())),
    )


def _check_duplicates(rows: list[RegistrationRow], issue) -> None:
    """R02: one employee code or one ID on different calling names."""
    for field, label in (("emp_code", "Employee code"), ("id_no", "ID number")):
        owners: dict[str, list[RegistrationRow]] = defaultdict(list)
        for r in rows:
            value = getattr(r, field)
            if value is None:
                continue
            key = normalise_code(value)
            if field == "emp_code" and not EMPLOYEE_CODE_RE.match(key):
                continue
            owners[key].append(r)
        for key, group in owners.items():
            names = {normalise_code(entry_form(r.calling_name) or r.calling_name) for r in group}
            if len(names) > 1:
                who = ", ".join(entry_form(r.calling_name) or str(r.calling_name) for r in group)
                shown = key if field == "emp_code" else "The same ID number"
                text = f"{label} {shown}" if field == "emp_code" else shown
                for r in group[1:]:
                    issue("R02", r, field, f"{text} is on {len(group)} calling names: {who}.")


def _check_designations(rows: list[RegistrationRow], issue) -> None:
    """R03: designation trade spelling, designation vs calling-name trade, trade group."""
    by_sheet: dict[tuple[str, str], list[RegistrationRow]] = defaultdict(list)
    for r in rows:
        by_sheet[(r.file, r.sheet)].append(r)
        form = entry_form(r.calling_name)
        designation = cell_text(r.designation).strip()
        if not designation or not form:
            continue
        word = re.split(r"\s*-\s*", designation)[-1].strip()
        known = {t.casefold(): t for t in KNOWN_TRADES}
        if word.casefold() not in known:
            close = difflib.get_close_matches(word.title(), KNOWN_TRADES, n=1, cutoff=0.7)
            fix = designation.replace(word, close[0]) if close else None
            issue("R03", r, "designation", f"Designation {designation!r}: {word!r} is not a known "
                  "trade.", f"Use {fix!r}." if fix else None)  # fmt: skip
            continue
        expected = TRADE_WORDS.get(trade_letters(form) or "")
        if expected and known[word.casefold()] != expected:
            issue("R03", r, "designation", f"Designation {designation!r} but the calling name's "
                  f"trade letter means {expected}.")  # fmt: skip
    # Trade group = calling-name prefix, when the sheet follows that convention (supply files).
    for group in by_sheet.values():
        pairs = [(r, cell_text(r.trade_group).strip(), prefix_of(entry_form(r.calling_name) or ""))
                 for r in group if r.trade_group is not None]  # fmt: skip
        if not pairs:
            continue
        if sum(tg == p for _, tg, p in pairs) / len(pairs) < 0.8:
            continue  # e.g. the Indian file's SUS/SMS groups
        for r, tg, p in pairs:
            if p and tg != p:
                issue("R03", r, "trade_group", f"Trade group {tg!r}, but the calling name "
                      f"starts {p!r}.", f"Use {p!r}.")  # fmt: skip


def _check_nic_and_dates(r: RegistrationRow, issue) -> None:
    """R04 NIC format / NIC vs date of birth and gender; R05 unreadable dates, under 18."""
    born, _ = parse_date(r.dob)
    start, _ = parse_date(r.start)
    for field, value, parsed in (("dob", r.dob, born), ("start", r.start, start)):
        if value is not None and parsed is None:
            label = "Date of birth" if field == "dob" else "First date of employment"
            issue("R05", r, field, f"{label} {cell_text(value)!r} is not a readable date.",
                  "Write it as dd.mm.yyyy.")  # fmt: skip
    if born and start and age_on(born, start) < 18:
        issue("R05", r, "dob", f"Under 18 on the first day ({age_on(born, start)} on "
              f"{start:%d.%m.%Y}).")  # fmt: skip

    if (entry_form(r.calling_name) or "").startswith(INDIAN_GROUP):
        return  # Indian workers carry passports (some stored as numbers): no NIC rules
    kind, nic = id_kind(r.id_no)
    if kind == "bad":
        issue("R04", r, "id_no", f"ID number is not a valid NIC ({len(nic)} characters; old NIC "
              "= 9 digits + V/X, new NIC = 12 digits).")  # fmt: skip
        return
    if kind != "nic":
        return  # passports (Indian rows) and blanks: no NIC rules
    decoded = nic_birth(nic)
    if isinstance(decoded, str):
        issue("R04", r, "id_no", "NIC number has an impossible day of year.")
        return
    nic_born, female = decoded
    if born and born != nic_born:
        issue("R04", r, "dob", f"Date of birth {born:%d.%m.%Y}, but the NIC says "
              f"{nic_born:%d.%m.%Y}.")  # fmt: skip
    gender = cell_text(r.gender).strip().casefold()
    if gender in ("male", "m", "female", "f") and (gender in ("female", "f")) != female:
        issue("R04", r, "gender", f"Gender {cell_text(r.gender)!r}, but the NIC says "
              f"{'female' if female else 'male'}.")  # fmt: skip


def _check_date_formats(rows: list[RegistrationRow], issue) -> None:
    """R05: dates written differently from the rest of their file (mixed formats)."""
    for field, label in (("dob", "Date of birth"), ("start", "First date of employment")):
        by_file: dict[str, list[tuple[RegistrationRow, str]]] = defaultdict(list)
        for r in rows:
            date, fmt = parse_date(getattr(r, field))
            if date is not None:
                by_file[r.file].append((r, fmt))
        for group in by_file.values():
            usual = Counter(f for _, f in group).most_common(1)[0][0]
            for r, fmt in group:
                if fmt != usual and {fmt, usual} != {"date", "serial"}:
                    issue("R05", r, field, f"{label} written as {fmt}; the rest of the file uses "
                          f"{usual}.")  # fmt: skip


def next_free_numbers(names: Iterable[str]) -> dict[str, str]:
    """Per calling-name prefix, the next number after the highest in use: {'AYR': 'AYR-23'}."""
    top: dict[str, tuple[int, int]] = {}
    for name in names:
        m = re.match(r"^([A-Z]{2,4})-(\d{2,3})", name)
        if not m:
            continue
        prefix, digits = m.group(1), m.group(2)
        num, width = top.get(prefix, (0, 2))
        top[prefix] = (max(num, int(digits)), max(width, len(digits)))
    return {p: f"{p}-{n + 1:0{w}d}" for p, (n, w) in sorted(top.items())}
