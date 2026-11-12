"""Month history (roadmap #9): save this month, add a past month from its file, rows without
personal data, replace on a second save, delete, and runs carried over the month end."""

from fastapi.testclient import TestClient

from app.api import setup as setup_api
from app.config import Config
from app.excel.fake_adapter import save_snapshot
from app.main import create_app


def test_save_import_rows_and_runs(small_snapshot, tmp_path):
    cfg = Config(
        month="2026-10", backups={"dir": tmp_path / "b"}, settings_file=tmp_path / "s.json"
    )
    app = create_app(cfg)
    path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
    setup_api.choose(app, path, path.name, practice=True, real_file=False)
    with TestClient(app) as c:
        c.post("/api/setup/check")
        assert c.get("/api/history").json() == []
        saved = c.post("/api/history/save").json()["month"]
        assert saved["month"] == "2026-10" and saved["kind"] == "labour entry sheet"
        assert saved["entries"] > 0 and saved["hours"] > 0

        rows = c.get(f"/api/history/rows?ids={saved['id']}").json()["rows"]
        assert rows and {"calling_name", "worked", "ot", "lines", "trade"} <= set(rows[0])
        assert "name" not in rows[0] and "id_no" not in rows[0]  # no personal data

        # the same month again replaces it
        again = c.post("/api/history/save").json()["month"]
        assert [m["month"] for m in c.get("/api/history").json()] == ["2026-10"]

        # a past month from its file (sent as the body); the month comes from the name
        body = (tmp_path / "Labour Entry Sheet October 2026.json").read_bytes()
        prev = c.post(
            "/api/history/import?filename=Labour Entry Sheet September 2026.json", content=body
        ).json()["month"]
        assert prev["month"] == "2026-09"
        assert [m["month"] for m in c.get("/api/history").json()] == ["2026-09", "2026-10"]

        # runs at the end of September carry into October
        carry = c.get("/api/history/carry").json()
        assert carry and all(n >= 1 for n in carry.values())

        bad = c.post("/api/history/import?filename=notes.txt", content=b"x")
        assert bad.status_code == 422
        left = c.delete(f"/api/history/{again['id']}").json()
        assert [m["month"] for m in left] == ["2026-09"]
