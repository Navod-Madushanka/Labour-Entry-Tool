# Pattern-Based Labour Entry Assistant

Checked labour entry for the monthly workbook, with suggestions from the month's own patterns. No
AI, no internet: it recognises the patterns in the workbook's entries (who works together, each
worker's usual times, which activity codes a trade and its crews use) by counting them, in
milliseconds, checks every entry against the workbook's rules, and writes into the open Excel
workbook with a backup and undo. The workbook remains the system of record.
**[PLAN.md](PLAN.md) is the spec. Read it first.** Progress is tracked in [CHANGELOG.md](CHANGELOG.md).

## Start on a PC without Python (Windows package)

Download **LabourEntryTool-windows.zip**: on GitHub, *Actions* → *Windows package* → the latest
green run → *Artifacts* (or the *Releases* page once a version is tagged). Unzip the whole folder
somewhere it can stay and double-click **LabourEntryTool.exe**: Python and every package are
inside. Windows may say "Windows protected your PC" the first time (the file is not signed):
*More info* → *Run anyway*. To update, replace the folder with a newer zip; backups, the change
log and settings live in `Labour Entry Tool` in the user folder, so nothing is lost.
`packaging/README.txt` (inside the zip as README.txt) says the same for the office.

The package is built by `.github/workflows/windows-package.yml` on every push to main: it runs the
tests, builds with PyInstaller (`packaging/labour_entry_tool.spec`), checks that the .exe starts,
answers and can load Excel's COM parts, and zips it. Tag `v1.0.0` (etc.) to publish a release.

## Start (Windows, with Python)

1. Get the code once: `git clone https://github.com/Navod-Madushanka/Labour-Entry-Tool.git`
   (later, `git pull` in that folder gets updates).
2. **Double-click `start.bat`.** The first run sets itself up (needs Python 3.11+ and the internet
   once; a few minutes). After that it starts in seconds and opens the browser.
3. On the start page:
   - type your name;
   - **drop the monthly .xlsb on the page, or press Browse…** (Browse opens it in Excel if it
     isn't open yet; a dropped file must already be open in Excel). Workbooks already open in
     Excel are listed too, one click each;
   - the tool reads every sheet and lists the problems. It can **fix wrong sheet dates and day
     types itself** (one click; each fix can be undone), mark a day as a holiday, and **find missing
     employee codes** in the registration files you drop on it. The rest it lists by sheet and
     cell, to fix in Excel and press *Check again*;
   - then it checks what the automation needs (workers, activity list, medical code, formulas
     agreeing with Excel, "start day from previous days", backup folder) and says **Ready**.
     *Start entering data* opens the entry screen at the next day to enter.

Tick **Practice mode** to try everything on a copy in memory: Excel and the file are not changed.
No config file is needed. The month comes from the file name (or the sheet dates); backups and the
change log go to `Labour Entry Tool` in your user folder. `config.yaml` (copy of
`config.example.yaml`) is optional, for other folders or a fixed holiday list.
*Check workbook* (top right of the entry screen) goes back to the start page.

**Several workbooks.** *+ Workbook* opens one more (say INDIAN and SUB CONTRACT); the others stay
open, and the workbook menu in the top bar switches between them. A workbook checked once goes
straight to entry when you switch back to it.

**Workbooks without activity codes.** On the start page, *Check activity codes and hours* is set
per workbook. Untick it for a workbook kept without codes (all hours go to ZIDLE): the activity
boxes, the activity checks and medical leave are left out for it. The tool unticks it by itself
when the workbook's activity list is empty, and remembers the choice for next month's file of
the same kind (`workbooks.json` in the data folder).

**Place names.** Activity codes end with a place on site (`-P`, `-C-8`, ...). After the first
check of a project the start page asks once what each one means; the entry screen then shows
"Parking area" next to `03-11-00-00-P`. The empty Activity box shows the suggested code (from the
worker's usual partners today, their last day and their trade): press Enter to take it.

## Developer setup (Python 3.11+)

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e "backend[dev]"
pre-commit install            # ruff + pytest + "no workbooks in git" on every commit
python -m app.main --open     # from backend/; --demo FILE skips the start page (practice copy)
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

## Entry screen (Phase 3)

```powershell
cd backend
python -m app.main            # open http://localhost:8000 with the workbook open in Excel
python -m app.main --demo "C:/Labour/Labour Entry Sheet October 2026 - INDIAN (2).xlsb"
```

`--demo` loads a copy of the workbook (`.xlsb` or a snapshot `.json`) into memory: the whole
screen works, but Excel is not used and nothing is saved. Good for trying it out or training.

Keyboard flow: **worker** (calling name, name or employee code; Enter picks) → **In** → **Out**
(Enter moves on; ↑/↓ change by 15 minutes; Out earlier than In means overnight) → **activity** →
**hours** (prefilled with the remaining effective hours) → **Enter** adds it to the queue. The times
and activity stay for the next worker. **Esc** clears the form, **Alt+←/→** changes the day.

- The preview shows what Excel will compute (total, effective, OT, ZIDLE, day count) and every
  check. Red (BLOCK) cannot be written; amber warnings need a tick in the queue.
- **Write to Excel** writes the whole queue as one batch, then shows Excel's read-back.
- Suggestions: the worker's usual times, a copy of yesterday, the crew's activity today, recent
  activity codes. **Crew entry** queues many workers at once (by trade, search or saved crew).
- The day list shows what is already on the sheet (Edit = overwrite, Clear). Recent batches can be
  undone. A wrong sheet header shows a red banner with **Fix** (writes F3/H3/F4 after you confirm)
  or **Header is right, write anyway**.
- **Save workbook** saves in Excel; nothing is saved automatically.

## Start a day from previous days (automation)

October's data is very repetitive: 84% of a day's workers also worked the day before, 82% of
entries are identical to at least 5 others that day (crews), crews change together (Out and/or
activity; In is 07:00 in 99% of entries), and 100% of entries book all effective hours.

**Start day from previous days…** builds the whole sheet: each worker's last entry (up to 3 days
back), grouped into crews. Untick who is absent, change a crew's times or activity once for all its
members, and split off (⤴) anyone who did something else; then **Add to the queue** and write as
usual. Workers from the last 2 days start ticked; on a Sunday, last Sunday's workers are ticked
and crews get the usual Sunday shift (07:00–16:00 in October).

Replayed on October: 98% of each day's workers are proposed (about 3 a day to type new) and 78%
of the attendance ticks are right by default. Roughly 165 small actions a day replace about 845
typed fields.

In the queue, **Confirm a warning for every entry that has it** (e.g. `W01 × 8`) replaces ticking
the same warning over and over.

## Medical leave

**Medical leave…** (next to Crew entry) gives a worker a medical line `<calling name> M`, e.g.
`INC-08 M`, with one entry per working day: In 07:00, Out 16:00, activity `00-00-10-00`, hours =
the effective hours (8). Defaults: 10 days from the chosen first day, **Sundays skipped**
(holidays only when *Skip holidays too* is ticked); all fields can be changed.

- If `INC-08 M` is not in Labour Detail yet, it is added in the first empty worker row, copying
  name, trade group, ID and employee code from `INC-08` (so the ERP lines carry his code). Day
  sheets follow Labour Detail order, so the new line appears on every sheet.
- The preview shows each day with Excel's numbers and every check: a day `INC-08` also worked
  (W03), Saturday/holiday OT on a medical day (W09), wrong sheet headers. Warnings need a tick.
- Days past the month end are listed for next month's workbook; only this month's are written.
- Two batches (the new Labour Detail row, then the days), each with a backup and undo. The row
  can only be undone after its days are.

## Employee codes and registration (Phase 4)

The **Codes & registration** tab (or `#codes`) lists every Labour Detail row whose employee code is
blank, `#N/A` or `0`, with a proposed code:

- from a registration file row with the same calling name (`INH22` = `INH-22`), or
- for a role code like `INC-46 M`, its base code's employee code.

You can also type a code the office gave you. Ticked codes are written into `Labour Detail!G` only
after you confirm; this replaces the broken `#N/A` lookup formulas with values. A backup is made
first, and the batch can be undone. Undo cannot bring the formulas back (the tool never writes
formulas), so those cells become blank; the backup still has them. A code that already belongs
to someone else in Labour Detail is never pre-ticked.

The same tab checks the registration files (`registration_files` in `config.yaml`; columns are
found by header, so Indian and supply layouts both work, and a sheet with just calling names is
read as a list):

| Rule | Checks |
|---|---|
| R01 | calling-name format, duplicates |
| R02 | one employee code or ID on different calling names |
| R03 | designation trade spelling (`Supply-Supervior`), trade letter vs designation, trade group vs calling-name prefix |
| R04 | NIC format; NIC vs date of birth and gender (supply rows; Indian rows carry passports) |
| R05 | unreadable or mixed date formats, under 18 on the first day |
| R06 | calling-name list vs registration |

It also shows the next free calling name per prefix and, for this workbook's groups, ID conflicts
between registration and Labour Detail (CSV for the office).

```powershell
cd backend
python -m app.registration "C:/Labour/Labour Registration Supply September.xlsx" --workbook "C:/Labour/...INDIAN (2).xlsb"
python -m app.main --demo "...INDIAN (2).xlsb" --registration "C:/Labour/Labour Registration Supply September.xlsx"
```

## Live Excel (Phase 2)

With the workbook open in Excel, `python -m app.main` attaches to it (the one open book matching
`workbook_pattern`) and serves the write API. Nothing is written unless every entry passes its
checks and every warning is acknowledged.

| Route | What it does |
|---|---|
| `GET /api/status` | connected?, workbook name, unsaved changes, this session's backup |
| `GET /api/master` | workers (with employee-code status), activity codes, day types, sheets |
| `GET /api/days/{sheet}` | one sheet: header checks and every entry with computed values |
| `POST /api/preview` | plan and check entries against the cached sheets; writes nothing |
| `POST /api/days/{sheet}/header-fix` | write F3/H3/F4 (needs `approve: true`) |
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
