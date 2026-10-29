"""Settings kept per kind of workbook, across months and restarts.

"Labour Entry Sheet October 2026 - SUB CONTRACT.xlsb" and next month's "... November 2026 - SUB
CONTRACT (2).xlsb" are the same kind, so a choice made once (activity codes checked or not) holds
for every month. Kept in ``workbooks.json`` in the data folder.
"""

from __future__ import annotations

import calendar
import json
import re
import threading
from pathlib import Path

MONTHS = "|".join(
    [m.lower() for m in calendar.month_name[1:]] + [m.lower() for m in calendar.month_abbr[1:]]
)


def workbook_kind(name: str) -> str:
    """The workbook's name without the month, the year, copy numbers and the extension."""
    text = Path(name).stem.lower()
    text = re.sub(rf"\b({MONTHS})\b", " ", text)
    text = re.sub(r"\b(19|20)\d\d\b", " ", text)
    text = re.sub(r"\(\d+\)|\bcopy\b", " ", text)
    text = re.sub(r"[\s_\-]+", " ", text)
    return text.strip()


def project_key(project: object, workbook: str) -> str:
    """Place names belong to the project (the INDIAN and SUB CONTRACT workbooks of one site share
    them): keyed by the sheets' Project / Activity Centre, else by the kind of workbook."""
    text = re.sub(r"\s+", " ", str(project or "")).strip().lower()
    return f"project:{text}" if text else workbook_kind(workbook)


class BookSettings:
    """``{kind: {"check_activities": bool}, "project:<name>": {"places": {...}}}``; in memory
    only when ``path`` is None."""

    def __init__(self, path: Path | None):
        self.path = path
        self._lock = threading.Lock()
        self._data: dict[str, dict] = {}
        if path is not None and path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
                self._data = loaded if isinstance(loaded, dict) else {}
            except (OSError, ValueError):
                self._data = {}  # unreadable: start again rather than refuse to start

    def get(self, name: str) -> dict:
        return self.get_key(workbook_kind(name))

    def set(self, name: str, **values) -> None:
        self.set_key(workbook_kind(name), **values)

    def get_key(self, key: str) -> dict:
        return dict(self._data.get(key, {}))

    def set_key(self, key: str, **values) -> None:
        with self._lock:
            self._data.setdefault(key, {}).update(values)
            if self.path is not None:
                try:
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    self.path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")
                except OSError:
                    pass  # kept for this session; not worth stopping the work over
