"""Printing time cards: write each calling name into the time card sheet's Calling Name cell, let
Excel fill the card from it, and print the sheet with the page setup and printer set in Excel.

The helpers here are pure (unit-tested on Linux); the Excel side is in ``xlwings_adapter``.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from app.excel.refs import index_to_col

LABEL = "calling name"


def time_card_sheets(names: Sequence[str]) -> list[str]:
    return [n for n in names if "time card" in n.casefold()]


def find_input_cell(
    values: Sequence[Sequence[object]], formulas: Sequence[Sequence[object]]
) -> str | None:
    """The cell where the calling name is typed: right of the "Calling Name" label, not a formula,
    and (when several qualify) the one the card's formulas refer to most. ``values`` and
    ``formulas`` are the same block from A1, row by row."""
    text = lambda v: str(v or "").strip()  # noqa: E731
    is_formula = lambda f: isinstance(f, str) and f.startswith("=")  # noqa: E731
    all_formulas = " ".join(str(f) for fr in formulas for f in fr if is_formula(f)).upper()

    def refs(cell: str) -> int:
        col, row_n = re.match(r"([A-Z]+)(\d+)", cell).groups()
        return len(re.findall(rf"(?<![A-Z$])\$?{col}\$?{row_n}(?!\d)", all_formulas))

    for r, row in enumerate(values):
        labels = [c for c, v in enumerate(row) if text(v).casefold().rstrip(":") == LABEL]
        if not labels:
            continue
        candidates = []
        for c in range(labels[-1] + 1, len(row)):
            f = formulas[r][c] if r < len(formulas) and c < len(formulas[r]) else None
            if is_formula(f) or text(row[c]).casefold().rstrip(":") == LABEL:
                continue
            candidates.append(f"{index_to_col(c + 1)}{r + 1}")
            if len(candidates) == 4:
                break
        if not candidates:
            return None
        best = max(candidates, key=lambda cell: (refs(cell), -candidates.index(cell)))
        if refs(best) == 0:  # no formula refers to any: the one holding a value, else the first
            held = [c for c in candidates if text(values[r][_col(c)])]
            best = held[0] if held else candidates[0]
        return best
    return None


def _col(cell: str) -> int:
    letters = re.match(r"[A-Z]+", cell).group()
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1
