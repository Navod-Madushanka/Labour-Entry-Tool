"""Standard costing rates (the rupee lens): per trade and labour source, multipliers, and
Labour Detail's own Daily Rate column when the QS chooses it. Kept on the PC, never in Excel."""

from fastapi.testclient import TestClient

from app.api import setup as setup_api
from app.config import Config
from app.excel.fake_adapter import save_snapshot
from app.main import create_app


def practice(small_snapshot, tmp_path, name="Labour Entry Sheet October 2026 - INDIAN.json"):
    cfg = Config(
        month="2026-10", backups={"dir": tmp_path / "b"}, settings_file=tmp_path / "s.json"
    )
    app = create_app(cfg)
    path = save_snapshot(small_snapshot, tmp_path / name)
    setup_api.choose(app, path, path.name, practice=True, real_file=False)
    return app


def test_rates_per_labour_source(small_snapshot, tmp_path):
    with TestClient(practice(small_snapshot, tmp_path)) as c:
        c.post("/api/setup/check")
        view = c.get("/api/setup/rates").json()
        assert view["source"] == "labour entry sheet indian" and view["trades"] == {}
        assert (view["ot"], view["sunday"], view["holiday"], view["day_hours"]) == (1.5, 1.5, 2, 8)
        assert view["worker_rates"] == 1  # one worker has a Daily Rate in Labour Detail
        assert c.get("/api/master").json()["rates"] == {}  # nothing given: no rupees anywhere

        body = {"trades": {"Barbender": 3200, " Helper ": 2400, "Mason": 0}, "holiday": 2.5}
        view = c.post("/api/setup/rates", json=body).json()
        assert view["trades"] == {"Barbender": 3200, "Helper": 2400} and view["holiday"] == 2.5
        rates = c.get("/api/master").json()["rates"]
        assert rates["trades"] == {"Barbender": 3200, "Helper": 2400}
        assert rates["ot"] == 1.5 and rates["holiday"] == 2.5 and rates["workers"] == {}

        c.post("/api/setup/rates", json={**body, "use_worker_rates": True})
        assert list(c.get("/api/master").json()["rates"]["workers"].values()) == [2500]
        bad = c.post("/api/setup/rates", json={"trades": {"Helper": -5}})
        assert bad.status_code == 422

    # another labour source (sub-contract) starts without rates; the multipliers are shared
    other = practice(
        small_snapshot, tmp_path, "Labour Entry Sheet October 2026 - SUB CONTRACT.json"
    )
    with TestClient(other) as c:
        c.post("/api/setup/check")
        view = c.get("/api/setup/rates").json()
        assert view["trades"] == {} and view["other_sources"] == ["labour entry sheet indian"]
        assert view["holiday"] == 2.5
