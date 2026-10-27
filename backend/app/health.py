"""Health check command line: ``python -m app.health <file.xlsb> [options]`` (PLAN.md §6 Phase 1).

Reads the workbook from disk (read-only, no Excel needed), prints a summary and writes every issue
to a CSV for the office. A sanitized ``.json`` snapshot works too.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import TextIO

from app.config import Config, TemplateConfig, load_config
from app.domain.health import SEVERITY_ORDER, HealthReport, rule_title, run_health
from app.domain.models import Issue, WorkbookSnapshot
from app.excel.fake_adapter import load_snapshot
from app.excel.xlsb_reader import XlsbReader

CSV_COLUMNS = [
    "severity",
    "rule",
    "title",
    "sheet",
    "cell",
    "calling_name",
    "message",
    "suggestion",
]
SEVERITY_LABEL = {"BLOCK": "Errors", "WARN": "Warnings", "INFO": "Info"}


def read_snapshot(path: Path, template: TemplateConfig) -> WorkbookSnapshot:
    if path.suffix.lower() == ".json":
        return load_snapshot(path)
    with XlsbReader(path, template) as reader:
        return reader.snapshot()


def check_file(
    path: Path,
    config: Config,
    holidays: Sequence[dt.date] | None = None,
) -> HealthReport:
    snapshot = read_snapshot(path, config.template)
    return run_health(
        snapshot,
        config.month_start,
        config.holidays if holidays is None else holidays,
        config.template,
    )


def write_csv(report: HealthReport, fh: TextIO) -> None:
    write_issues_csv(report.issues, fh)


def write_issues_csv(issues: Iterable[Issue], fh: TextIO) -> None:
    writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
    writer.writeheader()
    for issue in issues:
        row = issue.model_dump(include=set(CSV_COLUMNS))
        writer.writerow({**row, "title": rule_title(issue.rule)})


def issue_location(sheet: str | None, cell: str | None) -> str:
    """'sheet 7 G240' for day sheets, 'Labour Detail!G193' for the others."""
    if sheet and not sheet.isdigit():
        return f"{sheet}!{cell}" if cell else sheet
    return " ".join(p for p in (f"sheet {sheet}" if sheet else None, cell) if p)


def format_summary(report: HealthReport, examples: int = 3) -> str:
    s = report.stats
    holidays = ", ".join(d.isoformat() for d in report.holidays) or "none"
    lines = [
        f"Health check: {report.source.source_name}  (month {report.month})",
        f"  {s.workers} workers in Labour Detail; {s.entries} worker-days entered on "
        f"{s.sheets_with_entries} sheets ({s.complete_entries} complete), "
        f"{s.workers_with_entries} workers, {s.effective_hours:g} h effective, "
        f"{s.overnight_shifts} overnight shifts (Out > 24).",
        f"  Holidays used for H02: {holidays}",
        "",
        "  "
        + "   ".join(f"{SEVERITY_LABEL[k]}: {s.by_severity.get(k, 0)}" for k in SEVERITY_ORDER),
    ]
    by_rule: dict[str, list] = {}
    for issue in report.issues:
        by_rule.setdefault(issue.rule, []).append(issue)
    for rule, issues in by_rule.items():
        lines.append("")
        lines.append(f"[{issues[0].severity}] {rule} {rule_title(rule)}: {len(issues)}")
        shown = issues if examples < 0 else issues[:examples]
        for i in shown:
            where = issue_location(i.sheet, i.cell)
            who = f" {i.calling_name}" if i.calling_name else ""
            lines.append(f"    {where}{who}: {i.message}")
            if i.suggestion:
                lines.append(f"      -> {i.suggestion}")
        if len(shown) < len(issues):
            lines.append(f"    ... {len(issues) - len(shown)} more in the CSV")
    if not report.issues:
        lines.append("\nNo issues found.")
    return "\n".join(lines)


def _date(text: str) -> dt.date:
    try:
        return dt.date.fromisoformat(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a YYYY-MM-DD date: {text!r}") from None


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.health",
        description="Read-only health check of a labour entry workbook (.xlsb).",
    )
    parser.add_argument("workbook", type=Path, nargs="?", help="the .xlsb (default: config file)")
    parser.add_argument("--config", type=Path, help="config.yaml to use")
    parser.add_argument("--month", help="YYYY-MM of the workbook (default: config)")
    parser.add_argument(
        "--holiday",
        type=_date,
        action="append",
        metavar="YYYY-MM-DD",
        help="a holiday date; repeat for more. Replaces the config list for this run",
    )
    parser.add_argument(
        "--no-holidays", action="store_true", help="treat no date as a holiday for this run"
    )
    parser.add_argument("--csv", type=Path, help="CSV path (default: <workbook>_health.csv here)")
    parser.add_argument("--all", action="store_true", help="print every issue, not 3 per rule")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    if args.month:
        config = Config.model_validate({**config.model_dump(), "month": args.month})
    path = args.workbook or config.workbook_file
    if path is None:
        parser.error("give a workbook path or set workbook_file in config.yaml")
    if not path.exists():
        parser.error(f"file not found: {path}")
    holidays = [] if args.no_holidays else args.holiday

    report = check_file(path, config, holidays)
    print(format_summary(report, examples=-1 if args.all else 3))

    out = args.csv or Path(f"{path.stem}_health.csv")
    with out.open("w", newline="", encoding="utf-8-sig") as fh:  # BOM: Excel opens it as UTF-8
        write_csv(report, fh)
    print(f"\nWrote {len(report.issues)} issues to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
