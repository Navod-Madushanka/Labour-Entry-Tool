import datetime as dt

import pytest

from app.config import Config, TemplateConfig, load_config
from app.excel import refs
from tests.conftest import REPO_ROOT


def test_example_config_loads():
    cfg = load_config(REPO_ROOT / "config.example.yaml")
    assert cfg.month == "2026-10"
    assert cfg.month_start == dt.date(2026, 10, 1)
    assert cfg.holidays == [dt.date(2026, 10, 25)]
    assert cfg.server.host == "127.0.0.1" and cfg.server.allow_lan is False
    t = cfg.template
    assert t.cols.time_in == "G" and t.cols.time_out == "H"  # YAML keys "in"/"out"
    assert t.header.date == "F3" and t.header.sheet_no == "F4"


def test_template_matches_defaults():
    assert load_config(REPO_ROOT / "config.example.yaml").template == TemplateConfig()


def test_block_geometry():
    t = TemplateConfig()
    assert t.block_row(0) == 9
    assert t.block_row(1) == 16
    assert t.block_row(499) == 3502
    assert t.last_block_row == 3508
    assert t.master_row_for_block(0) == 3
    assert t.master_row_for_block(499) == 502
    assert t.block_for_master_row(214) == 211
    with pytest.raises(IndexError):
        t.block_row(500)


def test_day_sheet_names_and_activity_start():
    t = TemplateConfig()
    assert t.day_sheet_names() == [str(n) for n in range(1, 32)]
    assert t.activity_start == (3, 12)


@pytest.mark.parametrize("bad", ["2026-1", "Oct 2026", "2026/10"])
def test_month_validation(bad):
    with pytest.raises(ValueError):
        Config(month=bad)


def test_month_from_yaml_date():
    assert Config(month=dt.date(2026, 10, 1)).month == "2026-10"


def test_refs():
    assert refs.col_to_index("A") == 1
    assert refs.col_to_index("R") == 18
    assert refs.col_to_index("AA") == 27
    assert all(refs.col_to_index(refs.index_to_col(i)) == i for i in range(1, 800))
    assert refs.parse_cell("F3") == (3, 6)
    assert refs.parse_cell("$L$311") == (311, 12)
    assert refs.parse_range("L3:L311") == ((3, 12), (311, 12))
    assert refs.parse_range("C6") == ((6, 3), (6, 3))
    assert refs.cell_ref(3509, 5) == "E3509"
    with pytest.raises(ValueError):
        refs.parse_cell("3F")
