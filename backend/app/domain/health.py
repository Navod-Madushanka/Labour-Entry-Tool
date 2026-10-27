"""Whole-workbook health check (PLAN.md §6 Phase 1, §7). Read-only.

Runs the header and entry checks from ``validators`` over every day sheet, plus the checks that
need the whole month: master data (M01-M05), rest between days (W02), double bookings (W03) and
upload lines without an employee code (W07). Registration cross-checks come with the registration
reader (Phase 4).

Messages name workers by calling name only, never by name or ID number (PLAN.md §10).
"""

from __future__ import annotations

import datetime as dt
import re
from collections import Counter, defaultdict
from collections.abc import Iterable

from pydantic import BaseModel

from app.config import TemplateConfig
from app.domain import rules
from app.domain.codes import (
    EmployeeCodeStatus,
    cell_text,
    employee_code_status,
    normalise_code,
    parse_calling_name,
    person_key,
)
from app.domain.models import (
    Computed,
    DaySheet,
    Entry,
    Issue,
    SnapshotMeta,
    WorkbookSnapshot,
    Worker,
    as_number,
    is_blank,
)
from app.domain.validators import (
    MIN_REST,
    RULES,
    calendar_day_type,
    check_entry,
    check_header,
    fmt_hours,
    fmt_time,
    intended_date,
    make_issue,
)

TRADE_GROUPS = (
    "Barbender", "Carpenter", "Mason", "Helper", "Rigger", "Cook", "Cook Helper", "Supervisor",
)  # fmt: skip
TRADE_SPELLINGS = {"masan": "Mason", "superviser": "Supervisor"}

SEVERITY_ORDER = {"BLOCK": 0, "WARN": 1, "INFO": 2}


class HealthStats(BaseModel):
    workers: int
    entries: int
    complete_entries: int
    workers_with_entries: int
    sheets_with_entries: int
    effective_hours: float
    overnight_shifts: int  # Out > 24
    by_rule: dict[str, int]
    by_severity: dict[str, int]


class HealthReport(BaseModel):
    source: SnapshotMeta
    month: str
    holidays: list[dt.date]
    generated_at: dt.datetime
    stats: HealthStats
    issues: list[Issue]


# --- Helpers ---------------------------------------------------------------------------------


def _name_key(value) -> str:
    return re.sub(r"\s+", " ", cell_text(value)).strip().casefold()


def _id_key(value) -> str | None:
    return None if is_blank(value) else normalise_code(value)


def _rows(rows: Iterable[int], col: str = "") -> str:
    """[214, 215, 216, 250] -> 'rows 214-216, 250'."""
    rows = sorted(rows)
    parts, start = [], None
    for i, r in enumerate(rows):
        if start is None:
            start = r
        if i + 1 == len(rows) or rows[i + 1] != r + 1:
            parts.append(f"{col}{start}" if start == r else f"{col}{start}-{col}{r}")
            start = None
    return ("cells " if col else "rows ") + ", ".join(parts)


class _Context:
    def __init__(self, snapshot: WorkbookSnapshot, month_start: dt.date, template: TemplateConfig):
        self.snapshot = snapshot
        self.month_start = month_start
        self.t = template
        self.master_sheet = template.master_sheet
        self.by_row = {w.row: w for w in snapshot.master.workers}
        self.computed: dict[tuple[str, int], Computed] = {}
        for day in snapshot.days:
            for e in day.entries:
                c = rules.compute_entry(e, day.header.day_type)
                if c is not None:
                    self.computed[(e.sheet, e.block)] = c

    def worker(self, entry: Entry) -> Worker | None:
        return self.by_row.get(self.t.master_row_for_block(entry.block))

    def master_issue(self, rule: str, message: str, col: str, row: int, **kw) -> Issue:
        cell = f"{getattr(self.t.master_cols, col)}{row}"
        return make_issue(rule, message, sheet=self.master_sheet, cell=cell, **kw)


# --- Master data -----------------------------------------------------------------------------


def check_calling_names(ctx: _Context) -> list[Issue]:
    """M01: format, stray spaces, duplicates."""
    issues = []
    seen: dict[str, list[Worker]] = defaultdict(list)
    for w in ctx.snapshot.master.workers:
        name = w.calling_name
        seen[normalise_code(name)].append(w)
        if name != name.strip() or "  " in name:
            issues.append(
                ctx.master_issue(
                    "M01",
                    f"Calling name {name!r} has stray spaces.",
                    "calling_name",
                    w.row,
                    calling_name=name,
                    suggestion=f"Use {' '.join(name.split())!r}.",
                )
            )
        elif parse_calling_name(name) is None:
            issues.append(
                ctx.master_issue(
                    "M01",
                    f"Calling name {name!r} does not follow the INX-00 [ROLE] format.",
                    "calling_name",
                    w.row,
                    calling_name=name,
                )
            )
    for group in seen.values():
        if len(group) > 1:
            names = ", ".join(f"{w.calling_name!r} (row {w.row})" for w in group)
            issues.append(
                ctx.master_issue(
                    "M01",
                    f"Duplicate calling names: {names}.",
                    "calling_name",
                    group[1].row,
                    calling_name=group[0].calling_name,
                )
            )
    return issues


def check_employee_codes(ctx: _Context) -> list[Issue]:
    """M02: blank / #N/A / 0 / malformed codes, and one code on different IDs."""
    issues = []
    reason = {
        EmployeeCodeStatus.MISSING: "is blank",
        EmployeeCodeStatus.ERROR: "shows {value} (broken lookup formula)",
        EmployeeCodeStatus.ZERO: "is 0",
        EmployeeCodeStatus.INVALID: "is {value!r}, not X##### or XIN###",
    }
    by_code: dict[str, list[Worker]] = defaultdict(list)
    for w in ctx.snapshot.master.workers:
        status = employee_code_status(w.employee_code)
        if status == EmployeeCodeStatus.VALID:
            by_code[w.employee_code].append(w)
            continue
        text = reason[status].format(value=cell_text(w.employee_code))
        issues.append(
            ctx.master_issue(
                "M02",
                f"Employee code {text}.",
                "employee_code",
                w.row,
                calling_name=w.calling_name,
                suggestion="Look the code up in the registration file (Phase 4 proposes it).",
            )
        )
    for code, group in by_code.items():
        if len({_id_key(w.id_no) for w in group}) > 1:
            names = ", ".join(w.calling_name for w in group)
            issues.append(
                ctx.master_issue(
                    "M02",
                    f"Employee code {code} is used by {names}, which have different IDs.",
                    "employee_code",
                    group[0].row,
                    calling_name=group[0].calling_name,
                )
            )
    return issues


def check_identities(ctx: _Context) -> list[Issue]:
    """M03: one ID under different names; one person (same ID and name) with two codes."""
    issues = []
    by_id: dict[str, list[Worker]] = defaultdict(list)
    for w in ctx.snapshot.master.workers:
        if (key := _id_key(w.id_no)) is not None:
            by_id[key].append(w)
    for group in by_id.values():
        if len(group) < 2:
            continue
        names = ", ".join(f"{w.calling_name} (row {w.row})" for w in group)
        first = group[0]
        if len({_name_key(w.name) for w in group}) > 1:
            issues.append(
                ctx.master_issue(
                    "M03",
                    f"Same ID number on {names}, but the names differ.",
                    "id",
                    first.row,
                    calling_name=first.calling_name,
                    suggestion="Check the passport/NIC numbers against the registration.",
                )
            )
        elif len({cell_text(w.employee_code) for w in group}) > 1:
            codes = ", ".join(f"{w.calling_name} = {cell_text(w.employee_code)}" for w in group)
            issues.append(
                ctx.master_issue(
                    "M03",
                    f"Same person (same ID and name) has two employee codes: {codes}.",
                    "employee_code",
                    first.row,
                    calling_name=first.calling_name,
                    suggestion="Ask the office which ERP code is right.",
                )
            )
    return issues


def check_trade_groups(ctx: _Context) -> list[Issue]:
    """M04: trade group not in the allowed set; one issue per spelling."""
    allowed = {t.casefold(): t for t in TRADE_GROUPS}
    bad: dict[str, list[Worker]] = defaultdict(list)
    for w in ctx.snapshot.master.workers:
        text = cell_text(w.trade_group).strip()
        if allowed.get(text.casefold()) != cell_text(w.trade_group):
            bad[cell_text(w.trade_group)].append(w)
    issues = []
    for spelling, group in bad.items():
        fix = TRADE_SPELLINGS.get(spelling.strip().casefold()) or allowed.get(
            spelling.strip().casefold()
        )
        col = ctx.t.master_cols.trade_group
        issues.append(
            ctx.master_issue(
                "M04",
                f"Trade group {spelling!r} on {len(group)} row(s): "
                f"{_rows([w.row for w in group], col)}.",
                "trade_group",
                group[0].row,
                suggestion=f"Use {fix!r}." if fix else f"Use one of: {', '.join(TRADE_GROUPS)}.",
            )
        )
    return issues


def check_activity_list(ctx: _Context) -> list[Issue]:
    """M05: duplicate codes and stray spaces in the activity list."""
    col = re.match(r"[A-Z]+", ctx.t.activity_list).group()
    issues = []
    rows: dict[str, list[int]] = defaultdict(list)
    for a in ctx.snapshot.master.activities:
        rows[a.code].append(a.row)
        if a.raw != a.code:
            issues.append(
                make_issue(
                    "M05",
                    f"Activity {a.raw!r} has stray spaces.",
                    sheet=ctx.master_sheet,
                    cell=f"{col}{a.row}",
                    suggestion=f"Use {a.code!r}.",
                )
            )
    for code, found in rows.items():
        if len(found) > 1:
            issues.append(
                make_issue(
                    "M05",
                    f"Activity {code!r} is listed {len(found)} times ({_rows(found, col)}).",
                    sheet=ctx.master_sheet,
                    cell=f"{col}{found[1]}",
                    suggestion="Remove the duplicate rows.",
                )
            )
    return issues


# --- Headers and entries ---------------------------------------------------------------------


def _header_impact(ctx: _Context, day: DaySheet, issue: Issue, holidays) -> Issue:
    """Add what a wrong date/day type does to the sheet's entries (Appendix B)."""
    done = [
        ctx.computed[(e.sheet, e.block)] for e in day.entries if (e.sheet, e.block) in ctx.computed
    ]
    if not done:
        return issue
    effective = sum(c.effective for c in done)
    text = f" {len(done)} worker-days, {fmt_hours(effective)} h effective."
    if issue.rule == "H02":
        want = calendar_day_type(intended_date(day.header.sheet, ctx.month_start), holidays)
        ot_now = sum(c.ot or 0 for c in done)
        ot_want = sum(o for c in done if (o := rules.ot_hours(c.effective, want) or 0) > 0)
        text += f" OT is {fmt_hours(ot_now)} h now; the {want} rule gives {fmt_hours(ot_want)} h."
    return issue.model_copy(update={"message": issue.message + text})


def check_rest(ctx: _Context) -> list[Issue]:
    """W02: rest between a shift and the same worker's shift on the next day sheet."""
    shifts: dict[str, dict[int, Entry]] = defaultdict(dict)
    for day in ctx.snapshot.days:
        if not day.header.sheet.isdigit():
            continue
        for e in day.entries:
            if e.is_complete and e.calling_name:
                shifts[e.calling_name][int(day.header.sheet)] = e
    issues = []
    for name, days in shifts.items():
        for n, e in sorted(days.items()):
            nxt = days.get(n + 1)
            if nxt is None:
                continue
            rest = as_number(nxt.time_in) + 24 - as_number(e.time_out)
            if rest < MIN_REST - rules.EPS:
                issues.append(
                    make_issue(
                        "W02",
                        f"Out {fmt_time(as_number(e.time_out))} on day {n}, in again "
                        f"{fmt_time(as_number(nxt.time_in))} on day {n + 1}: "
                        f"{fmt_hours(rest)} h rest.",
                        sheet=e.sheet,
                        cell=f"{ctx.t.cols.time_out}{e.row}",
                        calling_name=name,
                    )
                )
    return issues


def _identities(w: Worker | None, calling_name: str) -> set[tuple[str, str]]:
    keys = {("person", person_key(calling_name))}
    if w is not None:
        if employee_code_status(w.employee_code) == EmployeeCodeStatus.VALID:
            keys.add(("code", w.employee_code))
        if (key := _id_key(w.id_no)) is not None:
            keys.add(("id", key))
    return keys


def check_double_bookings(ctx: _Context) -> list[Issue]:
    """W03: one person (base/role code, employee code or ID) with overlapping times on a sheet."""
    issues = []
    for day in ctx.snapshot.days:
        done = [e for e in day.entries if e.is_complete and e.calling_name]
        owner: dict[tuple[str, str], list[Entry]] = defaultdict(list)
        for e in done:
            for key in _identities(ctx.worker(e), e.calling_name):
                owner[key].append(e)
        pairs: dict[tuple[int, int], set[str]] = defaultdict(set)
        for (kind, _), group in owner.items():
            for i, a in enumerate(group):
                for b in group[i + 1 :]:
                    pairs[(a.block, b.block)].add(kind)
        by_block = {e.block: e for e in done}
        for (ba, bb), kinds in sorted(pairs.items()):
            a, b = by_block[ba], by_block[bb]
            a_in, a_out = as_number(a.time_in), as_number(a.time_out)
            b_in, b_out = as_number(b.time_in), as_number(b.time_out)
            if not (a_in < b_out and b_in < a_out):
                continue
            how = {"person": "same base code", "code": "same employee code", "id": "same ID"}
            issues.append(
                make_issue(
                    "W03",
                    f"{a.calling_name} {fmt_time(a_in)}-{fmt_time(a_out)} and {b.calling_name} "
                    f"{fmt_time(b_in)}-{fmt_time(b_out)} overlap "
                    f"({', '.join(v for k, v in how.items() if k in kinds)}).",
                    sheet=day.header.sheet,
                    cell=f"{ctx.t.cols.time_in}{b.row}",
                    calling_name=b.calling_name,
                )
            )
    return issues


def check_upload_employee(ctx: _Context) -> list[Issue]:
    """W07: per worker, the upload lines that go out with a blank or 0 employee code."""
    lines: Counter[int] = Counter()
    days: Counter[int] = Counter()
    for day in ctx.snapshot.days:
        for e in day.entries:
            c = ctx.computed.get((e.sheet, e.block))
            w = ctx.worker(e)
            if c is None or w is None:
                continue
            if employee_code_status(w.employee_code) != EmployeeCodeStatus.VALID:
                lines[w.row] += rules.upload_line_count(e, c)
                days[w.row] += 1
    issues = []
    for row, n in sorted(lines.items()):
        w = ctx.by_row[row]
        shown = "0" if employee_code_status(w.employee_code) == EmployeeCodeStatus.ZERO else "blank"
        issues.append(
            ctx.master_issue(
                "W07",
                f"{n} upload lines on {days[row]} day(s) go to the ERP with employee {shown}.",
                "employee_code",
                row,
                calling_name=w.calling_name,
                suggestion="Fix the employee code in Labour Detail (M02).",
            )
        )
    return issues


# --- Run --------------------------------------------------------------------------------------


def run_health(
    snapshot: WorkbookSnapshot,
    month_start: dt.date,
    holidays: Iterable[dt.date] = (),
    template: TemplateConfig | None = None,
    now: dt.datetime | None = None,
) -> HealthReport:
    t = template or TemplateConfig()
    holidays = sorted(set(holidays))
    ctx = _Context(snapshot, month_start, t)
    codes = {a.code for a in snapshot.master.activities}

    issues: list[Issue] = []
    for check in (
        check_calling_names,
        check_employee_codes,
        check_identities,
        check_trade_groups,
        check_activity_list,
    ):
        issues += check(ctx)
    for day in snapshot.days:
        for issue in check_header(day.header, month_start, holidays, t):
            if issue.rule in ("H01", "H02"):
                issue = _header_impact(ctx, day, issue, holidays)
            issues.append(issue)
        for e in day.entries:
            issues += check_entry(e, day.header.day_type, codes, t)
    issues += check_rest(ctx)
    issues += check_double_bookings(ctx)
    issues += check_upload_employee(ctx)

    issues.sort(key=lambda i: (SEVERITY_ORDER[i.severity], i.rule))  # stable: keeps sheet order
    entries = [e for d in snapshot.days for e in d.entries]
    done = list(ctx.computed.items())
    stats = HealthStats(
        workers=len(snapshot.master.workers),
        entries=len(entries),
        complete_entries=len(done),
        workers_with_entries=len({e.calling_name for e in entries}),
        sheets_with_entries=len({e.sheet for e in entries}),
        effective_hours=sum(c.effective for _, c in done),
        overnight_shifts=sum(1 for e in entries if e.is_complete and as_number(e.time_out) > 24),
        by_rule=dict(sorted(Counter(i.rule for i in issues).items())),
        by_severity={s: n for s in SEVERITY_ORDER if (n := sum(i.severity == s for i in issues))},
    )
    return HealthReport(
        source=snapshot.meta,
        month=f"{month_start:%Y-%m}",
        holidays=holidays,
        generated_at=now or dt.datetime.now(dt.UTC),
        stats=stats,
        issues=issues,
    )


def rule_title(rule: str) -> str:
    return RULES[rule].title if rule in RULES else rule
