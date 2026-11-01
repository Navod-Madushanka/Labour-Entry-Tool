"""Suggestion log: lines are appended on this PC and summed up per rule; made-up values only."""

from __future__ import annotations

import datetime as dt

from fastapi.testclient import TestClient

from app.api import suggestlog


def test_log_and_summary(tmp_path, monkeypatch):
    monkeypatch.setenv("LABOUR_TOOL_DATA", str(tmp_path))
    from app.main import create_app

    client = TestClient(create_app())
    lines = [
        {"workbook": "B", "sheet": "3", "keys": 4, "worker_keys": 2, "ms": 4000, "lines": 1,
         "time": {"tier": "partners", "prefilled": True, "kept": True},
         "code": {"tier": "partners", "prefilled": True, "kept": True, "rank": 0}},
        {"workbook": "B", "sheet": "3", "keys": 10, "worker_keys": 3, "ms": 8000, "also": 2, "lines": 1,  # noqa: E501
         "time": {"tier": "usual", "prefilled": True, "kept": False},
         "code": {"tier": "last", "prefilled": False, "kept": False, "rank": 2}},
        {"workbook": "B", "sheet": "3", "keys": 7},
    ]  # fmt: skip
    for line in lines:
        assert client.post("/api/suggest-log", json=line).status_code == 200
    files = list((tmp_path / "logs").glob("suggestions-*.jsonl"))
    assert len(files) == 1 and len(files[0].read_text().splitlines()) == 3
    s = client.get("/api/suggest-log/summary").json()
    assert s["entries"] == 3 and s["workers"] == 5
    assert s["keys_per_entry"] == 7.0
    assert s["time"]["tiers"] == {
        "partners": {"shown": 1, "kept": 1},
        "usual": {"shown": 1, "kept": 0},
    }
    assert s["code"]["prefilled"] == 1 and s["code"]["prefill_kept"] == 1
    assert client.post("/api/suggest-log", json={"keys": -1}).status_code == 422


def test_cut_lines_and_old_months_are_skipped(tmp_path, monkeypatch):
    monkeypatch.setenv("LABOUR_TOOL_DATA", str(tmp_path))
    today = dt.date(2026, 11, 3)
    folder = tmp_path / "logs"
    folder.mkdir()
    (folder / "suggestions-2026-10.jsonl").write_text(
        '{"at": "2026-10-30T10:00:00", "keys": 5}\n{"at": "2026-10-01T10:00:00", "keys": 9}\n{"at": "2026-10-3'  # noqa: E501
    )
    (folder / "suggestions-2026-11.jsonl").write_text('{"at": "2026-11-02T08:00:00", "keys": 3}\n')
    got = suggestlog.read_lines(7, today)
    assert [r["keys"] for r in got] == [5, 3]
