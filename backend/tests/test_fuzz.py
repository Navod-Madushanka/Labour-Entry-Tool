"""Data cleaning: odd cell values never crash the readers, the calculations or the checks (they
become issues), and malformed requests get a 422, never a server error. Made-up data only."""

import datetime as dt
import random

import pytest
from fastapi.testclient import TestClient

from app.api import setup as setup_api
from app.config import Config, TemplateConfig
from app.domain.health import run_health
from app.domain.models import SnapshotMeta, WorkbookSnapshot
from app.domain.rules import compute_entry
from app.domain.validators import check_entry
from app.excel.fake_adapter import save_snapshot
from app.excel.grid import clean_value, day_from_grid, master_from_grid
from app.excel.refs import col_to_index
from app.main import create_app

T = TemplateConfig()
JUNK = [None, "", " ", "abc", "#N/A", "#VALUE!", "#REF!", True, False, 0, -5, 0.1, 7, 7.5, 19,
        27, 48, 1e9, -1e9, "7", "19:00", "7.30", " 03-11-00-00 ", "03-11-00-00", "x" * 300,
        dt.date(2026, 10, 1), dt.datetime(2026, 10, 1, 7), 46296.0, "Holiday"]  # fmt: skip


def junk(rng: random.Random):
    """An odd value as a reader hands it on: every reader cleans cells the same way (dates to
    Excel serials, '' to blank)."""
    return clean_value(rng.choice(JUNK))


def random_master_grid(rng: random.Random) -> dict:
    g = {}
    m = T.master_cols
    for r in range(T.master_rows[0], T.master_rows[0] + 40):
        g[(r, col_to_index(m.calling_name))] = rng.choice(
            [f"ZZA-{r:02d}", f" zza-{r:02d} ", junk(rng)]
        )
        for col in (m.name, m.trade_group, m.id, m.daily_rate, m.bp, m.employee_code, m.epf):
            g[(r, col_to_index(col))] = junk(rng)
        g[(r, T.activity_start[1])] = rng.choice(["03-11-00-00", " 03-20-00-00", junk(rng)])
    for i, v in enumerate(["Normal Day", "Saturday", "Sunday", junk(rng)]):
        g[(3 + i, col_to_index("N"))] = v
    return g


def random_day_grid(rng: random.Random, sheet: str) -> dict:
    g = {(3, col_to_index("F")): junk(rng), (3, col_to_index("H")): junk(rng),
         (4, col_to_index("F")): junk(rng), (5, col_to_index("F")): junk(rng),
         (6, col_to_index("C")): junk(rng)}  # fmt: skip
    c = T.cols
    for k in range(40):
        r0 = T.block_row(k)
        g[(r0, col_to_index(c.calling_name))] = rng.choice([f"ZZA-{3 + k:02d}", junk(rng)])
        for col in (c.time_in, c.time_out, c.additional, c.remarks, c.total, c.effective):
            if rng.random() < 0.7:
                g[(r0, col_to_index(col))] = junk(rng)
        for i in range(7):
            for col in (c.activity, c.hours, c.upload_activity, c.upload_hours, c.upload_ot):
                if rng.random() < 0.3:
                    g[(r0 + i, col_to_index(col))] = junk(rng)
    return g


@pytest.mark.parametrize("seed", range(40))
def test_odd_cells_never_crash(seed):
    rng = random.Random(seed)
    master = master_from_grid(random_master_grid(rng), T)
    codes = {a.code for a in master.activities}
    days = [day_from_grid(str(d), random_day_grid(rng, str(d)), T) for d in (1, 2, 3)]
    for day in days:
        for e in day.entries:
            compute_entry(e, day.header.day_type)
            for issue in check_entry(e, day.header.day_type, codes, T):
                assert issue.rule and issue.message and issue.plain  # every issue explains itself
            check_entry(e, day.header.day_type, codes, T, check_activities=False)
    snap = WorkbookSnapshot(meta=SnapshotMeta(source_name="junk.xlsb", read_at=dt.datetime.now()),
                            master=master, days=days)  # fmt: skip
    report = run_health(snap, dt.date(2026, 10, 1), [dt.date(2026, 10, 2)], T)
    assert report.stats.entries == sum(len(d.entries) for d in days)


def _req(**fields) -> dict:
    entry = {"sheet": "1", "calling_name": "INB-01", "time_in": 7, "time_out": 19, "activities": []}
    return {"entries": [{**entry, **fields}]}


BAD_REQUESTS = [
    _req(time_in="seven"),
    _req(activities=[{"code": 5, "hours": "x"}]),
    {"entries": [{"sheet": 99, "calling_name": None}]},
    {"entries": "nope"},
    {},
    _req(time_in=1e308, time_out=-1e308),
    _req(sheet="99"),
    _req(calling_name="NOBODY"),
    _req(remark="x" * 10_000),
]


def test_malformed_requests_get_422_not_500(small_snapshot, tmp_path):
    app = create_app(Config(month="2000-01", backups={"dir": tmp_path / "b"}))
    path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
    setup_api.choose(app, path, path.name, practice=True, real_file=False)
    with TestClient(app, raise_server_exceptions=False) as c:
        for body in BAD_REQUESTS:
            res = c.post("/api/preview", json=body)
            assert res.status_code in (200, 422), (body, res.status_code, res.text[:200])
        for url in [
            "/api/days/99",
            "/api/days/abc",
            "/api/master?fresh=maybe",
            "/api/batches?limit=-5",
        ]:
            assert c.get(url).status_code < 500, url
        for body in [{"user": ""}, {"user": "x"}, {}]:
            assert c.post("/api/batches/123456/undo", json=body).status_code < 500
        assert (
            c.post(
                "/api/activities/add", json={"codes": [], "user": "x", "approve": True}
            ).status_code
            == 422
        )
