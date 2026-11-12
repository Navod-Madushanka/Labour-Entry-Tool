"""What each activity code is, in words: MasterFormat titles as the seed, the office's own wins."""

from fastapi.testclient import TestClient

from app.api import setup as setup_api
from app.config import Config
from app.domain.descriptions import descriptions, standard_description
from app.excel.fake_adapter import save_snapshot
from app.main import create_app


def test_standard_titles_from_the_code_numbers():
    assert standard_description("03-11-00-00-P") == "Concrete Forming"
    assert standard_description(" 03-20-00-00-C-8") == "Concrete Reinforcing"
    assert standard_description("03-31-05-35-P") == "Structural Concrete"  # broader section
    assert standard_description("03-44-13-15-05-A") == "Precast Concrete"  # level 2
    assert standard_description("31-23-23-01-C-1") == "Fill"
    assert standard_description("04-22-00-00") == "Concrete Unit Masonry"
    assert standard_description("26-99-99-99") == "Electrical"  # only the division known
    assert standard_description("00-00-10-00") == "Medical leave"  # the tool's own code
    assert standard_description("ZIDLE") is None
    assert standard_description("99-99-99-99") is None
    assert descriptions(["03-11-00-00", "ZIDLE"], {"03-11-00-00": "Shuttering"}) == {
        "03-11-00-00": "Shuttering"
    }


def test_office_descriptions_kept_per_project(small_snapshot, tmp_path):
    cfg = Config(
        month="2026-10", backups={"dir": tmp_path / "b"}, settings_file=tmp_path / "s.json"
    )

    def app():
        a = create_app(cfg)
        path = save_snapshot(small_snapshot, tmp_path / "Labour Entry Sheet October 2026.json")
        setup_api.choose(a, path, path.name, practice=True, real_file=False)
        return a

    with TestClient(app()) as c:
        c.post("/api/setup/check")
        master = c.get("/api/master").json()
        assert master["descriptions"]["03-11-00-00-P"] == "Concrete Forming"
        assert master["descriptions"]["03-20-00-00-C-8"] == "Concrete Reinforcing"

        view = c.get("/api/setup/descriptions").json()
        row = next(r for r in view["codes"] if r["code"] == "03-11-00-00-P")
        assert row["standard"] == "Concrete Forming" and row["custom"] is None

        c.post("/api/setup/descriptions",
               json={"descriptions": {"03-11-00-00-P": "  Formwork,  parking  "}})  # fmt: skip
        assert c.get("/api/master").json()["descriptions"]["03-11-00-00-P"] == "Formwork, parking"
        assert c.get("/api/master").json()["places"] == {}  # place names untouched

    with TestClient(app()) as c:  # a restart: still there; an empty box goes back to standard
        c.post("/api/setup/check")
        assert c.get("/api/master").json()["descriptions"]["03-11-00-00-P"] == "Formwork, parking"
        c.post("/api/setup/descriptions", json={"descriptions": {"03-11-00-00-P": ""}})
        assert c.get("/api/master").json()["descriptions"]["03-11-00-00-P"] == "Concrete Forming"
