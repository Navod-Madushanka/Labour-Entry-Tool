"""In-memory adapter over a ``WorkbookSnapshot`` (unit tests, sanitized JSON fixtures)."""

from __future__ import annotations

import json
from pathlib import Path

from app.domain.models import DaySheet, MasterData, WorkbookSnapshot


class FakeAdapter:
    def __init__(self, snapshot: WorkbookSnapshot):
        self._snapshot = snapshot
        self._days = {d.header.sheet: d for d in snapshot.days}

    @classmethod
    def from_json(cls, path: str | Path) -> FakeAdapter:
        return cls(load_snapshot(path))

    def read_master(self) -> MasterData:
        return self._snapshot.master.model_copy(deep=True)

    def read_day(self, sheet: str) -> DaySheet:
        try:
            return self._days[sheet].model_copy(deep=True)
        except KeyError:
            raise KeyError(f"no day sheet {sheet!r} in snapshot") from None

    def day_sheet_names(self) -> list[str]:
        return list(self._days)

    def snapshot(self) -> WorkbookSnapshot:
        return self._snapshot.model_copy(deep=True)


def save_snapshot(snapshot: WorkbookSnapshot, path: str | Path) -> Path:
    """Compact JSON (defaults left out); ``load_snapshot`` restores them."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    data = snapshot.model_dump(mode="json", exclude_defaults=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return out


def load_snapshot(path: str | Path) -> WorkbookSnapshot:
    return WorkbookSnapshot.model_validate_json(Path(path).read_text(encoding="utf-8"))
