"""``python -m app.registration [files...] [--workbook x.xlsb] [--csv out.csv]`` (Phase 4).

Checks registration workbooks (read-only) and, with ``--workbook``, lists the employee codes it
would propose for Labour Detail and the ID conflicts. Nothing is written: codes are written from
the web page after approval.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from app.config import load_config
from app.health import issue_location, read_snapshot, write_issues_csv
from app.registration.checks import check_registrations
from app.registration.proposals import id_conflicts, propose_codes
from app.registration.reader import read_registration


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.registration", description=__doc__.split("\n")[2]
    )
    parser.add_argument("files", type=Path, nargs="*", help="registration .xlsx (default: config)")
    parser.add_argument("--config", type=Path)
    parser.add_argument("--workbook", type=Path, help="entry workbook (.xlsb or snapshot .json)")
    parser.add_argument("--csv", type=Path, default=Path("registration_check.csv"))
    args = parser.parse_args(argv)
    config = load_config(args.config)
    paths = args.files or config.registration_files
    if not paths:
        parser.error("give registration files or set registration_files in config.yaml")
    missing = [p for p in paths if not Path(p).exists()]
    for p in missing:
        print(f"Not found: {p}")
    files = [read_registration(p) for p in paths if Path(p).exists()]

    report = check_registrations(files)
    print(f"Registration check: {', '.join(f.name for f in files)}  ({report.rows} rows)")
    for f in files:
        print(
            f"  {f.name}: {', '.join(f'{s.title.strip()} ({s.kind}, {s.rows})' for s in f.sheets)}"
        )
    print(f"  Issues by rule: {report.by_rule or 'none'}")
    for i in report.issues:
        print(f"  [{i.rule}] {issue_location(i.sheet, i.cell)} {i.calling_name}: {i.message}"
              + (f"  -> {i.suggestion}" if i.suggestion else ""))  # fmt: skip
    print("  Next free calling names:", ", ".join(report.next_numbers.values()) or "-")
    with args.csv.open("w", newline="", encoding="utf-8-sig") as fh:
        write_issues_csv(report.issues, fh)
    print(f"Wrote {len(report.issues)} issues to {args.csv}")

    workbook = args.workbook or config.workbook_file
    if workbook and Path(workbook).exists():
        master = read_snapshot(Path(workbook), config.template).master
        rows = [r for f in files for r in f.rows]
        props = propose_codes(master, rows)
        print(f"\nEmployee codes in {Path(workbook).name}: {len(props)} rows without a valid code")
        for p in props:
            what = f"-> {p.proposed} ({p.source}, {p.found_in})" if p.proposed else "no proposal"
            extra = "; ".join(p.conflicts + p.notes)
            print(
                f"  row {p.row} {p.calling_name} [{p.status.value}] {what}"
                + (f"  ({extra})" if extra else "")
            )
        found = id_conflicts(master, rows)
        print(f"ID conflicts with Labour Detail: {len(found)}")
        for c in found:
            print(f"  {c.kind}: {c.message} [{c.registration}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
