"""Real entry workbook (.xlsb) -> sanitized JSON fixture (PLAN.md §9).

Usage:
    python scripts/snapshot_fixture.py "fixtures/private/<workbook>.xlsb" \
        -o fixtures/sanitized/indian_2026-10.json

Also prints the source SHA-256 so it can be compared with PLAN.md §5.1.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from app.config import load_config
from app.excel.fake_adapter import save_snapshot
from app.excel.xlsb_reader import XlsbReader
from app.sanitize import sanitize_snapshot


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("workbook", type=Path)
    ap.add_argument("-o", "--out", type=Path, required=True, help="output .json path")
    ap.add_argument("--config", type=Path, default=None, help="config.yaml (template layout)")
    ap.add_argument(
        "--no-sanitize",
        action="store_true",
        help="keep real names/IDs (output must stay under fixtures/private/)",
    )
    args = ap.parse_args(argv)

    out = args.out.resolve()
    if args.no_sanitize and "private" not in out.parts:
        ap.error("--no-sanitize output must be inside fixtures/private/")

    template = load_config(args.config).template
    started = time.perf_counter()
    with XlsbReader(args.workbook, template) as reader:
        snap = reader.snapshot()
    if not args.no_sanitize:
        snap = sanitize_snapshot(snap)
    save_snapshot(snap, out)

    entries = sum(len(d.entries) for d in snap.days)
    print(f"source   : {snap.meta.source_name}")
    print(f"sha256   : {snap.meta.source_sha256}")
    print(f"workers  : {len(snap.master.workers)}, activities: {len(snap.master.activities)}")
    print(f"entries  : {entries} on {len(snap.days)} day sheets")
    print(f"sanitized: {snap.meta.sanitized}")
    size_mb = out.stat().st_size / 1e6
    print(f"wrote    : {out} ({size_mb:.1f} MB) in {time.perf_counter() - started:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
