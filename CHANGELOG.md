# Changelog

## Changes made in Excel show up without reloading (29 Oct 2026)

Found in testing: an activity code added to Labour Detail in Excel was rejected as unknown,
because the tool kept the copy of Labour Detail it read at the start.

- **Back from Excel:** when the tool's window gets focus again, it reads Labour Detail (workers,
  activity codes) and the open day again, at most once every 3 seconds. A code or worker added
  in Excel appears in the suggestions, and entries changed in Excel show in the day list.
- **Unknown code or worker:** before an entry is called wrong for an unknown activity code (E04)
  or a worker not on the sheet (E07), the server reads Labour Detail and the sheet again, at most
  once every 3 seconds so a code typed letter by letter doesn't trigger a read per key.
- Unchanged: a push always re-reads everything it checks, and *Reload from Excel* still forces a
  full re-read.
- Practice mode works on the copy taken when the file was opened; changes made in Excel reach it
  only after saving and opening the file again on the start page.

## "Usually on the same record" suggestions (28 Oct 2026)

- **The pattern in the October file:** 96% of worker-days have at least one other worker with
  exactly the same entry that day (same In, Out, activities and hours), and 23% are in groups of
  20 or more.
- **Suggestion buttons:** when a worker is picked, the form shows up to 12 workers who most
  often shared that exact entry on the same day in the last 10 days, more recent days weighing
  more. Workers already entered or waiting for the day are left out. "9/10" = together on 9 of
  the last 10 days. A click adds the worker to "Same entry also for" and the list re-ranks around
  everyone chosen so far; "add all" adds the whole list.
- **Measured:** replaying October in entry order and clicking only correct suggestions, 65% of
  worker names would be one click instead of typing (2,264 of 3,504).

## Same entry for several workers (28 Oct 2026)

- **Several names at once:** type them in the Worker box, separated by commas, e.g.
  `INB-01, INB-02, INB-05 ⏎ 7 ⏎ 19 ⏎ code ⏎ ⏎`. The first becomes the worker and the others get
  exactly the same entry: times, activities, hours, additional hours and remark. A pasted
  column of names becomes a comma list.
- **"Same entry also for" row** under the worker card: add more names (search with ↑/↓ and
  Enter; a comma list works too), add a saved crew with one click, remove one with ×. Backspace
  on the empty box removes the last name; Enter on it moves on to Time In. Workers already
  entered for the day are marked.
- The Add button shows how many will be added ("Add 3 workers"). Names that match nothing are
  reported ("Not found: XYZ-99") while the others are kept. Each worker is checked separately in
  the waiting list and on the manpower sheet.
- New browser test `frontend/e2e/same-for-many.cjs`.

## Daily stories from GitHub, traditional tales (28 Oct 2026)

- **New stories without updating:** stories now live in `stories/stories.json` at the top of the
  repository. The file is built into the app, and the app fetches a fresh copy from GitHub
  (raw.githubusercontent.com) at most once a day. Without internet it keeps the last copy, then
  the built-in one. Downloaded stories are checked (shape and size, shown as plain text) before
  use. The day's story stays fixed once its first chapter is open.
- **Real tales replace the invented ones:** traditional tales, researched and retold with their
  source credited under each chapter:
  - *Nasreddin Hodja: Seven Short Tales*: "Do you know what I'm going to say?", "Eat, my coat,
    eat!", the cauldron that had a baby, the ring under the streetlamp, riding backwards, the
    smell of the soup, and "Whom do you believe?".
  - *Andare, the King's Jester*: behave like an ox, the king's sugar, moving the hill, the golden
    mango, the eggs in the pond, the minister who couldn't sleep, and the last joke.
  - *Mahadenamutta and His Five Pupils*: the wise man, waiting for the river to sleep, sowing
    without footprints, the missing pupil, and the goat and the pot.
- Stories can have 1 to 7 chapters; the top bar shows progress out of the day's total.
- The hidden items now come from these tales (the dead cauldron, the king's "sand", the golden
  mango, Pol Bae Muna's torch…).
- `backend/tests/test_stories.py` checks the stories file.

## Lighter and faster (28 Oct 2026)

Measured on the October INDIAN workbook (practice mode, same machine):

| | Before | After |
|---|---|---|
| Start-up until ready | 8.8 s | 1.9 s |
| Reading the .xlsb (31 day sheets) | 9.0 s | 1.4 s |
| Python imports at start | 1.1 s | 0.45 s |
| Month of day sheets sent to the browser | 4.6 MB | 1.9 MB |
| App bundle (gzip) | 78 KB | 39 KB |
| Installed packages (disk) | 58 MB | 41 MB |
| Backend test suite | 32 s | 13 s |

- **Day sheets are read with python-calamine** (Rust); Labour Detail is still read with pyxlsb so
  `#N/A` codes are kept. The two readers give an identical snapshot of the October workbook;
  pyxlsb is the fallback if calamine is missing.
- **Day views no longer send Excel's cached formula results** (two thirds of each day; the
  screen uses the computed values).
- **openpyxl is loaded only when a registration file is read.**
- **Plain `uvicorn` instead of `uvicorn[standard]`:** uvloop, httptools, watchfiles, websockets
  and python-dotenv are not needed for a local single-user server.
- **The UI runs on Preact (preact/compat)** instead of React: the same components, half the
  bundle.
- `ROADMAP.md` keeps the parked plans: daily stories from a file on GitHub, the update prompt in
  `start.bat`, and the open items.

## Daily story (28 Oct 2026)

- A small reward for entering data, text only (about 4 KB compressed, no images):
  - **Chapter 1** of the day's story unlocks on the first push once 15 workers have been pushed
    to Excel that day.
  - **The other 6 chapters** unlock as hidden points grow: one point per worker pushed, half a
    point more for each entry without warnings.
  - **Three funny site stories** rotate, a new one each day: the helmet-stealing crow, the singing
    concrete mixer, and the case of the empty tea flask.
  - **Hidden items:** a push now and then "finds" one of 12 funny items for a collection.
  - **Never in the way:** a small note in the corner that can be ignored, a 📖 button in the top
    bar to read (it shows chapters unlocked, e.g. 1/7), and "Turn the story off" (click 📖 to turn
    it back on). Progress is kept in the browser and resets each day.
- Typing into Time In, Time Out, Additional hours or an activity code now replaces what is there
  (the box's text is selected on focus), so the times and codes kept from the last worker can be
  overtyped without deleting them first.

## Entry screen design pass (28 Oct 2026)

- **Plain words everywhere:** every problem the API returns now carries its plain-language form
  (`Issue.plain`: title, where, what, what to do). The entry form, queue, day list, header banner
  and dialogs show that instead of rule codes and messages. A warning is confirmed with an
  "It's correct" tick.
- **Entry form:**
  - numbered steps (1 Worker, 2 Time In, 3 Time Out, 4 Activity code) and larger 16 px inputs;
  - example hints under the time boxes, and form errors in plain words;
  - only the filled activity lines plus one empty line are shown;
  - Quick fill tools (Start day from previous days, Crew entry, Medical leave) are grouped at the
    top as their own buttons; "Add worker" is the main button;
  - a keyboard help line.
- **Faster keyboard flow:** Enter on an activity code moves to the next activity line, because the
  hours fill themselves; Enter on an empty activity line adds the worker. A one-activity worker is
  `name ⏎ 7 ⏎ 19 ⏎ code ⏎ ⏎`.
- **"This worker's day" panel** (was "Excel will show"): worked hours in large type, then Normal,
  Overtime, Time at work, hours with no activity (only when there are some) and how the day
  counts. The border is green, yellow or red by status. On the 22:00 warning, a one-click
  "Yes, they had dinner" fills -1 additional hours and the remark.
- **Day bar:** the full date ("Monday, October 26, 2026"), day type and workers entered.
- **Queue and day list:** plain column names (Worked, Overtime, Status) with no ZIDLE; a
  "✓ Ready" pill; "Replace what's in Excel" instead of "Overwrite existing"; "Remove all" and
  "Clear" ask before acting; success messages say what happened and remind you to save.
- The push bar is no longer sticky (it was covering the sheet).

## Check against the manpower sheet (28 Oct 2026)

- The manpower sheet is now part of the entry screen, under the form, and updates live: each entry
  added shows up as a new worker column straight away. **Push N entries to Excel** sits at its
  bottom (it replaces the Write button in the queue), so the sheet is always seen before writing.
  The queue below still lists the problems and the Edit/Remove links.

- Each sheet starts with the day's date in large type ("Monday, October 26, 2026") and the time it
  was entered. Every tick shows that activity's hours in brackets, e.g. ✓ (5.5).

- **Check as manpower sheet** (in the queue) draws the waiting entries like the paper "Daily
  record of manpower" form, so they can be compared with the paper before anything is written:
  - workers across the top, 10 per sheet (more workers spill onto further pages);
  - the Emp.No (calling name), In, Out, Normal Hrs and OT rows, with Normal and OT split the
    way Excel does (8 h on a Normal Day, 5.5 on Saturday, 0 on a Sunday or holiday);
  - activity codes down the side, with a tick where a worker did that activity (with each line's
    hours when a worker has more than one);
  - the date, sheet number, prepared by, project and day type from the day sheet.
  Workers already in Excel for that day can be shown too, in grey. *It matches: write to Excel*
  writes the queue. The Description column stays blank because the workbook has no activity
  descriptions.

## Two or three activities: hours shared out automatically (28 Oct 2026)

- Activities whose Hours box is left empty share the worked hours equally, in quarter hours:
  7-19 (11 h) over 2 activities gives 5.5 + 5.5, and over 3 gives 3.75 + 3.75 + 3.5. Hours
  typed on one line are taken off first; the rest is shared by the empty ones. The shared hours
  show in green as "(auto)" and follow the times when they change.

## One activity: hours filled in automatically (28 Oct 2026)

- With one activity and its Hours box left empty, the entry gets all the worked hours: Out - In,
  less 1 h for lunch (Out after 12:00), or 2 h for lunch and dinner (Out after 22:00), plus any
  additional hours. Examples: 7-19 is 11 h, 7-23 is 14 h, 7-03 next morning is 18 h. The box
  shows the number as "11 (auto)" and follows the times when they change. Typing a number
  overrides it, and with several activities the hours are typed as before.

## Problems in plain words (28 Oct 2026)

- The start page describes every problem the way an Excel user sees it, with no rule codes or
  tool terms ("effective", "ZIDLE", "ERP", "block"). Each problem has a short title, where it is
  (sheet, row, column name and cell, worker) and what is wrong with the actual values, plus a
  "What to do" line. Problems are grouped by what is wrong; the summary reads "8 mistakes to
  correct, 712 things worth checking". The wording comes from `app/domain/plain.py`.

## Guided start page (28 Oct 2026)

- **Start page:** the tool now starts empty. Drop the workbook on the page, browse to it, or pick
  one that is already open in Excel. Then it checks the workbook, offers fixes, runs the readiness
  checks and says when entry can start:
  1. *Check and fix*: the full health check of the live workbook. The tool can fix sheet dates and
     day types (one click per sheet, or all at once, with undo). "It's a holiday" / "Keep as
     holiday" marks a date as a holiday instead. Missing employee codes can be filled from
     registration files dropped on the page. Errors it can't fix are listed by sheet, cell and
     worker, with *Check again*. Warnings and notes are folded away.
  2. *Ready*: workbook and mode, month, headers, workers, employee codes, activity list, medical
     code, Excel formulas agreeing with the tool, the day builder for the next day, and the
     backup folder. *Start entering data* opens entry at the next day to enter.
- **Practice mode** on the start page: a copy in memory, so nothing reaches Excel or the file. It
  is always on where Excel can't be driven.
- **No config needed:** the month comes from the file name ("October 2026"), falling back to the
  sheet dates. Holidays are set on the start page. Backups and the audit database go to
  `~/Labour Entry Tool` ($LABOUR_TOOL_DATA). `config.example.yaml` is no longer loaded
  automatically.
- **`start.bat`:** double-click to set up on first run and then start; it opens the browser.
- `--demo FILE` still goes straight to entry; *Change workbook* returns to the start page.

## Code review fixes (27 Oct 2026)

- **Excel left on manual calculation:** if switching calculation back failed after a batch (Excel
  busy at that moment), the error was lost and the workbook could stay on manual. Each restore
  step (calculation, screen updating, recalculation) is now tried separately, and a failure is
  reported with the steps to fix it in Excel.
- **Read-back failure after a good write** (entries, employee codes): the batch stayed "pending"
  and the UI reported a failure for data that was written. Now: status written, audit done, and a
  message that only the check failed.
- **Labour Detail read capped** at the worker rows + 500 (formatting far down could stretch Excel's
  used range to a million rows).
- **Activity list gaps:** a blank cell in column L no longer hides the codes below it.
- **"7.30" typed as a time** now means 07:30 (it was read as 7.3 decimal hours = 07:18 and
  rejected). .15/.30/.45 are never quarter-hour decimals, so this is unambiguous.
- **Queue:** entries added while a write is running are no longer cleared when it finishes.
- **Reload from Excel** on the day bar, for changes made directly in Excel.
- **Medical leave** from a sheet that is not a day of the month now explains instead of failing.
- Browser smoke tests for medical leave and the codes page added to `frontend/e2e/`.

## Automation: start a day from previous days (27 Oct 2026)

Patterns measured on the October INDIAN data (4,075 worker-days): 84% of a day's workers worked
the day before; 82% of entries are identical to ≥5 others that day; crews change together (Out
and/or activity, In almost never); 97% have one activity and 100% book all effective hours;
Sundays use 07:00–16:00 (74%) and a different set of workers.

- `domain/daybuilder.py`: carry each worker's last usable entry (≤3 days back) into crews of
  identical entries; attendance ticked for 1–2 days back (85%/64% came) and unticked for 3 (55%);
  Sundays tick last Sunday's workers and apply the most used Sunday shift. Single-activity crews
  leave hours to be computed from In/Out.
- `GET /api/days/{sheet}/build`; UI **Start day from previous days…** with crew-level edits,
  untick/split per worker, then the normal queue, checks, write and read-back.
- Queue: one click confirms a warning type for every entry that has it.
- Golden replay test: ≥97% of workers proposed, ≥75% of attendance ticks right.

Demo (sheet 26): 101 workers in 15 crews built in 0.4 s; 91 queued, checked in 0.35 s, written in
one batch after 2 bulk confirmations.

## Medical leave (27 Oct 2026)

Office practice (from Navod): a worker on medical leave gets a medical line `<base> M` (e.g.
`INC-08 M`) with 10 days, Sundays skipped, In 7 Out 16, activity `00-00-10-00`.

- `domain/medical.py`: medical name and working-day planning (Sundays skipped, holidays optional,
  days past the month listed separately).
- `service.medical_preview` / `medical_leave`: adds the line to the first empty Labour Detail row
  when new (copying name, trade, ID, employee code from the base; approved, audited, undoable only
  once its days are undone), then writes the days as one batch through the normal checks.
  Previews plan against the sheets as they will be (the new block already named).
- New warning W09: a medical day with OT (Saturday 2.5 h, holiday 8 h, as Excel computes it).
- Write guard: Labour Detail A–H only for the specific new row. The fake workbook now derives
  each block's column A from Labour Detail like the real formula.
- API `POST /api/medical/preview`, `POST /api/medical` (needs `approve`); UI **Medical leave…**.

On the INDIAN demo, `INC-08` from 26 Oct: row 251 added, 6 days written (26–31 Oct), 4 listed for
November; from 20 Oct the preview flags 21–24 Oct (he worked those days) and Saturday OT.

## Phase 4 — Employee codes and registration (27 Oct 2026)

**Built**
- `registration/reader.py`: openpyxl reader that finds columns by header text (Indian layout with
  the extra Designation column, supply layout, or a plain calling-name list). Real Excel dates are
  kept as ISO text.
- `registration/checks.py`: R01–R06 (calling names, duplicate codes/IDs, designation/trade
  spelling, NIC format and NIC vs date of birth/gender with the Feb-29 rule, unreadable/mixed dates,
  under 18, list vs registration) and the next free calling name per prefix.
- `registration/proposals.py`: code proposals for blank/#N/A/0 rows (registration by normalised
  calling name, else base code), soft notes (ID differs, code given twice in the registration),
  hard conflicts (code already used by another person); ID cross-check registration ↔ Labour
  Detail (name differs / one character / not found).
- `service.write_codes`: approved writes into Labour Detail G with a fresh re-check per row,
  backup, audit, read-back; undo restores codes (former `#N/A` formulas come back blank, with a
  note). The write guard is now sheet-aware: day-sheet inputs only on day sheets, F3/H3/F4 only
  for an approved header fix, Labour Detail G only for approved codes.
- API `/api/registration` (+ CSV), `/api/codes`, `/api/codes/conflicts.csv`, `/api/codes/write`;
  CLI `python -m app.registration`; `--registration` for the server/demo; UI tab
  **Codes & registration**.

**On the files provided** (September 2026 supply registration + its 73-name list): 17 findings,
including 5 dates of birth that disagree with the NIC, 3 invalid NIC numbers, 2 unreadable dates
of birth, 2 dates written yyyy.mm.dd, `Supply-Supervior` twice, 1 trade group ≠ calling name, and
2 names only on the list (checked by `test_golden_registration.py`).

**Not possible yet:** the plan's Indian numbers (36 codes from the registration, 13 duplicate XIN,
29 ID conflicts) need the Indian registration file, which is not available. These supply files
have no employee codes and no Indian workers, so for INDIAN only `INC-46 M` (base code) can be
proposed; the other 37 can be typed in from the office's list.

## Phase 3 — Entry UI (27 Oct 2026)

**Built**
- React + TypeScript + Vite app (`frontend/`), built into `backend/app/static/app/` and served at
  `/`. Committed build, so the office PC needs only Python.
- Name prompt (once per browser), status bar (workbook, DEMO badge, unsaved changes, Save
  workbook), day bar with entry counts and a header banner (H01–H03) offering **Fix** or **write
  anyway**.
- Keyboard-first entry form: worker search (calling name/name/employee code, fuzzy and
  hyphen-free), HH:MM times with 15-minute arrow steps and automatic overnight, 5 activity lines
  with hours prefilled from the remaining effective hours, additional hours and remark.
- Live preview from the server (total, effective, OT, ZIDLE, SUMMARY day count, BP Bill day) with
  every check inline; existing entry notice with **Edit** (overwrite).
- Suggestions: usual In/Out, copy of yesterday, the trade's activity and times today, recent codes;
  activity codes ordered by use this month. Month stats per worker (days, hours).
- Queue re-checked on the server whenever it changes (batch entries see each other); warnings are
  confirmed per entry; **Write to Excel** commits one batch and shows the read-back.
- Crew entry: by trade, search or saved crew (browser storage); same as the form or copy of
  yesterday. Day list with Edit/Clear. Recent batches with Undo.
- Backend: cached master/day reads for previews (writes still re-read), `GET /api/master`,
  `GET /api/days/{sheet}`, W02/W03 for new entries (`domain/crosscheck.py`), header fix with
  approval, audit and undo (`POST /api/days/{sheet}/header-fix`), `python -m app.main --demo`.

**Demo**
```powershell
python -m app.main --demo fixtures/sanitized/indian_2026-10.json   # http://localhost:8000
python -m pytest backend/tests -q   # 243 passed with the real .xlsb in fixtures/private/
node frontend/e2e/ui-smoke.cjs      # keyboard flow, crew, edit, undo, header fix: passed
```
On the INDIAN demo: 248 workers queued for one sheet are checked in 0.8 s; the 18 flagged W03
are the role-suffix codes and shared IDs booked at the same time (correct). Two bugs found by the
browser test and fixed: focus moved a tick late after Enter (fast typists lost keys), and the form
took focus from the name prompt.

**Not verified yet:** the "done when" items on real Excel (writes, read-back, timing) wait for the
Phase 2 smoke test on Windows.

## Phase 2 — Live Excel adapter (27 Oct 2026)

**Built**
- `domain/writes.py`: `EntryInput` → `EntryPlan` (ranges, old values, preview, issues) with the
  write-time checks E07 (calling name in exactly one block), E08 (overwrite must be confirmed) and
  E09 (only §5.4 input cells). BLOCK stops a write; every WARN and H01/H02 must be acknowledged.
- `service.EntryService`: preview, commit, read-back, undo, save. A commit re-reads each day sheet,
  plans every entry, writes only if all pass: backup → audit rows (pending) → one batched write →
  read-back of Excel's E/ZIDLE/OT and the written inputs against the preview.
- Undo writes the old values back through the same guard; refused when a cell changed since or the
  block now belongs to another calling name. Works for failed (partly written) batches too.
- `audit/store.py` (sqlite, before/after per cell), `audit/backups.py` (copy before the first write
  of a session, newest N kept), `excel/worker.py` (one thread runs every workbook call in order).
- `excel/xlwings_adapter.py`: attach by name pattern, bulk reads into the shared grid builder,
  batched writes with calculation paused and restored, SaveCopyAs, save, busy retry with backoff.
- `excel/grid.py`: grid → models code shared by the pyxlsb reader and the live adapter.
- `excel/fake_adapter.FakeWorkbook`: writable in-memory workbook that recalculates D, E and M–Q
  like Excel. Golden test: it reproduces Excel's cached results for all 4,075 INDIAN entries.
- API: `/api/status`, `/api/preview`, `/api/entries`, `/api/batches`, `/api/batches/{id}/undo`,
  `/api/save`. Config: `audit.db`, `excel.enabled`, `excel.busy_timeout`.
- `scripts/excel_smoke.py`: the Phase 2 "done" check for a copy of the workbook in Excel
  (`--fake snapshot.json` runs it without Excel).

**Demo**
```powershell
python -m pytest backend/tests -q   # 232 passed with the real .xlsb in fixtures/private/
python scripts/excel_smoke.py --fake fixtures/sanitized/indian_2026-10.json   # ALL PASSED
```
Golden rehearsal on the fake: the busiest day (200+ workers) re-entered on sheet 26 as one batch,
every read-back equal to the preview, undo leaves the sheet exactly as before.

**Decision:** PLAN.md §8 says to write `J:L` as a 5×3 block, but §5.4 forbids writing `L` in
block rows 2–5. The tool writes `J:K` (5 rows) and `L` (row 1) as separate ranges.

**Not verified yet (needs Windows + Excel):** the smoke test on a copy of the INDIAN workbook:
protection errors, Excel's recalculated values vs preview, undo, backup, and write timing (§8: if
one write takes > 3 s, write in batches only). Cross-entry warnings W02/W03 for new entries come
with the entry UI (Phase 3).

## Phase 1 — Health check (27 Oct 2026)

**Built**
- `domain/validators.py`: the §7 catalogue (`RULES`) and per-entry checks E01–E06, W01, W04–W06,
  W08, M06, plus header checks H01–H03. Pure functions, reused by the entry UI in Phase 3.
- `domain/health.py`: `run_health(snapshot, month_start, holidays)` adds the month-wide checks:
  M01–M05 (master data), W02 (< 8 h rest before the next sheet's shift), W03 (same base code,
  employee code or ID with overlapping times), W07 (upload lines per worker with a blank/0
  employee). H01/H02 messages state the impact (worker-days, hours, OT under the right rule).
- `rules.upload_line_count`: lines Excel builds per entry (K filled and non-zero, ZIDLE ≠ 0, OT > 0).
- CLI `python -m app.health` (console summary + CSV), FastAPI app `python -m app.main` with
  `GET /api/health`, `/api/health.csv`, `/api/rules` and a self-contained report page at `/health`
  (filters, search, editable holidays). The page moves into the React frontend in Phase 3.
- Config: `workbook_file` (the `.xlsb` the health check reads). Holidays stay editable in
  `config.yaml`, per run with `--holiday` / `--no-holidays`, or on the page. LAN stays off unless
  `allow_lan: true`.
- Messages use calling names only, never names or ID numbers.

**Demo** (INDIAN snapshot; every Appendix B item with its count, checked by `test_golden_indian.py`)
```powershell
python -m app.health "fixtures/private/Labour Entry Sheet October 2026 - INDIAN (2).xlsb"
# Errors: 7   Warnings: 712   Info: 12   -> 731 rows in the CSV
python -m pytest backend/tests -q   # 159 passed, 8 skipped (with the real .xlsb in fixtures/private/)
```

**Severity choices** (the plan gives none for M rules): M01–M03 and M06 are WARN, M04/M05 INFO.
Existing entries are reported under their own E/W rule (M07 in the plan).

**Not in this phase**
- Registration cross-checks (§5.8): need the registration `.xlsx`, so they come with the
  registration reader in Phase 4.
- Holidays for 2026 are still unconfirmed (§12 q5). The example config lists only 2026-10-25.

## Phase 0 — Verified against the real INDIAN workbook (27 Oct 2026)

The 26 Oct snapshot (SHA-256 matches PLAN.md §5.1) passes every golden test: Appendix A, and
effective / OT / ZIDLE recomputed = Excel's cached values for 4,074/4,074 complete entries.

**Fixed**
- `xlsb_reader`: the activity list stopped only at an empty cell, but `Labour Detail!L312:L502`
  hold a single space, so it read 500 codes. Whitespace-only now ends the list (309 codes).
- `rules.zidle_hours`: Excel's ZIDLE cell (P, block row 6) is
  `IFERROR(E - (IF(P1="",0,P1) + … + IF(P5="",0,P5)), "")`, decoded from the `.xlsb` formula
  records. It uses `+`, not SUM, so a non-numeric hours cell (`INC-74` day 15, `13\``) hides the
  whole ZIDLE line. `Computed.zidle` is now `None` in that case; numeric text is coerced like `+`.
  `activity_hours` keeps SUM semantics for display and allocation counts.
- Golden test: Appendix A's "73 distinct codes" counts codes as typed. Trimmed it is 72, because
  `INC-41` day 16 has `" 03-11-00-00-C-8 "` (M06).

**Demo**
```powershell
python -m pytest backend/tests -q   # 110 passed, 8 skipped (synthetic .xlsb needs Excel)
```

## Phase 0 — Foundations (26 Oct 2026)

**Built**
- Repo scaffold (PLAN.md §4): `.gitignore` covering every privacy path, `config.example.yaml` plus a
  Pydantic config loader, `ruff.toml`, and pre-commit hooks (ruff lint/format, pytest, and a hook
  that refuses `.xlsb`/`.xlsx`/`fixtures/private/`). The hooks run offline from the venv.
- `domain/models.py`: Worker, ActivityCode, DayHeader, Entry, Computed, Issue and snapshot models.
  Cells are stored raw. Excel errors are kept as text (`"#N/A"`).
- `domain/rules.py`: effective, OT, ZIDLE, total, SUMMARY/BP Bill day counts and the quarter grid,
  mirroring §5.5 including the boundary quirks. Day-type matching is case-insensitive and not
  trimmed, like Excel's `=`. Activity hours are summed like Excel `SUM` (text is ignored).
- `domain/codes.py`: calling-name grammar, normalisation (`INH22` ≡ `INH-22`), base/role-suffix
  person key, employee-code status (valid / missing / `#N/A` / 0 / invalid), activity trim and shape.
- `excel/xlsb_reader.py`: pyxlsb bulk reader for Labour Detail, the activity list, day types, all
  31 headers and all 500 blocks per sheet (inputs plus cached D/E/M–Q). pyxlsb returns errors as hex;
  the reader translates them to Excel error text.
- `excel/fake_adapter.py` with JSON save/load; `sanitize.py` with deterministic fakes that keep
  equality.
- `scripts/snapshot_fixture.py` (real `.xlsb` → sanitized JSON) and `scripts/make_synthetic_xlsb.py`
  (fake template workbook built by a hidden Excel instance, used for reader tests).

**Demo**
```powershell
python -m pytest backend/tests -q   # 105 passed, 12 skipped (golden: no INDIAN file yet)
python scripts/snapshot_fixture.py fixtures/synthetic/template_synthetic.xlsb -o $env:TEMP/snap.json
```

**Not yet verified: the Phase 0 "done" condition.** The real INDIAN workbook was not on this PC.
`backend/tests/test_golden_indian.py` encodes Appendix A and the 4,074/4,074 recompute check, and it
skips until the file is placed in `fixtures/private/`. Some counts depend on interpretations to
confirm against the real file:
- "worker-day with input" = any of G/H/J/K/L/R filled;
- "activity line" = non-blank J in block rows 1–5;
- upload-line counts are derived from the rules (activities + ZIDLE ≠ 0 + OT > 0);
- cached ZIDLE is read from P (block row 6) and cached OT from Q (block row 7).
