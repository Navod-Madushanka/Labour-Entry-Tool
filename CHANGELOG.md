# Changelog

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
