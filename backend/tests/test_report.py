"""The PM and QS report (roadmap #10): written to a folder (now, and every evening by the
scheduler), aggregates only (no worker names), rupees only when allowed, /viewer read-only, and
other PCs on the network get /viewer and nothing else."""

import asyncio
import contextlib

from fastapi.testclient import TestClient

from app.api import report
from app.api import setup as setup_api
from app.config import Config
from app.excel.fake_adapter import save_snapshot
from app.main import create_app


def practice(small_snapshot, tmp_path):
    cfg = Config(
        month="2026-10", backups={"dir": tmp_path / "b"}, settings_file=tmp_path / "s.json"
    )
    app = create_app(cfg)
    path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026 - INDIAN.json")
    setup_api.choose(app, path, path.name, practice=True, real_file=False)
    return app


def test_write_now_and_viewer(small_snapshot, tmp_path):
    app = practice(small_snapshot, tmp_path)
    out = tmp_path / "shared" / "Labour reports"
    with TestClient(app) as c:
        c.post("/api/setup/check")
        s = c.get("/api/report/settings").json()
        assert (s["enabled"], s["rupees"], s["lan"], s["time"]) == (False, False, False, "18:30")
        assert c.post("/api/report/write").status_code == 422  # no folder yet
        c.post("/api/report/settings", json={"folder": str(out), "time": "18:30", "enabled": True})
        state = c.post("/api/report/write").json()
        files = sorted(p.name for p in out.iterdir())
        assert len(files) == 2 and any("latest" in f for f in files)
        assert state["last_file"] and state["last_error"] is None
        text = (out / next(f for f in files if "latest" in f)).read_text(encoding="utf-8")
        assert "Month to date" in text and "Top activities" in text
        for w in small_snapshot.master.workers:  # no names, no calling names
            assert str(w.name) not in text and w.calling_name not in text
        assert "Rs " not in text  # rupees are off by default

        page = c.get("/viewer")  # the same report, live, on this PC
        assert page.status_code == 200 and "Month to date" in page.text
        assert (
            c.post("/api/report/settings", json={"folder": "", "time": "25:00"}).status_code == 422
        )


def test_other_pcs_only_get_the_viewer(small_snapshot, tmp_path):
    app = practice(small_snapshot, tmp_path)
    with TestClient(app) as local:
        local.post("/api/setup/check")
        other = TestClient(app, client=("10.1.2.3", 50000))
        assert other.get("/api/status").status_code == 403
        assert other.get("/app/").status_code == 403
        assert other.get("/viewer").status_code == 403  # LAN viewing is off
        local.post("/api/report/settings", json={"lan": True})
        assert other.get("/viewer").status_code == 200
        assert other.post("/api/report/settings", json={"lan": False}).status_code == 403


def test_evening_scheduler_writes_once(small_snapshot, tmp_path):
    app = practice(small_snapshot, tmp_path)
    out = tmp_path / "evening"

    async def run():
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(report.scheduler(app, every=0.02), 0.5)

    with TestClient(app) as c:
        c.post("/api/setup/check")
        c.post("/api/report/settings", json={"folder": str(out), "time": "00:00", "enabled": True})
        c.portal.call(run)  # in the app's own event loop, as at run time
        assert len(list(out.iterdir())) == 2  # dated + latest, written once for today
        assert c.get("/api/report/settings").json()["last_at"]
