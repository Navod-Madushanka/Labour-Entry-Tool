"""SQLite audit log: one row per batch, one row per changed cell with its old and new value.

A batch is recorded as ``pending`` *before* Excel is touched, so the old values survive a crash or
a write that fails half way; undo works from these rows. It stores calling names, cells and values,
never names or ID numbers (PLAN.md §10).
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
import threading
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from app.domain.models import CellValue

BatchKind = Literal["write", "undo"]
BatchStatus = Literal["pending", "done", "failed"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS batches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    user       TEXT NOT NULL,
    workbook   TEXT NOT NULL,
    kind       TEXT NOT NULL,
    status     TEXT NOT NULL,
    undo_of    INTEGER REFERENCES batches(id),
    undone_by  INTEGER REFERENCES batches(id),
    note       TEXT
);
CREATE TABLE IF NOT EXISTS changes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id     INTEGER NOT NULL REFERENCES batches(id),
    sheet        TEXT NOT NULL,
    cell         TEXT NOT NULL,
    calling_name TEXT,
    old          TEXT,
    new          TEXT
);
CREATE INDEX IF NOT EXISTS changes_batch ON changes(batch_id);
"""


class Change(BaseModel):
    sheet: str
    cell: str
    calling_name: str | None = None
    old: CellValue = None
    new: CellValue = None


class Batch(BaseModel):
    id: int
    created_at: dt.datetime
    user: str
    workbook: str
    kind: BatchKind
    status: BatchStatus
    undo_of: int | None = None
    undone_by: int | None = None
    note: str | None = None
    cells: int = 0
    calling_names: list[str] = []
    sheets: list[str] = []


class AuditStore:
    def __init__(self, path: str | Path = ":memory:"):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._db:
            self._db.executescript(SCHEMA)

    def close(self) -> None:
        self._db.close()

    def start(
        self,
        kind: BatchKind,
        user: str,
        workbook: str,
        changes: list[Change],
        undo_of: int | None = None,
    ) -> int:
        now = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        with self._lock, self._db:
            cur = self._db.execute(
                "INSERT INTO batches (created_at, user, workbook, kind, status, undo_of)"
                " VALUES (?, ?, ?, ?, 'pending', ?)",
                (now, user, workbook, kind, undo_of),
            )
            batch_id = cur.lastrowid
            self._db.executemany(
                "INSERT INTO changes (batch_id, sheet, cell, calling_name, old, new)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                [(batch_id, c.sheet, c.cell, c.calling_name, json.dumps(c.old), json.dumps(c.new))
                 for c in changes],
            )  # fmt: skip
        return batch_id

    def finish(self, batch_id: int, status: BatchStatus, note: str | None = None) -> None:
        with self._lock, self._db:
            self._db.execute(
                "UPDATE batches SET status = ?, note = ? WHERE id = ?", (status, note, batch_id)
            )
            if status == "done":
                self._db.execute(
                    "UPDATE batches SET undone_by = ? WHERE id ="
                    " (SELECT undo_of FROM batches WHERE id = ?)",
                    (batch_id, batch_id),
                )

    def batch(self, batch_id: int) -> Batch | None:
        rows = self._batches("WHERE b.id = ?", "", (batch_id,))
        return rows[0] if rows else None

    def recent(self, limit: int = 20) -> list[Batch]:
        return self._batches("", "ORDER BY b.id DESC LIMIT ?", (limit,))

    def changes(self, batch_id: int) -> list[Change]:
        with self._lock:
            rows = self._db.execute(
                "SELECT sheet, cell, calling_name, old, new FROM changes WHERE batch_id = ?"
                " ORDER BY id",
                (batch_id,),
            ).fetchall()
        return [
            Change(sheet=r["sheet"], cell=r["cell"], calling_name=r["calling_name"],
                   old=json.loads(r["old"]), new=json.loads(r["new"]))
            for r in rows
        ]  # fmt: skip

    def _batches(self, where: str, tail: str, params: tuple) -> list[Batch]:
        with self._lock:
            rows = self._db.execute(
                "SELECT b.*, COUNT(c.id) AS cells,"
                " GROUP_CONCAT(DISTINCT c.calling_name) AS names,"
                " GROUP_CONCAT(DISTINCT c.sheet) AS sheets"
                f" FROM batches b LEFT JOIN changes c ON c.batch_id = b.id {where}"
                f" GROUP BY b.id {tail}",
                params,
            ).fetchall()
        return [
            Batch(
                id=r["id"], created_at=r["created_at"], user=r["user"], workbook=r["workbook"],
                kind=r["kind"], status=r["status"], undo_of=r["undo_of"],
                undone_by=r["undone_by"], note=r["note"], cells=r["cells"],
                calling_names=sorted(filter(None, (r["names"] or "").split(","))),
                sheets=sorted(filter(None, (r["sheets"] or "").split(",")), key=_sheet_key),
            )
            for r in rows
        ]  # fmt: skip


def _sheet_key(sheet: str) -> tuple[int, str]:
    return (int(sheet), "") if sheet.isdigit() else (10**6, sheet)
