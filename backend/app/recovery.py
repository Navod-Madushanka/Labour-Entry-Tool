"""Recovery from the tool's own change log (audit.sqlite), better than Excel's AutoRecover.

Every cell the tool writes is logged before Excel is touched (old and new value). So for the
workbook open now the tool can tell, entry by entry, whether what it pushed is still there:

- **present**: the cells hold what the tool last wrote;
- **lost**: they are back to what was there before the tool wrote them (a crash before a save,
  Excel's recovered copy used for a while, an older file opened): these can go back onto the
  manpower sheet, checked and pushed again;
- **changed**: someone changed them since (in Excel), or the row now belongs to another worker:
  left alone, only shown.

Pushes made while the workbook had another name for the same file ("… (AutoRecovered).xlsb",
"… (Recovered)", "[Repaired]") count as the same workbook. Undos count too (their values are what
should be there after them). Only day-sheet entries are recovered; header fixes and Labour Detail
codes are not.

Save tracking: each save from the tool records the newest batch in the file. Opened again, a
file that a later push has not reached (saved into another copy, or never saved before a crash)
says so, with how many pushes and from when to when.
"""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

from pydantic import BaseModel, Field

from app.domain.codes import name_text
from app.domain.models import CellValue, as_number, is_blank
from app.domain.writes import ActivityInput, EntryInput, header_fix_cells, same_value
from app.excel.refs import col_to_index, index_to_col, parse_cell

_MARKS = re.compile(r"\s*(\((auto ?recovered|recovered|autosaved)\)|\[repaired\])", re.I)


def family(workbook: str) -> str:
    """One name for every copy of a workbook file: "… Supply(AutoRecovered).xlsb" and
    "… Supply.xlsb" are the same workbook."""
    stem = Path(workbook or "").stem
    return re.sub(r"\s+", " ", _MARKS.sub("", stem)).strip().casefold()


class Lost(BaseModel):
    sheet: str
    calling_name: str
    pushed_at: str  # the latest push of this entry
    user: str
    batch_id: int
    what: str  # "07:00–19:00 · 03-11-00-00 8" (as pushed)
    input: EntryInput  # to put back on the manpower sheet


class Changed(BaseModel):
    sheet: str
    calling_name: str
    pushed_at: str
    why: str


class RecoveryResult(BaseModel):
    workbook: str
    pushes: int = 0  # pushes of this workbook in the change log
    entries: int = 0  # worker-days the tool has written
    present: int = 0
    lost: list[Lost] = Field(default_factory=list)
    changed: list[Changed] = Field(default_factory=list)
    other_names: list[str] = Field(default_factory=list)  # e.g. its recovered copy


class MissingPushes(BaseModel):
    """Pushes the open file has not got (save tracking)."""

    count: int
    first: str
    last: str
    saved_at: str  # the latest save to this file from the tool


def expected_cells(service) -> tuple[dict, list[str], int]:
    """{(sheet, block row): {"cells": {cell: (expected, before)}, "name", "at", "user", "batch"}},
    the other names of the workbook seen in the log, and the number of pushes."""
    t = service.template
    name = service.workbook.name
    fam = family(name)
    days = set(service.workbook.day_sheet_names())
    header = set(header_fix_cells(t).values())
    blocks: dict[tuple[str, int], dict] = {}
    others: set[str] = set()
    pushes = 0
    for bid, at, user, workbook, kind in service.audit.done_batches():
        if family(workbook) != fam:
            continue
        if workbook != name:
            others.add(workbook)
        pushes += kind == "write"
        for ch in service.audit.changes(bid):
            if ch.sheet not in days or ch.cell in header:
                continue
            row = parse_cell(ch.cell)[0]
            if row < t.first_block_row:
                continue
            r = row - (row - t.first_block_row) % t.block_size
            b = blocks.setdefault((ch.sheet, r), {"cells": {}, "name": ch.calling_name})
            before = b["cells"].get(ch.cell, (None, ch.old))[1]  # what was there first
            b["cells"][ch.cell] = (ch.new, before)
            b.update(at=at, user=user, batch=bid)
            if ch.calling_name:
                b["name"] = ch.calling_name
    return blocks, sorted(others), pushes


def input_cells(t) -> list[tuple[str, int]]:
    """(column, row offset in the block) of every input cell."""
    c = t.cols
    n = t.activity_rows[1] - t.activity_rows[0] + 1
    cells = [(c.time_in, 0), (c.time_out, 0), (c.additional, 0), (c.remarks, 0)]
    for i in range(n):
        cells += [(c.activity, i), (c.hours, i)]
    return cells


def check_sheet(service, sheet: str, blocks: dict) -> tuple[list[Lost], list[Changed], int]:
    """Compare one day sheet's blocks with what the tool last wrote: one read of the sheet."""
    t = service.template
    c = t.cols
    rows = sorted(r for (s, r) in blocks if s == sheet)
    if not rows:
        return [], [], 0
    last_col = max(col_to_index(x) for x in (c.calling_name, c.time_in, c.time_out, c.activity,
                                              c.hours, c.additional, c.remarks))  # fmt: skip
    first, last = rows[0], rows[-1] + t.block_size - 1
    grid = service.workbook.read_range(sheet, f"A{first}:{index_to_col(last_col)}{last}")

    def now(col: str, row: int) -> CellValue:
        line = grid[row - first] if 0 <= row - first < len(grid) else []
        i = col_to_index(col) - 1
        return line[i] if i < len(line) else None

    lost, changed, present = [], [], 0
    for r in rows:
        b = blocks[(sheet, r)]
        name = b["name"] or ""
        here = name_text(now(c.calling_name, r))
        if name and here and here.strip().casefold() != name.strip().casefold():
            changed.append(Changed(sheet=sheet, calling_name=name, pushed_at=b["at"],
                                   why=f"the row is now {here}'s"))  # fmt: skip
            continue
        diffs = []
        for cell, (want, before) in b["cells"].items():
            col = re.match(r"[A-Z]+", cell).group(0)
            have = now(col, parse_cell(cell)[0])
            if not same_value(have, want):
                diffs.append((have, before))
        if not diffs:
            present += 1
        elif all(same_value(have, before) for have, before in diffs):
            entry = rebuild(service, sheet, r, name, b, now)
            lost.append(Lost(sheet=sheet, calling_name=name, pushed_at=b["at"], user=b["user"],
                             batch_id=b["batch"], what=describe(entry), input=entry))  # fmt: skip
        else:
            changed.append(Changed(sheet=sheet, calling_name=name, pushed_at=b["at"],
                                   why="changed in Excel since the push"))  # fmt: skip
    return lost, changed, present


def rebuild(service, sheet: str, r: int, name: str, b: dict, now) -> EntryInput:
    """The entry as the tool last wrote it: its cells over what is in the block now."""
    t = service.template
    c = t.cols

    def val(col: str, off: int) -> CellValue:
        cell = f"{col}{r + off}"
        return b["cells"][cell][0] if cell in b["cells"] else now(col, r + off)

    text = lambda v: (str(v).strip() or None) if not is_blank(v) else None  # noqa: E731
    acts = []
    for off in range(t.activity_rows[1] - t.activity_rows[0] + 1):
        code, hours = val(c.activity, off), val(c.hours, off)
        if not is_blank(code) or not is_blank(hours):
            acts.append(ActivityInput(code=text(code), hours=as_number(hours)))
    has_input = any(not is_blank(now(col, r + off)) for col, off in input_cells(t))
    return EntryInput(sheet=sheet, calling_name=name, time_in=as_number(val(c.time_in, 0)),
                      time_out=as_number(val(c.time_out, 0)),
                      additional=as_number(val(c.additional, 0)), remark=text(val(c.remarks, 0)),
                      activities=acts, overwrite=has_input)  # fmt: skip


def describe(e: EntryInput) -> str:
    def clock(h: float | None) -> str:
        if h is None:
            return "–"
        h = h % 24
        return f"{int(h):02d}:{round((h % 1) * 60):02d}"

    if e.is_clear:
        return "cleared"
    parts = [f"{clock(e.time_in)}–{clock(e.time_out)}"]
    parts += [f"{a.code or '(no code)'} {a.hours if a.hours is not None else ''}".strip()
              for a in e.activities]  # fmt: skip
    return " · ".join(parts)


def missing_pushes(service, path: str | None, since: str) -> MissingPushes | None:
    """Save tracking: pushes of this workbook (any copy of it) newer than the latest save to
    this file and made before this session, i.e. not in the file just opened."""
    if not path:
        return None
    saved = service.audit.last_save(path)
    if saved is None:
        return None
    when, last_batch = saved
    fam = family(service.workbook.name)
    after = [
        (bid, at)
        for bid, at, _u, workbook, kind in service.audit.done_batches()
        if kind == "write" and family(workbook) == fam and bid > (last_batch or 0) and at < since
    ]
    if not after:
        return None
    return MissingPushes(count=len(after), first=after[0][1], last=after[-1][1], saved_at=when)


def group_by_sheet(blocks: dict) -> dict[str, dict]:
    out: dict[str, dict] = defaultdict(dict)
    for (sheet, r), b in blocks.items():
        out[sheet][(sheet, r)] = b
    return dict(out)
