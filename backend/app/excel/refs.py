"""A1-style cell reference helpers. Pure Python (no COM), safe to import anywhere."""

from __future__ import annotations

import re

_CELL_RE = re.compile(r"^\$?([A-Za-z]{1,3})\$?(\d+)$")


def col_to_index(col: str) -> int:
    """'A' -> 1, 'R' -> 18, 'AA' -> 27."""
    n = 0
    for ch in col.upper():
        if not "A" <= ch <= "Z":
            raise ValueError(f"bad column letter: {col!r}")
        n = n * 26 + (ord(ch) - 64)
    return n


def index_to_col(index: int) -> str:
    """1 -> 'A', 27 -> 'AA'."""
    if index < 1:
        raise ValueError(f"bad column index: {index}")
    out = ""
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


def parse_cell(ref: str) -> tuple[int, int]:
    """'F3' -> (row 3, col 6), both 1-based."""
    m = _CELL_RE.match(ref.strip())
    if not m:
        raise ValueError(f"bad cell reference: {ref!r}")
    return int(m.group(2)), col_to_index(m.group(1))


def parse_range(ref: str) -> tuple[tuple[int, int], tuple[int, int]]:
    """'L3:L311' -> ((3, 12), (311, 12)). A single cell is a 1x1 range."""
    first, _, last = ref.partition(":")
    start = parse_cell(first)
    end = parse_cell(last) if last else start
    return start, end


def cell_ref(row: int, col: int | str) -> str:
    """(3, 6) or (3, 'F') -> 'F3'."""
    letters = col if isinstance(col, str) else index_to_col(col)
    return f"{letters.upper()}{row}"
