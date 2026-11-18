"""Analysis over several open workbooks: each one's master, days and owners, read-only."""

from fastapi.testclient import TestClient

from app.api import setup as setup_api
from app.config import Config
from app.excel.fake_adapter import save_snapshot
from app.main import create_app


def test_two_open_workbooks_come_back_together(tmp_path, small_snapshot):
    cfg = Config(month="2026-10", backups={"dir": tmp_path / "b"}, settings_file=tmp_path / "w.json")
    a = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026 - A.json")
    b = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026 - B.json")
    app = create_app(cfg)
    setup_api.choose(app, a, a.name, practice=True, real_file=False)
    setup_api.choose(app, b, b.name, practice=True, real_file=False)
    with TestClient(app) as c:
        res = c.get("/api/combined", params=[("name", a.name), ("name", b.name), ("name", "nope.xlsb")]).json()
        assert [x["workbook"] for x in res["books"]] == [a.name, b.name]
        one = res["books"][0]
        assert one["master"]["workers"] and set(one["days"]) == set(one["master"]["sheets"])
        assert "cached" not in next(iter(one["days"].values()))["entries"][0]["entry"]
        assert res["notes"] == ["nope.xlsb is not open in the tool."]


def test_reading_other_workbooks_does_not_block_the_tool(tmp_path, small_snapshot, monkeypatch):
    """Several workbooks for the BP bill: the others are read one sheet per job, so the tool keeps
    answering meanwhile (one long job made every other request say "Excel is busy")."""
    import threading
    import time

    from app.api import entries as entries_api

    cfg = Config(month="2026-10", backups={"dir": tmp_path / "b"}, settings_file=tmp_path / "w.json")
    a = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026 - A.json")
    b = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026 - B.json")
    app = create_app(cfg)
    setup_api.choose(app, b, b.name, practice=True, real_file=False)
    setup_api.choose(app, a, a.name, practice=True, real_file=False)  # A is the one on screen
    monkeypatch.setattr(entries_api, "STUCK", 0.3)
    other = app.state.session.books[b.name].service
    real = other.day_view
    monkeypatch.setattr(other, "day_view", lambda s, fresh=False: (time.sleep(0.15), real(s, fresh))[1])
    monkeypatch.setattr(other.workbook, "day_sheet_names", lambda: ["1"] * 8)  # ~1.2 s in all
    with TestClient(app) as c:
        done = {}
        t = threading.Thread(target=lambda: done.update(r=c.get("/api/combined", params=[("name", b.name)])))
        t.start()
        time.sleep(0.6)  # well past STUCK: one long job would be "stuck" by now
        assert c.get("/api/days/1").status_code == 200
        t.join(30)
        assert done["r"].status_code == 200 and done["r"].json()["books"][0]["days"]["1"]["entries"]
