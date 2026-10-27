# Labour Entry Tool

A local web tool that adds search, suggestions and validation to the monthly labour entry workbook
and writes entries into the open Excel workbook. The workbook remains the system of record.
**[PLAN.md](PLAN.md) is the spec. Read it first.** Progress is tracked in [CHANGELOG.md](CHANGELOG.md).

## Setup (Windows, Python 3.11+; this PC uses 3.12)

```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e "backend[dev]"
pre-commit install            # ruff + pytest + "no workbooks in git" on every commit
copy config.example.yaml config.yaml   # then edit paths; config.yaml is git-ignored
```

## Tests

```powershell
python -m pytest backend/tests          # unit tests; golden tests skip without fixtures
python -m ruff check . ; python -m ruff format --check .
```

| Test group | Needs | Notes |
|---|---|---|
| unit (`test_rules`, `test_codes`, …) | nothing | run on Linux/CI too |
| `test_xlsb_reader` | `fixtures/synthetic/template_synthetic.xlsb` | create it with `python scripts/make_synthetic_xlsb.py` (uses a hidden Excel instance, fake data only) |
| `test_golden_indian` | the real INDIAN `.xlsb` in `fixtures/private/`, or its sanitized JSON in `fixtures/sanitized/` | checks PLAN.md Appendix A and the Phase 0 "done" rule |

## Health check (Phase 1, read-only)

Reads the workbook from disk with pyxlsb, so Excel is not needed and nothing is written.

```powershell
cd backend
python -m app.health "C:/Labour/Labour Entry Sheet October 2026 - INDIAN (2).xlsb"   # summary + CSV
python -m app.health --holiday 2026-10-25 --holiday 2026-11-01 --all                 # uses workbook_file from config.yaml
python -m app.main                       # web report at http://localhost:8000/health
```

- The CSV (`<workbook>_health.csv`) lists every issue with sheet, cell, calling name, message and
  suggested fix. CSV files are git-ignored.
- **Holidays** for rule H02 come from `holidays:` in `config.yaml`. They are not confirmed yet, so
  edit that list as the office confirms them. For a single run, use `--holiday` (repeatable) or
  `--no-holidays`, or the holiday box on the report page.
- The web report needs `workbook_file:` in `config.yaml`. The API is `GET /api/health`,
  `GET /api/health.csv` (both take `?holidays=YYYY-MM-DD,...`) and `GET /api/rules`.

## Live Excel (Phase 2)

With the workbook open in Excel, `python -m app.main` attaches to it (the one open book matching
`workbook_pattern`) and serves the write API. Nothing is written unless every entry passes its
checks and every warning is acknowledged.

| Route | What it does |
|---|---|
| `GET /api/status` | connected?, workbook name, unsaved changes, this session's backup |
| `POST /api/preview` | plan and check entries; writes nothing |
| `POST /api/entries` | write a batch (`dry_run: true` only checks it); returns the read-back per worker |
| `GET /api/batches` | recent batches from the audit log |
| `POST /api/batches/{id}/undo` | write the old values back (refused if the cells changed since) |
| `POST /api/save` | save the workbook in Excel |

- Before the first write of a session a copy goes to `backups.dir` (newest 10 kept). Every
  changed cell is logged with its old value in `audit.db` (calling names and values only).
- Only the §5.4 input cells are ever written: `G:H`, `J:K` (rows 1–5), `L` and `R` of a block.
- If Excel is busy (a cell is being edited) the call is retried for `excel.busy_timeout` seconds.

**Smoke test on Windows** (needs a *copy* of the workbook open in Excel, nothing else matching):

```powershell
cd backend
python ../scripts/excel_smoke.py --i-am-using-a-copy --pattern "*COPY*.xlsb"
```

It writes six test entries into empty blocks of an empty day sheet, compares Excel's recalculated
values with the preview, checks the backup and sheet protection, undoes everything and confirms
every cell is back. It prints PASS/FAIL per step and writes `smoke_report.json` (no names or IDs).
Close the copy without saving afterwards.

## Fixtures and privacy (PLAN.md §10)

- Real workbooks go **only** in `fixtures/private/`. That folder, every `*.xlsb`/`*.xlsx`, `backups/`,
  audit databases and CSV reports are git-ignored, and a pre-commit hook refuses them as well.
- Make a commit-safe fixture from a real workbook:

  ```powershell
  python scripts/snapshot_fixture.py "fixtures/private/Labour Entry Sheet October 2026 - INDIAN (2).xlsb" -o fixtures/sanitized/indian_2026-10.json
  ```

  This replaces names, passport/NIC numbers, EPF numbers, remarks and "prepared by" with deterministic
  fakes. It keeps calling names, employee codes, times, hours and activity codes. **Look at the JSON
  before committing it.**

## Layout

`backend/app/domain` holds pure Python (rules, code grammar, models). `backend/app/excel` holds
workbook access: the pyxlsb reader, the in-memory fake and, later, the live xlwings adapter. See
PLAN.md §4.
