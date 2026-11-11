"""A worker's trade comes from the calling name's letter (INR-01 is a Rigger), else from Labour
Detail's trade column; the letters can be changed and are kept for every workbook."""

from fastapi.testclient import TestClient

from app.api import setup as setup_api
from app.config import Config
from app.excel.fake_adapter import save_snapshot
from app.main import create_app


def practice_app(small_snapshot, tmp_path):
    cfg = Config(
        month="2026-10", backups={"dir": tmp_path / "b"}, settings_file=tmp_path / "s.json"
    )
    app = create_app(cfg)
    path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
    setup_api.choose(app, path, path.name, practice=True, real_file=False)
    return app


def trades(c):
    return {w["calling_name"]: (w["trade_group"], w["trade_source"], w["trade_column"])
            for w in c.get("/api/master").json()["workers"]}  # fmt: skip


def test_trade_from_the_letter_else_the_column(small_snapshot, tmp_path):
    app = practice_app(small_snapshot, tmp_path)
    with TestClient(app) as c:
        t = trades(c)
        # INB-01 CH says Carpenter in Labour Detail, but its letter B is Barbender
        assert t["INB-01 CH"] == ("Barbender", "name", "Carpenter")
        assert t["INC-02"] == ("Carpenter", "name", "Carpenter")
        assert t["INH-03"][:2] == ("Helper", "name")

        # a letter the tool does not know: the column decides, and the page lists the letter
        view = c.post("/api/setup/trade-letters", json={"letters": {"B": "Barbender"}}).json()
        assert view["letters"] == {"B": "Barbender"} and view["unmatched"] == {"C": 1, "H": 1}
        t = trades(c)
        assert t["INC-02"] == ("Carpenter", "column", "Carpenter")
        assert t["INH-03"][1] == "column"

        # a letter set by hand wins over the column, for every workbook (kept in the settings)
        c.post(
            "/api/setup/trade-letters",
            json={"letters": {"B": "Barbender", "c": " Shuttering  Carpenter "}},
        )
        assert trades(c)["INC-02"] == ("Shuttering Carpenter", "name", "Carpenter")
        assert c.post("/api/setup/trade-letters", json={"letters": {"R1": "x"}}).status_code == 422

    again = practice_app(small_snapshot, tmp_path)  # a restart: the letters are still there
    with TestClient(again) as c:
        assert c.get("/api/setup/trade-letters").json()["letters"] == {
            "B": "Barbender",
            "C": "Shuttering Carpenter",
        }
