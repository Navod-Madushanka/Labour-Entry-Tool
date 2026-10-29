"""Two made-up workbooks open at once, for trying several workbooks (frontend/e2e/workbooks.cjs).

    cd backend && python ../scripts/demo_two_books.py [port]

"DEMO A" is kept with activity codes, "DEMO B" without (like the sub-contract workbook). No real
data: workers, codes and times are invented. A is ready for entry; B goes through the start page.
"""

from __future__ import annotations

import datetime as dt
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import uvicorn

from app.api import setup
from app.config import Config, TemplateConfig
from app.domain.models import (
    ActivityCode,
    ActivityLine,
    DayHeader,
    DaySheet,
    Entry,
    MasterData,
    SnapshotMeta,
    WorkbookSnapshot,
    Worker,
)
from app.domain.validators import calendar_day_type
from app.excel.fake_adapter import save_snapshot
from app.main import create_app

T = TemplateConfig()


def entry(sheet: str, block: int, name: str, code: str | None) -> Entry:
    r0 = T.block_row(block)
    lines = [ActivityLine(row=r0 + i) for i in range(5)]
    if code:
        lines[0] = ActivityLine(row=r0, code=code, hours=11.0)
    return Entry(sheet=sheet, block=block, row=r0, calling_name=name, time_in=7.0, time_out=19.0,
                 activities=lines)  # fmt: skip


def book(folder: Path, name: str, prefix: str, codes: bool) -> Path:
    workers = [Worker(row=3 + i, calling_name=f"{prefix}-{i + 1:02d}", name=f"Person {i + 1}",
                      trade_group="Helper", id_no=f"P{i:07d}", employee_code=f"X{i:05d}")
               for i in range(12)]  # fmt: skip
    # Place suffixes like a real list: "-P" and "-C-8" (made up here; named on the start page).
    acts = ["03-11-00-00", "03-11-00-00-P", "03-20-00-00-C-8", "00-00-10-00"] if codes else []
    days = []
    for d in range(1, 32):
        date = dt.date(2026, 10, d)
        crew = lambda b: acts[1] if b < 4 else acts[2]  # noqa: E731 - two crews, two places
        entries = [entry(str(d), b, workers[b].calling_name, crew(b) if codes else None)
                   for b in range(8)] if d <= 3 else []  # fmt: skip
        header = DayHeader(sheet=str(d), date=date, day_type=calendar_day_type(date, []),
                           sheet_no=float(d), prepared_by="Clerk", project="SITE")  # fmt: skip
        days.append(DaySheet(header=header, block_names=[w.calling_name for w in workers],
                             entries=entries))  # fmt: skip
    master = MasterData(workers=workers,
                        activities=[ActivityCode(row=3 + i, raw=c) for i, c in enumerate(acts)],
                        day_types=["Normal Day", "Saturday", "Sunday", "Holiday"])  # fmt: skip
    meta = SnapshotMeta(source_name=name, read_at=dt.datetime.now().astimezone())
    return save_snapshot(WorkbookSnapshot(meta=meta, master=master, days=days), folder / name)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8012
    folder = Path(tempfile.mkdtemp(prefix="labour_two_books_"))
    a = book(folder, "Labour Entry Sheet October 2026 - DEMO A.json", "AAA", codes=True)
    b = book(folder, "Labour Entry Sheet October 2026 - DEMO B.json", "BBB", codes=False)
    app = create_app(Config(month="2026-10", backups={"dir": folder / "backups"},
                            audit={"db": folder / "audit.sqlite"}))  # fmt: skip
    setup.choose(app, b, b.name, practice=True, real_file=False)
    setup.choose(app, a, a.name, practice=True, real_file=False)
    app.state.session.book.ready = True
    print(f"Two practice workbooks on http://127.0.0.1:{port}/ (files in {folder})")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
