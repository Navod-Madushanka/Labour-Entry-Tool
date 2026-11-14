"""Month history (roadmap #9): each month's entries kept in ``history.db`` in the data folder, so
trends, the site's own productivity norms and runs across the month end can be worked out.

A month is read from a workbook file with pyxlsb (Excel is not used) or from a practice snapshot,
and stored entry by entry: calling names, times, hours, codes, trade and business partner. Never
names or ID numbers. Saving the same kind of workbook for the same month again replaces it.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
import threading
from pathlib import Path

from pydantic import BaseModel

from app.audit.store import optimize, tune

from app.domain.codes import cell_text, person_key, trade_from_name
from app.domain.models import WorkbookSnapshot, as_number
from app.domain.rules import canonical_day_type, compute_entry

SCHEMA = """
CREATE TABLE IF NOT EXISTS months (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    kind      TEXT NOT NULL,   -- kind of workbook (name without month and year)
    month     TEXT NOT NULL,   -- YYYY-MM
    source    TEXT NOT NULL,   -- file it was read from
    saved_at  TEXT NOT NULL,
    UNIQUE (kind, month)
);
CREATE TABLE IF NOT EXISTS rows (
    month_id     INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
    sheet        TEXT NOT NULL,
    day          INTEGER NOT NULL,
    date         TEXT,
    day_type     TEXT,
    calling_name TEXT NOT NULL,
    person       TEXT NOT NULL,
    trade        TEXT,
    bp           TEXT,
    supervisor   TEXT,
    time_in      REAL,
    time_out     REAL,
    worked       REAL NOT NULL,
    ot           REAL NOT NULL,
    zidle        REAL NOT NULL,
    lines        TEXT NOT NULL   -- JSON [[code, hours], ...]
);
CREATE INDEX IF NOT EXISTS rows_month ON rows(month_id);
CREATE TABLE IF NOT EXISTS quantities (
    month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
    code     TEXT NOT NULL,
    week     TEXT NOT NULL,
    qty      REAL NOT NULL,
    unit     TEXT
);
-- re-saving a month deletes the old one: without this, every quantity of every month is scanned
CREATE INDEX IF NOT EXISTS quantities_month ON quantities(month_id);
"""


class MonthInfo(BaseModel):
    id: int
    kind: str
    month: str
    source: str
    saved_at: str
    entries: int
    workers: int
    hours: float
    ot: float


class HistoryRow(BaseModel):
    month_id: int
    sheet: str
    day: int
    date: str | None
    day_type: str | None
    calling_name: str
    person: str
    trade: str | None
    bp: str | None
    supervisor: str | None
    time_in: float | None
    time_out: float | None
    worked: float
    ot: float
    zidle: float
    lines: list[tuple[str, float | None]]


class HistoryQuantity(BaseModel):
    month_id: int
    code: str
    week: str
    qty: float
    unit: str | None = None


def month_rows(
    snapshot: WorkbookSnapshot,
    trade_letters: dict[str, str],
    owners: dict[tuple[str, str], str] | None = None,
) -> list[dict]:
    """One row per worker-day with worked hours: what Excel computes, without personal data."""
    workers = {w.calling_name: w for w in snapshot.master.workers}
    out = []
    for d in snapshot.days:
        day_type = canonical_day_type(d.header.day_type)
        try:
            day = int(d.header.sheet)
        except ValueError:
            continue
        for e in d.entries:
            name = cell_text(e.calling_name).strip()
            c = compute_entry(e, day_type)
            if not name or c is None or c.effective <= 0:
                continue
            w = workers.get(name)
            trade = trade_from_name(name, trade_letters) or (
                cell_text(w.trade_group).strip() if w else ""
            )
            lines = [
                (cell_text(a.code).strip(), as_number(a.hours))
                for a in e.activities
                if cell_text(a.code).strip()
            ]  # fmt: skip
            out.append({
                "sheet": d.header.sheet, "day": day,
                "date": d.header.date.isoformat() if d.header.date else None,
                "day_type": day_type, "calling_name": name, "person": person_key(name),
                "trade": trade or None, "bp": (cell_text(w.bp).strip() or None) if w else None,
                "supervisor": (owners or {}).get((d.header.sheet, name)),
                "time_in": as_number(e.time_in), "time_out": as_number(e.time_out),
                "worked": c.effective, "ot": max(c.ot_raw or 0.0, 0.0),
                "zidle": max(c.zidle or 0.0, 0.0), "lines": json.dumps(lines),
            })  # fmt: skip
    return out


class History:
    """``history.db``; in memory when ``path`` is None (tests)."""

    def __init__(self, path: Path | None):
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path) if path else ":memory:", check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        tune(self._db)
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.executescript(SCHEMA)
        optimize(self._db, first=True)
        self._lock = threading.Lock()

    def save(self, kind: str, month: str, source: str, rows: list[dict],
             quantities: dict[str, dict[str, float]] | None = None,
             units: dict[str, str] | None = None) -> MonthInfo:  # fmt: skip
        """Store a month (replacing an earlier save of the same kind and month)."""
        now = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        with self._lock, self._db:
            self._db.execute("DELETE FROM months WHERE kind = ? AND month = ?", (kind, month))
            cur = self._db.execute(
                "INSERT INTO months (kind, month, source, saved_at) VALUES (?, ?, ?, ?)",
                (kind, month, source, now),
            )
            mid = cur.lastrowid
            self._db.executemany(
                "INSERT INTO rows (month_id, sheet, day, date, day_type, calling_name, person,"
                " trade, bp, supervisor, time_in, time_out, worked, ot, zidle, lines) VALUES"
                " (:m, :sheet, :day, :date, :day_type, :calling_name, :person, :trade, :bp,"
                " :supervisor, :time_in, :time_out, :worked, :ot, :zidle, :lines)",
                [{**r, "m": mid} for r in rows],
            )
            self._db.executemany(
                "INSERT INTO quantities (month_id, code, week, qty, unit) VALUES (?, ?, ?, ?, ?)",
                [
                    (mid, code, week, q, (units or {}).get(code))
                    for code, weeks in (quantities or {}).items()
                    for week, q in weeks.items()
                    if q
                ],
            )
        return next(m for m in self.months() if m.id == mid)

    def months(self) -> list[MonthInfo]:
        with self._lock:
            rows = self._db.execute(
                "SELECT m.*, COUNT(r.month_id) AS entries, COUNT(DISTINCT r.person) AS workers,"
                " COALESCE(SUM(r.worked), 0) AS hours, COALESCE(SUM(r.ot), 0) AS ot"
                " FROM months m LEFT JOIN rows r ON r.month_id = m.id"
                " GROUP BY m.id ORDER BY m.month, m.kind"
            ).fetchall()
        return [MonthInfo(**dict(r)) for r in rows]

    def rows(self, ids: list[int]) -> list[HistoryRow]:
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        with self._lock:
            got = self._db.execute(
                f"SELECT * FROM rows WHERE month_id IN ({marks}) ORDER BY month_id, day",
                ids,
            ).fetchall()
        return [HistoryRow(**{**dict(r), "lines": json.loads(r["lines"])}) for r in got]

    def quantities(self, ids: list[int]) -> list[HistoryQuantity]:
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        with self._lock:
            got = self._db.execute(
                f"SELECT * FROM quantities WHERE month_id IN ({marks})",
                ids,
            ).fetchall()
        return [HistoryQuantity(**dict(r)) for r in got]

    def delete(self, month_id: int) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM months WHERE id = ?", (month_id,))

    def trailing_runs(self, kind: str, month: str) -> dict[str, int]:
        """For the month before ``month`` of this kind: each person's days in a row up to that
        month's last day with work (site days: a day nobody worked breaks no one's run)."""
        first = dt.date.fromisoformat(f"{month}-01")
        prev = (first - dt.timedelta(days=1)).strftime("%Y-%m")
        with self._lock:
            m = self._db.execute(
                "SELECT id FROM months WHERE kind = ? AND month = ?", (kind, prev)
            ).fetchone()
            if not m:
                return {}
            got = self._db.execute(
                "SELECT DISTINCT day, person FROM rows WHERE month_id = ?", (m["id"],)
            ).fetchall()
        days = sorted({r["day"] for r in got})
        worked: dict[str, set[int]] = {}
        for r in got:
            worked.setdefault(r["person"], set()).add(r["day"])
        out = {}
        for person, ds in worked.items():
            n = 0
            for d in reversed(days):
                if d not in ds:
                    break
                n += 1
            if n:
                out[person] = n
        return out
