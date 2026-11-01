"""Replay every workbook in fixtures/private and measure the suggestions, then compare with the
baseline kept next to them. One command:

    cd backend && python ../scripts/replay.py            # measure + compare (exit 1 on a drop)
    cd backend && python ../scripts/replay.py --update   # accept the current numbers as baseline

Each entry of each day is replayed with only what came before it (earlier days, earlier entries
that day), the way the entry screen sees it, in two orders: sheet row order and crew by crew (the
way the paper sheet is typed). Measured per book:

- activity codes: first guess, top 3, and per tier (which tier gave the first guess, how often it
  was right); prefilled boxes and how often a prefill was right
- times: exactly right, per tier
- whole record (times + every activity line and its hours) right as suggested
- worker search: keys typed until the worker is first in the list; the empty-box list
- "same entry also for" chips: how many shown, how many right
- crew mismatch warning: how often it would fire
- day builder: ticks right, workers carried exactly right, crew fields to edit per day

Real workbooks and everything derived from them stay in fixtures/private (git-ignored); only this
script is committed. The browser code is measured as it ships (frontend/src, bundled by esbuild).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import load_config  # noqa: E402
from app.domain.codes import employee_code_status, normalise_activity, person_key  # noqa: E402
from app.domain.daybuilder import build_day  # noqa: E402
from app.domain.rules import compute_entry  # noqa: E402
from app.domain.validators import calendar_day_type, intended_date  # noqa: E402
from app.excel.fake_adapter import load_snapshot, save_snapshot  # noqa: E402
from app.setup import uses_activity_codes  # noqa: E402

PRIVATE = ROOT / "fixtures" / "private"
CACHE = PRIVATE / "replay"
BASELINE = CACHE / "baseline.json"
TOLERANCE = 0.3  # percentage points a metric may move down before the run fails
MONTHS = (
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]  # noqa: E501
)


def month_of(name: str) -> dt.date | None:
    low = name.lower()
    for i, m in enumerate(MONTHS):
        if m in low and (y := re.search(r"20\d\d", low)):
            return dt.date(int(y.group()), i + 1, 1)
    return None


def kind_of(name: str) -> str:
    """The workbook without its month: books of one kind follow each other month to month."""
    low = Path(name).stem.lower()
    low = re.sub("|".join(MONTHS), "", low)
    low = re.sub(r"20\d\d|\(\d+\)|[^a-z]+", " ", low)
    return " ".join(low.split())


def snapshot_of(xlsb: Path):
    """Read the workbook once; later runs use the cached snapshot until the file changes."""
    from app.excel.xlsb_reader import XlsbReader

    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"{xlsb.stem}.snapshot.json"
    if cached.exists() and cached.stat().st_mtime >= xlsb.stat().st_mtime:
        return load_snapshot(cached)
    print(f"reading {xlsb.name} (once) …", flush=True)
    with XlsbReader(xlsb, load_config(None).template) as reader:
        snap = reader.snapshot()
    save_snapshot(snap, cached)
    return snap


def month_json(xlsb: Path, snap) -> dict:
    """The month as the entry screen has it (master + day views), for the browser code."""
    cfg = load_config(None)
    t = cfg.template
    start = month_of(xlsb.name) or dt.date.today().replace(day=1)
    holidays = list(cfg.holidays)
    m = snap.master
    days = {}
    for d in snap.days:
        exp = intended_date(d.header.sheet, start)
        days[d.header.sheet] = {
            "header": json.loads(d.header.model_dump_json()),
            "expected_date": exp.isoformat() if exp else None,
            "expected_day_type": calendar_day_type(exp, holidays) if exp else None,
            "header_issues": [],
            "entries": [
                {"entry": json.loads(e.model_dump_json()),
                 "computed": (c.model_dump() if (c := compute_entry(e, d.header.day_type)) else None),  # noqa: E501
                 "issues": []}
                for e in d.entries
            ],
        }  # fmt: skip
    return {
        "workbook": xlsb.name,
        "kind": kind_of(xlsb.name),
        "master": {
            "workbook": xlsb.name,
            "month": start.strftime("%Y-%m"),
            "holidays": [h.isoformat() for h in holidays],
            "sheets": [d.header.sheet for d in snap.days],
            "workers": [
                {"row": w.row, "block": t.block_for_master_row(w.row), "calling_name": w.calling_name,  # noqa: E501
                 "person": person_key(w.calling_name), "name": w.name, "trade_group": w.trade_group,
                 "employee_code": w.employee_code, "code_status": employee_code_status(w.employee_code)}  # noqa: E501
                for w in m.workers
            ],
            "activities": list(dict.fromkeys(a.code for a in m.activities)),
            "day_types": m.day_types,
            "check_activities": uses_activity_codes(snap),
            "places": {},
        },
        "days": days,
    }  # fmt: skip


def day_builder_metrics(snap, prev=None) -> dict:
    """Build each sheet from the days before it (the real sheet emptied) and compare."""
    days = {d.header.sheet: d for d in snap.days}
    if prev is not None:  # previous month's last week as sheets 0, -1, -2, …
        last = sorted((d for d in prev.days if d.entries), key=lambda d: int(d.header.sheet))[-7:]
        for i, d in enumerate(reversed(last)):
            days[str(-i)] = d.model_copy(
                update={"header": d.header.model_copy(update={"sheet": str(-i)})}
            )
    tot = Counter()
    for sheet in sorted((d for d in snap.days if d.entries), key=lambda d: int(d.header.sheet)):
        n = int(sheet.header.sheet)
        if n < 1:
            continue
        target = sheet.model_copy(deep=True)
        real = {e.calling_name: e for e in target.entries if e.calling_name}
        target.entries = []
        b = build_day(target, days)
        tot["days"] += 1
        proposed = {}
        for c in b.crews:
            for mbr in c.members:
                proposed[mbr.calling_name] = (c, mbr)
        for name, (c, mbr) in proposed.items():
            came = name in real
            tot["ticks"] += 1
            tot["tick_right"] += mbr.ticked == came
            if mbr.ticked and came:
                e = real[name]
                acts = tuple((normalise_activity(a.code), a.hours) for a in e.activities if a.code)
                carried = tuple((a.code, a.hours) for a in c.activities)
                same_times = (c.time_in, c.time_out) == (e.time_in, e.time_out)
                same_codes = tuple(a for a, _ in acts) == tuple(a for a, _ in carried)
                tot["kept"] += 1
                tot["exact"] += same_times and same_codes
                tot["edit_times"] += not same_times
                tot["edit_codes"] += not same_codes
        tot["to_type"] += len(set(real) - {n for n, (_, m) in proposed.items() if m.ticked})
        tot["entries"] += len(real)
    d = max(tot["days"], 1)
    return {
        "builder.ticks_right": pct(tot["tick_right"], tot["ticks"]),
        "builder.carried_exact": pct(tot["exact"], tot["kept"]),
        "builder.edit_times_per_day": round(tot["edit_times"] / d, 1),
        "builder.edit_codes_per_day": round(tot["edit_codes"] / d, 1),
        "builder.to_type_per_day": round(tot["to_type"] / d, 1),
        "builder.days": tot["days"],
    }


def pct(a: int, b: int) -> float | None:
    return round(100 * a / b, 1) if b else None


# Metrics where lower is better (the rest: higher is better). Counts are information only.
LOWER = {"builder.edit_times_per_day", "builder.edit_codes_per_day", "builder.to_type_per_day",
         "search.keys", "chips.shown", "mismatch.fires", "codes.prefill_wrong"}  # fmt: skip
INFO = {"builder.days", "codes.n", "times.n", "chips.entries", "record.n"}


def compare(results: dict, baseline: dict) -> list[str]:
    drops = []
    for book, metrics in results.items():
        base = baseline.get(book, {})
        for k, v in metrics.items():
            b = base.get(k)
            if (
                k in INFO
                or k.startswith("tier.")
                or not isinstance(v, (int, float))
                or not isinstance(b, (int, float))
            ):
                continue
            worse = (v - b) if k in LOWER else (b - v)
            if worse > TOLERANCE:
                drops.append(f"{book}: {k} {b} -> {v}")
    return drops


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument(
        "--update", action="store_true", help="write the current numbers as the baseline"
    )
    ap.add_argument("--books", type=Path, default=PRIVATE, help="folder with the .xlsb workbooks")
    ap.add_argument("--json", action="store_true", help="print all numbers as JSON")
    args = ap.parse_args(argv)

    books = sorted(args.books.glob("*.xlsb"))
    if not books:
        print(f"No .xlsb workbooks in {args.books}: nothing to replay.")
        return 0
    snaps = {b: snapshot_of(b) for b in books}
    files = []
    for b, snap in snaps.items():
        out = CACHE / f"{b.stem}.month.json"
        out.write_text(json.dumps(month_json(b, snap)))
        files.append(str(out))

    node = subprocess.run(["node", str(ROOT / "frontend" / "replay" / "measure.cjs"), *files],
                          capture_output=True, text=True, cwd=ROOT / "frontend")  # fmt: skip
    if node.returncode:
        print(node.stdout, node.stderr)
        return 2
    results: dict[str, dict] = json.loads(node.stdout)

    # Day builder (server side), with the previous month of the same kind when it is there.
    by_kind: dict[str, list[Path]] = {}
    for b in books:
        by_kind.setdefault(kind_of(b.name), []).append(b)
    for b, snap in snaps.items():
        same = [
            x
            for x in by_kind[kind_of(b.name)]
            if month_of(x.name) and month_of(b.name) and month_of(x.name) < month_of(b.name)
        ]
        prev = snaps[max(same, key=lambda x: month_of(x.name))] if same else None
        results.setdefault(b.name, {}).update(day_builder_metrics(snap, prev))

    if args.json:
        print(json.dumps(results, indent=1))
    else:
        print_table(results)
    if args.update or not BASELINE.exists():
        BASELINE.write_text(json.dumps(results, indent=1))
        print(f"\nbaseline written: {BASELINE.relative_to(ROOT)}")
        return 0
    drops = compare(results, json.loads(BASELINE.read_text()))
    if drops:
        print("\nWORSE THAN THE BASELINE:\n  " + "\n  ".join(drops))
        return 1
    print("\nNo book is worse than its baseline.")
    return 0


def print_table(results: dict) -> None:
    keys = sorted({k for m in results.values() for k in m})
    names = list(results)
    short = [n.replace("Labour Entry Sheet ", "")[:28] for n in names]
    width = max(len(k) for k in keys) + 2
    print("".ljust(width) + "".join(s.rjust(30) for s in short))
    for k in keys:
        print(k.ljust(width) + "".join(str(results[n].get(k, "")).rjust(30) for n in names))


if __name__ == "__main__":
    sys.exit(main())
