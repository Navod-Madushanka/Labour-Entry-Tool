"""Loads config.yaml (PLAN.md Appendix C).

Lookup order: explicit path > $LABOUR_TOOL_CONFIG > <repo>/config.yaml > <repo>/config.example.yaml.
"""

from __future__ import annotations

import datetime as dt
import os
import re
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.excel.refs import parse_range

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_VAR = "LABOUR_TOOL_CONFIG"


class ServerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8000
    allow_lan: bool = False


class BackupConfig(BaseModel):
    dir: Path = Path("backups")
    keep: int = 10


class HeaderCells(BaseModel):
    date: str = "F3"
    day_type: str = "H3"
    sheet_no: str = "F4"
    prepared_by: str = "F5"
    project: str = "C6"


class MasterCols(BaseModel):
    calling_name: str = "A"
    name: str = "B"
    trade_group: str = "C"
    id: str = "D"
    daily_rate: str = "E"
    bp: str = "F"
    employee_code: str = "G"
    epf: str = "H"


class BlockCols(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    calling_name: str = "A"
    total: str = "D"
    effective: str = "E"
    time_in: str = Field("G", alias="in")
    time_out: str = Field("H", alias="out")
    activity: str = "J"
    hours: str = "K"
    additional: str = "L"
    upload_employee: str = "M"
    upload_date: str = "N"
    upload_activity: str = "O"
    upload_hours: str = "P"
    upload_ot: str = "Q"
    remarks: str = "R"


class TemplateConfig(BaseModel):
    """Layout shared by every entry workbook built from the template (PLAN.md §5)."""

    master_sheet: str = "Labour Detail"
    master_rows: tuple[int, int] = (3, 502)
    master_cols: MasterCols = MasterCols()
    activity_list: str = "L3:L311"
    day_types: str = "N3:N6"
    day_sheets: str = "1..31"
    header: HeaderCells = HeaderCells()
    first_block_row: int = 9
    block_size: int = 7
    blocks: int = 500
    cols: BlockCols = BlockCols()
    activity_rows: tuple[int, int] = (1, 5)
    zidle_row: int = 6
    ot_row: int = 7

    def day_sheet_names(self) -> list[str]:
        m = re.fullmatch(r"\s*(\d+)\s*\.\.\s*(\d+)\s*", self.day_sheets)
        if not m:
            raise ValueError(f"day_sheets must look like '1..31', got {self.day_sheets!r}")
        return [str(n) for n in range(int(m.group(1)), int(m.group(2)) + 1)]

    def block_row(self, block: int) -> int:
        """First worksheet row of block k (0-based). Block 0 -> 9."""
        if not 0 <= block < self.blocks:
            raise IndexError(f"block {block} out of range 0..{self.blocks - 1}")
        return self.first_block_row + self.block_size * block

    @property
    def last_block_row(self) -> int:
        return self.first_block_row + self.block_size * self.blocks - 1

    def master_row_for_block(self, block: int) -> int:
        """Day-sheet block k shows Labour Detail row master_rows[0] + k (PLAN.md §5.3)."""
        return self.master_rows[0] + block

    def block_for_master_row(self, row: int) -> int:
        return row - self.master_rows[0]

    @property
    def activity_start(self) -> tuple[int, int]:
        """(row, col) of the first activity-list cell."""
        return parse_range(self.activity_list)[0]


class Config(BaseModel):
    workbook_pattern: str = "Labour Entry Sheet * - INDIAN*.xlsb"
    workbook_file: Path | None = None  # read from disk (pyxlsb) by the health check
    month: str = Field(description="YYYY-MM")
    registration_files: list[Path] = []
    holidays: list[dt.date] = []
    server: ServerConfig = ServerConfig()
    backups: BackupConfig = BackupConfig()
    template: TemplateConfig = TemplateConfig()

    @field_validator("month", mode="before")
    @classmethod
    def _month(cls, v: object) -> str:
        if isinstance(v, dt.date):
            return f"{v.year:04d}-{v.month:02d}"
        text = str(v).strip()
        if not re.fullmatch(r"\d{4}-\d{2}", text):
            raise ValueError(f"month must be YYYY-MM, got {v!r}")
        return text

    @property
    def month_start(self) -> dt.date:
        year, month = (int(p) for p in self.month.split("-"))
        return dt.date(year, month, 1)


def find_config_path(path: str | Path | None = None) -> Path:
    if path is not None:
        return Path(path)
    if env := os.environ.get(ENV_VAR):
        return Path(env)
    for candidate in (REPO_ROOT / "config.yaml", REPO_ROOT / "config.example.yaml"):
        if candidate.exists():
            return candidate
    raise FileNotFoundError("no config.yaml or config.example.yaml found")


def load_config(path: str | Path | None = None) -> Config:
    cfg_path = find_config_path(path)
    with cfg_path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return Config.model_validate(data)
