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


# --- A list of workers from a file ------------------------------------------------------------

LIST_TYPES = (".xlsx", ".xlsm", ".csv")
MAX_LIST_BYTES = 10 * 1024 * 1024


def _norm(value: object) -> str:
    return "".join(str(value).split()).upper()


def _rows(filename: str, data: bytes) -> list[tuple[str, list[list[object]]]]:
    """(sheet name, rows) for every sheet of an .xlsx/.xlsm, or the one table of a .csv."""
    name = filename.lower()
    if name.endswith(".csv"):
        import csv
        import io

        text = data.decode("utf-8-sig", errors="replace")
        return [("", [list(r) for r in csv.reader(io.StringIO(text))])]
    import io

    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        return [
            (ws.title, [list(r) for r in ws.iter_rows(values_only=True)]) for ws in wb.worksheets
        ]
    finally:
        wb.close()


def names_from_file(filename: str, data: bytes, known: set[str]) -> tuple[list[str], str]:
    """The calling names in a list file, in the file's order (top to bottom), and where they were
    found. The column with the most names that are in Labour Detail is used, on any sheet; its
    other filled cells (a header, a name not in Labour Detail) come back too, so they can be
    shown as not found, except a header-like first cell."""
    if not filename.lower().endswith(LIST_TYPES):
        raise ValueError("Use an Excel workbook (.xlsx) or a .csv file with the calling names.")
    wanted = {_norm(k): k for k in known}
    best: tuple[int, str, int, list[list[object]]] | None = None  # (matches, sheet, col, rows)
    for sheet, rows in _rows(filename, data):
        width = max((len(r) for r in rows), default=0)
        for col in range(width):
            hits = sum(
                1 for r in rows if col < len(r) and r[col] is not None and _norm(r[col]) in wanted
            )
            if hits and (best is None or hits > best[0]):
                best = (hits, sheet, col, rows)
    if best is None:
        raise ValueError("No calling name from Labour Detail was found in that file.")
    _, sheet, col, rows = best
    names: list[str] = []
    for i, r in enumerate(rows):
        value = r[col] if col < len(r) else None
        if value is None or not str(value).strip():
            continue
        key = _norm(value)
        if key in wanted:
            names.append(wanted[key])
        elif i == 0 or not any(ch.isdigit() for ch in key):
            continue  # a header ("Calling Name") or a note, not a worker
        else:
            names.append(str(value).strip())
    letter = chr(ord("A") + col) if col < 26 else f"column {col + 1}"
    return names, f"{sheet + ', ' if sheet else ''}column {letter}"
