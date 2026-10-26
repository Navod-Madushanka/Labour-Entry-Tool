"""Turn a real workbook snapshot into one that is safe to commit (PLAN.md §9, §10).

Names, ID (passport/NIC) numbers, EPF numbers, remarks and "prepared by" are replaced with
deterministic fakes; daily rates are dropped. Calling names, employee codes, BP codes, dates,
times, hours and activity codes are kept. Equal values map to equal fakes, so checks such as
"same ID under two calling names" still work on the sanitized data. Near-misses (IDs that differ
by one character) do not survive.
"""

from __future__ import annotations

import re

from app.domain.codes import is_excel_error, normalise_code
from app.domain.models import CellValue, WorkbookSnapshot, is_blank


class Pseudonymizer:
    """Maps each distinct value (after ``key``) to ``<prefix><n>`` in order of first sight."""

    def __init__(self, prefix: str, width: int = 4, key=lambda v: str(v)):
        self.prefix = prefix
        self.width = width
        self.key = key
        self._map: dict[str, int] = {}

    def __call__(self, value: CellValue) -> CellValue:
        if is_blank(value) or is_excel_error(value):
            return value
        n = self._map.setdefault(self.key(value), len(self._map) + 1)
        if isinstance(value, int | float) and not isinstance(value, bool):
            return float(900_000_000 + n)  # keep "stored as a number"
        return f"{self.prefix}{n:0{self.width}d}"


def _name_key(value: CellValue) -> str:
    return re.sub(r"\s+", " ", str(value)).strip().casefold()


def sanitize_snapshot(snapshot: WorkbookSnapshot) -> WorkbookSnapshot:
    snap = snapshot.model_copy(deep=True)
    names = Pseudonymizer("Worker ", key=_name_key)
    ids = Pseudonymizer("ID", width=6, key=normalise_code)
    epf = Pseudonymizer("EPF", width=5, key=normalise_code)
    remarks = Pseudonymizer("remark ")
    preparers = Pseudonymizer("Preparer ", width=2, key=_name_key)

    for w in snap.master.workers:
        w.name = names(w.name)
        w.id_no = ids(w.id_no)
        w.epf = epf(w.epf)
        w.daily_rate = None
    for day in snap.days:
        day.header.prepared_by = preparers(day.header.prepared_by)
        for e in day.entries:
            e.remark = remarks(e.remark)
    snap.meta.sanitized = True
    return snap
