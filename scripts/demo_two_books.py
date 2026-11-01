"""Made-up workbooks open at once, for trying several workbooks (frontend/e2e/workbooks.cjs).

    cd backend && python ../scripts/demo_two_books.py [port] [big]

"DEMO A" and "DEMO C" are kept with activity codes, "DEMO B" without (like the sub-contract
workbook). No real data: workers, codes and times are invented. A is ready for entry; B and C go
through the start page.
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


def entry(sheet: str, block: int, name: str, code: str | None, tin=7.0, tout=19.0) -> Entry:
    r0 = T.block_row(block)
    lines = [ActivityLine(row=r0 + i) for i in range(5)]
    if code:
        lines[0] = ActivityLine(row=r0, code=code, hours=11.0)
    return Entry(sheet=sheet, block=block, row=r0, calling_name=name, time_in=tin, time_out=tout,
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
        if d <= 3:  # a night shift, 19:00 to 03:00 the next morning (written as 27 in Excel)
            code = acts[0] if codes else None
            night = entry(str(d), 8, workers[8].calling_name, code, 19.0, 27.0)
            entries.append(night)
        header = DayHeader(sheet=str(d), date=date, day_type=calendar_day_type(date, []),
                           sheet_no=float(d), prepared_by="Clerk", project="SITE")  # fmt: skip
        days.append(DaySheet(header=header, block_names=[w.calling_name for w in workers],
                             entries=entries))  # fmt: skip
    master = MasterData(workers=workers,
                        activities=[ActivityCode(row=3 + i, raw=c) for i, c in enumerate(acts)],
                        day_types=["Normal Day", "Saturday", "Sunday", "Holiday"])  # fmt: skip
    meta = SnapshotMeta(source_name=name, read_at=dt.datetime.now().astimezone())
    return save_snapshot(WorkbookSnapshot(meta=meta, master=master, days=days), folder / name)


def big_book(folder: Path, name: str, prefix: str, size: int = 250, filled: int = 20) -> Path:
    """A month the size of a real one (made up): ``size`` workers in crews of 10 with their own
    code and times, entries on days 1..``filled``, for long-day tests (frontend/e2e/soak.cjs)."""
    workers = [Worker(row=3 + i, calling_name=f"{prefix}-{i + 1:03d}", name=f"Person {i + 1}",
                      trade_group=["Carpenter", "Barbender", "Helper", "Masan"][i // 10 % 4],
                      id_no=f"P{i:07d}", employee_code=f"X{i:05d}")
               for i in range(size)]  # fmt: skip
    acts = [f"{a:02d}-{b:02d}-00-00{s}" for a in (1, 3, 4, 9) for b in (11, 20, 31, 54)
            for s in ("", "-P", "-C-8")]  # fmt: skip
    shifts = [(7.0, 19.0), (7.0, 16.0), (8.0, 20.0), (7.0, 21.0), (19.0, 27.0)]
    days = []
    for d in range(1, 32):
        date = dt.date(2026, 10, d)
        entries = []
        if d <= filled:
            for b, w in enumerate(workers):
                if (b * 7 + d) % 13 == 0:
                    continue  # someone off now and then
                crew = b // 10
                tin, tout = shifts[crew % len(shifts)]
                code = acts[(crew + d // 7) % len(acts)]  # crews move to other work weekly
                e = entry(str(d), b, w.calling_name, code, tin, tout)
                e.activities[0] = e.activities[0].model_copy(
                    update={"hours": float(tout - tin - (2 if tout > 22 else 1))}
                )
                entries.append(e)
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
    big = "big" in sys.argv[2:]  # DEMO A the size of a real month (250 workers, 20 days filled)
    folder = Path(tempfile.mkdtemp(prefix="labour_two_books_"))
    a_name = "Labour Entry Sheet October 2026 - DEMO A.json"
    a = big_book(folder, a_name, "AAA") if big else book(folder, a_name, "AAA", codes=True)
    b = book(folder, "Labour Entry Sheet October 2026 - DEMO B.json", "BBB", codes=False)
    c = book(folder, "Labour Entry Sheet October 2026 - DEMO C.json", "CCC", codes=True)
    app = create_app(Config(month="2026-10", backups={"dir": folder / "backups"},
                            audit={"db": folder / "audit.sqlite"}))  # fmt: skip
    setup.choose(app, b, b.name, practice=True, real_file=False)
    setup.choose(app, c, c.name, practice=True, real_file=False)
    setup.choose(app, a, a.name, practice=True, real_file=False)
    app.state.session.book.ready = True
    print(f"Three practice workbooks on http://127.0.0.1:{port}/ (files in {folder})")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
