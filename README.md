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
