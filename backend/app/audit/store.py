"""SQLite audit log: one row per batch, one row per changed cell with its old and new value.

A batch is recorded as ``pending`` *before* Excel is touched, so the old values survive a crash or
a write that fails half way; undo works from these rows. It stores calling names, cells and
values, never names or ID numbers (PLAN.md §10).

``sheet_owners``: whose manpower sheet (which supervisor's paper) each pushed entry came from, with
the entry as pushed. An entry belongs to the supervisor of its latest push that is not undone, so
undoing a push gives the entry back to the supervisor before it.
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
CREATE TABLE IF NOT EXISTS sheet_owners (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id     INTEGER REFERENCES batches(id),  -- NULL: pushed, but Excel had it already
    created_at   TEXT NOT NULL,
    user         TEXT NOT NULL,
    workbook     TEXT NOT NULL,
    sheet        TEXT NOT NULL,
    calling_name TEXT NOT NULL,
    supervisor   TEXT NOT NULL,
    entry        TEXT NOT NULL  -- the entry as pushed (JSON)
);
CREATE INDEX IF NOT EXISTS sheet_owners_book ON sheet_owners(workbook, sheet);
CREATE TABLE IF NOT EXISTS sheet_reviews (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    user        TEXT NOT NULL,
    workbook    TEXT NOT NULL,
    sheet       TEXT NOT NULL,
    supervisor  TEXT NOT NULL,
    status      TEXT NOT NULL,  -- ok: matches the paper; problem: see note; cleared: taken back
    note        TEXT,
    fingerprint TEXT NOT NULL   -- what the sheet looked like when reviewed (changed since?)
);
CREATE INDEX IF NOT EXISTS sheet_reviews_book ON sheet_reviews(workbook);
"""


class Change(BaseModel):
    sheet: str
    cell: str
    calling_name: str | None = None
    old: CellValue = None
    new: CellValue = None


class Owned(BaseModel):
    """One worker's entry on a day sheet, and whose manpower sheet it came from."""

    id: int
    sheet: str
    calling_name: str
    supervisor: str
    created_at: dt.datetime
    user: str
    batch_id: int | None = None
    entry: dict  # as pushed (EntryInput)


class Review(BaseModel):
    """The latest review of a supervisor's sheet: checked against the paper."""

    id: int
    sheet: str
    supervisor: str
    status: Literal["ok", "problem", "cleared"]
    note: str | None = None
    user: str
    created_at: dt.datetime
    fingerprint: str
    history: int = 1  # reviews of this sheet so far


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
        self.path = Path(path) if str(path) != ":memory:" else None
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

    # --- whose manpower sheet ---

    def own(self, batch_id: int | None, user: str, workbook: str, supervisor: str,
            entries: list[tuple[str, str, dict]]) -> None:  # fmt: skip
        """``entries``: (sheet, calling name, entry as pushed) of one push."""
        now = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        with self._lock, self._db:
            self._db.executemany(
                "INSERT INTO sheet_owners (batch_id, created_at, user, workbook, sheet,"
                " calling_name, supervisor, entry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [(batch_id, now, user, workbook, sheet, name, supervisor, json.dumps(entry))
                 for sheet, name, entry in entries],
            )  # fmt: skip

    def owners(self, workbook: str) -> list[Owned]:
        """Each entry of the workbook with its supervisor: the latest push not undone."""
        with self._lock:
            rows = self._db.execute(
                "SELECT o.* FROM sheet_owners o LEFT JOIN batches b ON b.id = o.batch_id"
                " WHERE o.workbook = ? AND (o.batch_id IS NULL OR"
                " (b.status = 'done' AND b.undone_by IS NULL)) ORDER BY o.id",
                (workbook,),
            ).fetchall()
        latest: dict[tuple[str, str], Owned] = {}
        for r in rows:
            latest[(r["sheet"], r["calling_name"])] = Owned(
                id=r["id"], sheet=r["sheet"], calling_name=r["calling_name"],
                supervisor=r["supervisor"], created_at=r["created_at"], user=r["user"],
                batch_id=r["batch_id"], entry=json.loads(r["entry"]),
            )  # fmt: skip
        return list(latest.values())

    def reassign(self, workbook: str, ids: list[int], supervisor: str) -> int:
        """A wrong supervisor chosen at push: give these entries (owner rows) to another one."""
        with self._lock, self._db:
            cur = self._db.executemany(
                "UPDATE sheet_owners SET supervisor = ? WHERE id = ? AND workbook = ?",
                [(supervisor, i, workbook) for i in ids],
            )
        return cur.rowcount

    def rename_supervisor(self, old: str, new: str) -> int:
        with self._lock, self._db:
            cur = self._db.execute(
                "UPDATE sheet_owners SET supervisor = ? WHERE supervisor = ?", (new, old)
            )
            self._db.execute(
                "UPDATE sheet_reviews SET supervisor = ? WHERE supervisor = ?", (new, old)
            )
        return cur.rowcount

    def review(self, user: str, workbook: str, sheet: str, supervisor: str, status: str,
               note: str | None, fingerprint: str) -> None:  # fmt: skip
        now = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO sheet_reviews (created_at, user, workbook, sheet, supervisor, status,"
                " note, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (now, user, workbook, sheet, supervisor, status, note, fingerprint),
            )

    def reviews(self, workbook: str) -> list[Review]:
        """The latest review of each (sheet, supervisor) of the workbook."""
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM sheet_reviews WHERE workbook = ? ORDER BY id", (workbook,)
            ).fetchall()
        latest: dict[tuple[str, str], Review] = {}
        for r in rows:
            key = (r["sheet"], r["supervisor"])
            before = latest[key].history if key in latest else 0
            latest[key] = Review(
                id=r["id"], sheet=r["sheet"], supervisor=r["supervisor"], status=r["status"],
                note=r["note"], user=r["user"], created_at=r["created_at"],
                fingerprint=r["fingerprint"], history=before + 1,
            )  # fmt: skip
        return list(latest.values())

    def supervisors(self) -> list[tuple[str, str]]:
        """(name, last used) of every supervisor in the log, most recent first."""
        with self._lock:
            rows = self._db.execute(
                "SELECT supervisor, MAX(created_at) AS last, MAX(id) AS n FROM sheet_owners"
                " GROUP BY supervisor ORDER BY n DESC"
            ).fetchall()
        return [(r["supervisor"], r["last"]) for r in rows]

    def batch(self, batch_id: int) -> Batch | None:
        rows = self._batches("WHERE b.id = ?", "", (batch_id,))
        return rows[0] if rows else None

    def recent(self, limit: int = 20, workbook: str | None = None) -> list[Batch]:
        """The latest batches, of one workbook when given (the log is shared by all of them)."""
        if workbook is None:
            return self._batches("", "ORDER BY b.id DESC LIMIT ?", (limit,))
        where, tail = "WHERE b.workbook = ?", "ORDER BY b.id DESC LIMIT ?"
        return self._batches(where, tail, (workbook, limit))

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
