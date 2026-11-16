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
