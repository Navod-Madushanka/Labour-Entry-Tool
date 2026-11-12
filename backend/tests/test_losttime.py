"""Lost-time reasons (roadmap #5): a reason for a supervisor sheet's unallocated hours and the
disruption of a whole day, given at push or later; the latest answer wins; Excel is not changed."""

from fastapi.testclient import TestClient

from app.api import setup as setup_api
from app.config import Config
from app.excel.fake_adapter import save_snapshot
from app.main import create_app


def test_reasons_and_day_tags(small_snapshot, tmp_path):
    cfg = Config(
        month="2026-10", backups={"dir": tmp_path / "b"}, settings_file=tmp_path / "s.json",
        audit={"db": tmp_path / "a.db"},
    )  # fmt: skip
    app = create_app(cfg)
    path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
    setup_api.choose(app, path, path.name, practice=True, real_file=False)
    with TestClient(app) as c:
        view = c.get("/api/lost-time").json()
        assert {x["id"] for x in view["causes"]} >= {"rain", "concrete", "power"}
        assert view["items"] == []
        body = {"user": "Navod", "sheet": "1", "supervisor": "kamal ", "causes": ["concrete"]}
        c.post("/api/lost-time", json=body)
        c.post("/api/lost-time", json={"user": "N", "sheet": "1", "causes": ["rain", "rain"]})
        items = c.get("/api/lost-time").json()["items"]
        assert {(i["sheet"], i["supervisor"], tuple(i["causes"])) for i in items} == {
            ("1", "kamal", ("concrete",)),
            ("1", None, ("rain",)),
        }
        # changed later: the latest wins; no causes and no note clears it
        c.post("/api/lost-time", json={**body, "causes": ["plant"], "note": "mixer down"})
        c.post("/api/lost-time", json={"user": "N", "sheet": "1", "causes": []})
        items = c.get("/api/lost-time").json()["items"]
        assert [(i["causes"], i["note"]) for i in items] == [(["plant"], "mixer down")]
        bad = c.post("/api/lost-time", json={**body, "causes": ["aliens"]})
        assert bad.status_code == 422
