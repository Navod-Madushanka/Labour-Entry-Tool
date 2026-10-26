# Labour Entry Tool — Build Plan

> **Audience:** the coding agent building this tool. Read this whole file before writing code.
> **Owner:** Navod (data entry, Mäga Engineering, KMTT site / project 525M).
> **Status:** v1 plan, 26 Oct 2026. Every workbook fact in §5 was checked against the real files listed in §5.1.

---

## 1. Goal

Data-entry staff type daily labour time (In, Out, activity, hours) into a huge monthly Excel workbook by hand. It has no input validation, and errors go straight into the ERP upload. Build a **web tool that gives search, suggestions and validation, and writes each entry into the original open workbook in real time**. The Excel workbook stays the system of record. **This tool does not replace it.**

v1 focuses on the **INDIAN labour entry workbook** (`Labour Entry Sheet October 2026 - INDIAN (2).xlsb`) and its registration file (`Copy of External labour registeration-Indians.xlsx`).

## 2. Hard rules (never break these)

1. **Excel is the source of truth.** The tool writes only plain values into input cells. Never write formulas, never change formulas, sheets, formatting, filters, names or protection.
2. **Only write the day-sheet input cells in §5.4 "Writable cells".** Two exceptions need explicit user approval: header fixes (`F3`/`H3`/`F4`, rules H01–H03) and `Labour Detail!G` employee codes (Phase 4). Every sheet is protected. Never call Unprotect.
3. **Mirror Excel's rules exactly (§5.5) for previews.** Don't "fix" them. When a rule looks wrong, warn the user (see §7). The office decides on rule changes, not the tool.
4. **All writes go through one queue on one thread.** COM is single-threaded.
5. **Back up before the first write of a session.** Log every write with its old values. Support undo.
6. **Privacy.** The workbooks contain worker names and passport/NIC numbers. Never commit real workbooks or extracted personal data to git, and never send them to any external service. See §10.
7. **Don't guess on open questions (§12).** Ask the user.

## 3. Architecture (decided)

```
[Browser(s)] --HTTP--> [FastAPI app on the Windows PC that has Excel]
                          ├── Excel worker thread --COM/xlwings--> [Excel: INDIAN (2).xlsb, open]
                          ├── openpyxl ------------------------> registration .xlsx (read-only)
                          ├── pyxlsb (read-only, tests/health check without Excel)
                          └── audit.sqlite + backups/
```

- **Backend:** Python 3.11+, FastAPI, Pydantic, **xlwings** (drives the running desktop Excel through COM), pywin32, pyxlsb, openpyxl.
- **Frontend:** React + TypeScript + Vite. It's built to static files that FastAPI serves, so users only open a URL.
- **Runs on:** the Windows 10/11 PC where desktop Excel has the workbook open. Other PCs on the LAN can use it through a browser if LAN access is enabled in config (default: localhost only).
- **Why this route** (don't re-open it without asking):
  - The workbook is `.xlsb`. The Microsoft Graph Excel API supports only `.xlsx`, and Office Add-ins are documented as supported only in Open XML formats.
  - Editing the file on disk (SheetJS, openpyxl) doesn't work while Excel has it open, and the free Python libraries can't write `.xlsb` (pyxlsb is read-only).
  - xlwings drives Excel itself, so `.xlsb`, sheet protection and live updates all work.

## 4. Repository layout

```
labour-entry-tool/
  backend/
    app/
      main.py                 # FastAPI app, static frontend, startup
      config.py               # loads config.yaml
      api/                    # routes: status, workers, activities, days, preview, entries, undo, health, master, save
      domain/
        models.py             # Pydantic: Worker, ActivityCode, DayHeader, Entry, Computed, Issue
        rules.py              # pure functions mirroring Excel formulas (§5.5)
        codes.py              # calling-name grammar + normalisation (§5.7)
        validators.py         # validation catalogue (§7)
        health.py             # whole-workbook checks (Phase 1)
      excel/
        adapter.py            # WorkbookAdapter protocol (read master, read day, write batch, read-back)
        xlsb_reader.py        # pyxlsb, read-only (tests, health check, no Excel needed)
        xlwings_adapter.py    # live Excel, Windows only
        fake_adapter.py       # in-memory, for unit tests
      registration/reader.py  # openpyxl reader for registration files
      audit/                  # sqlite audit log, undo, backups
    tests/
  frontend/                   # React + TS + Vite
  scripts/
    snapshot_fixture.py       # real .xlsb -> sanitized JSON fixture (§9)
  fixtures/
    private/                  # REAL files, git-ignored, never committed
    sanitized/                # generated JSON fixtures, safe to commit
  config.example.yaml
  .gitignore                  # must include fixtures/private/, backups/, *.xlsb, *.xlsx, audit*.sqlite
  PLAN.md                     # this file
```

Keep all Excel/COM code inside `excel/`. Everything in `domain/` is pure Python and runs on Linux/CI with no Excel.

---

## 5. The workbook (domain spec)

### 5.1 Files and snapshots used for this spec

| File | SHA-256 (snapshot 26 Oct 2026) |
|---|---|
| `Labour_Entry_Sheet_October_2026_-_INDIAN_2.xlsb` (14.3 MB) | `89a434ac2846f7bf6de21e42f66463df36a7322b1f2ce6b3ead3bc1fff4d60dd` |
| `Copy_of_External_labour_registeration-Indians.xlsx` | `1bf740d9884ed3be68bb4e2dfcd89971d2f1840d37c2c59c72a641f6c243e186` |
| `Labour_Entry_Sheet_October_2026_-_SUB_CONTRACT.xlsb` (later phase) | `fa8439750c838ebd6f49cd06348d4802574ee0b5ce94d9874777db5476f0b573` |

One template serves all entry workbooks. INDIAN and SUB CONTRACT have identical sheets, layout, formulas (47 key formula cells compared), protection and conditional formatting. Only the data differs. **Design for the template, configure per workbook.**

### 5.2 Sheets

| Sheet | Role | Tool access |
|---|---|---|
| `Labour Detail` | Master list: 1 row per calling name, plus the activity code list in column L | read; write only employee codes in Phase 4 |
| `Business Partner Detail` | BP code → name (9 rows) | read |
| `1` … `31` | One sheet per day of the month | read + write input cells |
| `SUMMARY ` (trailing space!) | Month totals per worker (formulas) | read-only |
| `BP Bill` | Hours per worker per day → cost (formulas, AutoFilter + SUBTOTAL) | never touch |
| `Time Card (External)` / `(Internal)` | Printable per-worker cards (formulas) | never touch |
| `Deduction (External)` / `(Internal)`, `Sheet1` | Advances / leftovers | never touch |

There are 5 external links. Links 1–4 are dead: three old ERP exports and an old copy of this workbook. Link 5 points to `Copy of External labour registeration-Indians.xlsx` inside someone's Outlook temp folder, so it's dead on other PCs. Ignore them all.

### 5.3 `Labour Detail`

- Row 2 = headers. **Rows 3–502 = 500 worker slots** (INDIAN: 248 used, the rest blank). Row 503 = `End`.
- Columns (A–H and L are unlocked; N is locked):

| Col | Header | Notes |
|---|---|---|
| A | Calling Name | the site code everyone types (§5.7) |
| B | Name | |
| C | Trade Group | words: Barbender, Carpenter, `Masan`(sic), Helper, Rigger, Cook, Cook Helper, `Superviser`(sic) |
| D | NIC No. | INDIAN: passport-style IDs; a few stored as numbers |
| E | Daily Rate | empty in INDIAN |
| F | Business Partner | empty in INDIAN |
| G | Employee Code | the ERP key. Both `X#####` and `XIN###` are **real ERP codes** (confirmed by the office). G214:G250 hold a broken VLOOKUP into link 5 and show `#N/A`. G193 (`INH-21`) = 0 |
| H | EPF No | empty |
| L | "WBS Code" | **Not per worker.** It's the **activity code list**, L3:L311 = 309 codes (3 duplicates, 1 with a leading space) |
| N3:N6 | day types | `Normal Day`, `Saturday`, `Sunday`, `Holiday` (locked) |

- Day sheets show workers in **Labour Detail row order** (block k ↔ Labour Detail row 3+k).

### 5.4 Day sheets `1`–`31`

**Header** (unlocked): `F3` = date (Excel serial), `H3` = day type (text, one of N3:N6), `F4` = sheet no., `F5` = prepared by, `C6` = project (`KMTT`). Row 8 = column headers.

**Worker blocks:** 500 blocks × 7 rows. Block k (0-based) = rows `9+7k` … `15+7k` (first block rows 9–15, last ends at row 3508). Row 3509 = `SUBTOTAL(9,E9:E3508)`.

| Col | Content | Type |
|---|---|---|
| A | calling name (`='Labour Detail'!A{3+k}`) | formula |
| B, C, F | name, BP, trade group (VLOOKUP Labour Detail, block row 1 only) | formula |
| D, E | total hours, effective hours (block row 1) | formula |
| G, H | **In, Out**, decimal hours (block row 1) | input |
| I | signature | locked |
| J, K, L | **activity code, hours, additional hours** (block rows 1–5) | input |
| M–Q | ERP upload line: Employee code, Date, Activity, Hours, Overtime hours | formula |
| R | remarks | input |

Block row 6 = automatic `ZIDLE` line (unallocated hours). Block row 7 = automatic `OT` line.

**Writable cells** (verified lock flags). The tool writes **only** these:
- Block row 1: `G` (In), `H` (Out), `J`/`K` (activity 1 + hours), `L` (additional hours), `R` (remark)
- Block rows 2–5: `J`/`K` (activities 2–5)

**Do not write** G/H/L in block rows 2–7 (unlocked, but the formulas ignore them, so the value would be silently lost), J/K in rows 6–7 (locked), I, or any formula column. Write G:H and J:L as **separate ranges** because I is locked.

### 5.5 Rules (mirror exactly; verified on 4,074/4,074 INDIAN and 1,359/1,359 SUB CONTRACT entries)

Times are **decimal hours**: `7.5` = 07:30. Overnight Out is written past 24 (`30` = 06:00 next day). Times are in quarter hours (fractions seen in the data: .00, .50, .75).

```
add = L (block row 1 only; blank = 0)
total     = Out - In
effective = if Out > 22:  (Out - In) - 2 + add      # lunch + dinner
            elif Out > 12: (Out - In + add) - 1      # lunch
            else:          Out - In + add
OT        = effective - 8    if day_type == "Normal Day"
            effective - 5.5  if day_type == "Saturday"
            effective        if day_type in ("Sunday", "Holiday")
            (shown only if > 0)
ZIDLE     = effective - sum(activity hours, block rows 1-5)   (line exists if != 0; can go NEGATIVE)
upload    = one line per activity (code, hours) + ZIDLE line + OT line,
            each with Employee = Labour Detail G (blank if lookup fails), Date = sheet F3
```

The boundary quirks are real and must be mirrored (then warned about, §7):
- An 18→19 shift gives effective 0, because lunch is deducted whenever Out > 12, even with In ≥ 12.
- A 7→22 shift loses only 1 h, because Out must be **> 22** for the dinner hour. Staff type `-1` as Additional Hours to compensate (14× in INDIAN).

Day counts (roll-ups, read-only, for display):
- **SUMMARY:** Normal Day with effective > 5 = 1, else 0.5; Saturday = 1; Sunday/Holiday = 0.
- **BP Bill:** a day counts at effective ≥ 6.

Rule test cases:

| In | Out | Add | Day type | Effective | OT |
|---|---|---|---|---|---|
| 7 | 19 | 0 | Normal Day | 11 | 3 |
| 7 | 12 | 0 | Normal Day | 5 | — |
| 18 | 19 | 0 | Normal Day | 0 | — |
| 18 | 23.5 | 0 | Normal Day | 3.5 | — |
| 7 | 22 | 0 | Normal Day | 14 | 6 |
| 7 | 22 | -1 | Normal Day | 13 | 5 |
| 7 | 22.5 | 0 | Normal Day | 13.5 | 5.5 |
| 7 | 30 | 0 | Normal Day | 21 | 13 |
| 7 | 19 | 0 | Saturday | 11 | 5.5 |
| 7 | 19 | 0 | Sunday / Holiday | 11 | 11 |

### 5.6 Roll-up sheets

SUMMARY, BP Bill, the time cards and the deductions all compute from the day sheets through formulas. The tool **reads** SUMMARY for display at most and never writes to any of them.

### 5.7 Identity, codes and normalisation

**Calling name grammar:** `^(?P<group>[A-Z]{2})(?P<trade>[A-Z]{1,2})-(?P<num>\d{2,3})(?: (?P<role>[A-Z]{1,3}))?$`
- INDIAN group = `IN`. Trades: `B` Barbender, `C` Carpenter, `H` Helper, `M` Mason, `R` Rigger, `S` Supervisor (other workbooks also use `E`, `P`, `PL`, `W`).
- **Role suffix** (`INB-04 CH`, `INC-18 C`, `INC-22 CH`, `INH-04 CH`, `INC-46 M`): the same person, with the same employee code, booked under a second trade. Treat the base code and its role code as one person for overlap checks.
  - Verified for 4 of the 5: same ID and same employee code as the base.
  - `INC-46 M` has no ID or employee code. Its base `INC-46` has one, which Phase 4 proposes copying (user confirms).
- **Calling names are authoritative** (office decision). Passport/NIC is a secondary consistency check only.
- **Normalise for matching:** uppercase, trim, remove spaces and hyphens. `INH22` (registration) ≡ `INH-22` (entry sheet). Always display and write the entry-sheet form.

**Employee code:** `X` + 5 digits (older) or `XIN` + 3 digits (newer). Both are real ERP codes. Missing, `#N/A` or `0` means the ERP upload line has a blank or invalid employee.

**Activity codes:** opaque strings from `Labour Detail!L3:L311`, e.g. `03-11-00-00`, `03-11-00-00-P`, `03-20-00-00-C-8`. Shape `NN-NN-NN-NN` plus an optional suffix. Compare after trim, and always write the trimmed value.

### 5.8 Indian registration file (`Copy of External labour registeration-Indians.xlsx`)

- Sheet `External ` (trailing space). Header row 1, data rows 2–60 (59 rows). Infor LN upload template.
- Columns: B Project, **C Emp. code**, D Title, E Last Name, **F CallingName**, G Gender, H Designation, I Trade group, J Department, **K ID number**, L Internal/External, **M Designation (2nd, extra column)**, N Business partner, O Address, P Contact, Q G/S Division, R Police Station, S Emergency contact, T Date of birth, U First date of employment.
  - The supply registration files lack column M, so their columns are shifted one to the left. Detect columns **by header text, not position**.
- Contents:
  - 36 Indian rows (calling name starts `IN`; rows 7–29 and 48–60): BP `BP1019692`, trade groups `SUS`/`SMS`, codes `XIN089`–`XIN124`, start dates 22–26 Sep 2026.
  - 23 local supply rows left over from the copied template. 16 of them carry `XIN112`–`XIN127`, so **`XIN112`–`XIN124` appear twice**.
  - Calling names are mostly written without the hyphen.
- These 36 Indian rows are 36 of the 37 `#N/A` employee-code rows in `Labour Detail` (the 37th is `INC-46 M`, which isn't in the registration).
- **Passport cross-check (report only):** 32 IDs match exactly. For 29 of them the calling name differs between the two files. 2 IDs differ by one character, and 2 aren't found. Calling names win (office decision). List the conflicts for the office and don't block on them.

---

## 6. Phases

Work in order. Each phase ends with passing tests and a short demo note in `CHANGELOG.md`.

### Phase 0 — Foundations (no Excel needed)
- Scaffold the repo (§4), `config.yaml` (§Appendix C), `.gitignore`, and pre-commit with ruff + pytest.
- `xlsb_reader.py`: read `Labour Detail`, the activity list, all 31 day headers and all blocks (In, Out, J/K/L rows 1–5, R, plus cached E/O/P/Q for verification) into Pydantic models. Bulk reads only.
- `rules.py`, `codes.py` with unit tests (§5.5 table, normalisation, grammar).
- `scripts/snapshot_fixture.py`: real `.xlsb` → sanitized JSON. Replace names/IDs with deterministic fakes and keep codes, times and activities.
- **Done when:** recomputing effective/OT/ZIDLE from inputs equals Excel's cached values for every complete entry in the INDIAN fixture (4,074/4,074) and the golden numbers in Appendix A pass.

### Phase 1 — Health check (read-only, high value, safe)
- `health.py` runs the M/H/E checks from §7 over a whole workbook, plus the registration cross-checks (§5.8).
- API `GET /api/health` and a report page: issues grouped by severity, sheet/cell/calling name, plain-English message, suggested fix.
- CLI: `python -m app.health <file.xlsb> [--registration file.xlsx]` → console + CSV.
- **Done when:** on the INDIAN snapshot it reports every item in Appendix B with the stated counts.

### Phase 2 — Live Excel adapter (Windows)
- `xlwings_adapter.py` implements the same `WorkbookAdapter` as the reader. Specifics in §8: attach to the open book, bulk read, batch write with calc paused, read-back, busy/retry, single COM thread, backup, audit, undo, save.
- Dry-run mode: compute and validate, write nothing.
- **Done when:** on a **copy** of the INDIAN workbook open in Excel, a scripted batch of entries:
  - writes without protection errors;
  - Excel's recalculated E/OT/ZIDLE equal the tool's preview;
  - undo restores the exact old values;
  - a backup copy exists.

### Phase 3 — Entry UI
- **Day bar:** pick day 1–31. Show date and day type with a red banner when the header is wrong (H01–H03). Writing to that sheet is blocked until the user acknowledges or applies the suggested header fix.
- **Worker search:** autocomplete by calling name, name or employee code (fuzzy, normalised). Show trade, employee-code status and this month's days and hours.
- **Entry form (keyboard-first):** calling name → In → Out → activity (autocomplete) → hours (defaults to the remaining effective hours) → Enter to queue. Use HH:MM inputs in 15-minute steps, converted to decimal, with an "overnight" toggle that adds 24.
- **Live preview:** total, effective, OT, ZIDLE and day fraction, exactly per §5.5, with warnings inline.
- **Suggestions:**
  - the worker's usual In/Out and recent activities;
  - "copy yesterday" for a worker or a crew;
  - the crew's activity today;
  - the most-used activity codes.
- **Crew entry:** multi-select workers (by trade or saved crew), same times and activity → one batch.
- **Day list:** everything already entered on that sheet, with edit, overwrite (showing old values) and undo per batch.
- **Commit:** queued entries are written as one batch (§8). Show the read-back result per worker.
- **Done when:**
  - a full day for ~200 workers can be entered by keyboard;
  - every blocking rule stops the write;
  - every warning needs an explicit confirm;
  - the Excel values match the preview.

### Phase 4 — Master data & registration tools
- **Missing employee codes:** for `Labour Detail` rows whose G is blank, `#N/A` or `0`, look up the registration by normalised calling name and propose the XIN code. For a role-suffix code with no registration row, propose its base code's employee code (`INC-46 M` → `INC-46`). Show conflicts (duplicate XIN, ID mismatch) and write values into G only after explicit approval, with a backup. This replaces the broken VLOOKUP formulas in G214:G250 with values.
- **Conflict report:** registration ↔ entry sheet (calling name vs ID; §5.8) as a CSV for the office.
- **Registration validator** (read-only):
  - calling-name format and hyphen normalisation;
  - next free number per trade;
  - duplicate employee codes;
  - designation and trade spelling;
  - supply rows (NIC): NIC format plus NIC ↔ date of birth ↔ gender. Old NIC: 9 digits + V/X, YY + day-of-year. New NIC: 12 digits, YYYY + day-of-year. Day-of-year > 500 means female. Day-of-year counts Feb as 29 days in every year;
  - age under 18 at start date;
  - date-format consistency.
- **Done when:** the INDIAN snapshot yields 36 proposed codes from the registration plus 1 from a base code, and flags the 13 duplicate XIN codes and the 29 calling-name/ID conflicts. `INH-21` = 0 stays flagged for the office: it isn't in the registration.

### Phase 5 — Packaging & deployment
- PyInstaller one-folder build: `LabourTool.exe` + `config.yaml` + built frontend. Double-click starts the server and opens `http://localhost:8000`. If LAN is enabled, show `http://<pc-name>:8000` for colleagues; Windows Firewall prompts on first run.
- One-page `USER_GUIDE.md`: start, pick workbook, enter, save, undo, health check.
- **Done when:** it runs on a clean Windows PC with Excel and without Python installed.

### Later (not v1)
SUB CONTRACT workbook (same template, role suffix ` S`), supply workbooks and registrations, multi-month history, ERP upload export.

---

## 7. Validation catalogue

Severity: **BLOCK** = cannot write. **WARN** = needs explicit confirm. **INFO** = shown only. Health check (Phase 1) reports all of these on existing data.

| ID | Sev | Rule |
|---|---|---|
| E01 | BLOCK | In and Out both required if anything else is entered (clearing = all blank) |
| E02 | BLOCK | Out > In; Out ≤ In + 24 (overnight goes past 24, never wraps) |
| E03 | BLOCK | Times and hours on the 0.25 grid; hours numeric > 0 (no text like `13\``) |
| E04 | BLOCK | Activity code exists in the activity list (trimmed exact match); write trimmed |
| E05 | BLOCK | Σ activity hours ≤ effective (else Excel makes a negative ZIDLE) |
| E06 | BLOCK | ≤ 5 activity lines |
| E07 | BLOCK | Target block's column A equals the calling name (stale map → re-read and abort) |
| E08 | BLOCK | Target cells non-empty and not explicitly overwritten (show old values) |
| E09 | BLOCK | Write outside §5.4 writable cells |
| W01 | WARN | Effective > 16 h |
| W02 | WARN | < 8 h rest between this shift and the same worker's previous/next day shift |
| W03 | WARN | Same person (base/role code, same employee code or same ID) has overlapping time that day |
| W04 | WARN | Additional Hours ≠ 0 → remark (R) required |
| W05 | WARN | Out exactly 22:00 → Excel deducts lunch only (staff usually add −1). Ask; never auto-apply |
| W06 | WARN | In ≥ 12:00 → Excel still deducts the lunch hour |
| W07 | WARN | Worker has no valid employee code → ERP upload line will be blank |
| W08 | INFO | Σ activity hours < effective → remainder goes to ZIDLE |
| H01 | BLOCK* | Sheet n date ≠ month start + (n−1) |
| H02 | BLOCK* | Day type ≠ calendar (Sat/Sun) unless the date is in the configured holiday list |
| H03 | WARN | Sheet no. (F4) ≠ n |
| M01 | — | Calling name: format, whitespace, duplicates |
| M02 | — | Employee code blank/`#N/A`/0, or the same code on different IDs |
| M03 | — | Same ID under different names; same name with two employee codes |
| M04 | — | Trade group not in allowed set (suggest `Masan`→Mason, `Superviser`→Supervisor) |
| M05 | — | Activity list duplicates / leading-trailing spaces |
| M06 | — | Typed activity code with spaces or not in list |
| M07 | — | Existing entries breaking E02/E03/E05 or W01–W06 |
| R01–R05 | — | Registration checks (Phase 4) |

\* H01/H02 block writes to that sheet until the user acknowledges or applies the fix (F3/H3/F4 are unlocked).

## 8. xlwings adapter notes

- **Attach:** find the open book whose name matches `config.workbook_pattern` across `xw.apps`. If there are 0 or more than 1 matches, return a clear error. Never open or close the user's workbook automatically.
- **Threading:** one dedicated worker thread owns all COM objects (`pythoncom.CoInitialize()`). API handlers enqueue jobs and await futures.
- **Reads:** one bulk call per range (e.g. `sht.range('A9:R3508').value`), never per-cell loops. Cache master data and re-read a day sheet before every write batch for E07/E08.
- **Writes:** remember the current `app.calculation`, set `'manual'` and `screen_updating=False`, then write per block:
  - `G{r}:H{r}` = `[In, Out]`;
  - `J{r}:L{r+4}` = a 5×3 matrix (L only in the first row, the other L cells `None`);
  - `R{r}` = remark.
  
  Then restore the calc mode, `app.calculate()`, and read back E (row 1), O/P (rows 1–6) and Q (row 7). Compare with the preview and report any mismatch.
- **Text safety:** after writing an activity code, read it back and assert it equals the string (guards against Excel auto-converting).
- **Busy Excel:** COM `RPC_E_CALL_REJECTED` (user is editing a cell) → retry with backoff up to ~10 s, then tell the user to finish editing in Excel.
- **Performance:** a recalc after a write is heavy (31 sheets × 3,500 rows, ~94k conditional-format rules). Measure in Phase 2. If a single write takes > 3 s, write in batches only.
- **Backup:** first write of a session → `book.api.SaveCopyAs(backups/<name>_<yyyymmdd-hhmmss>.xlsb)`. Keep the last 10.
- **Audit + undo:** sqlite row per cell: time, user name (asked once per browser), workbook, sheet, cell, old value, new value, batch id. Undo = write old values back through the same checks.
- **Save:** only on the user's "Save workbook" button (`book.save()`). Show "unsaved changes" until then.
- Ignore AutoFilter state: never rely on visibility, Selection or ActiveCell, and never change filters.

## 9. Testing

- **Unit (CI, Linux):** rules (§5.5 table), code grammar/normalisation, validators, health checks, using `fake_adapter` and sanitized JSON fixtures.
- **Golden (local):** run against `fixtures/private/*.xlsb` when present (skip otherwise) and assert Appendix A and Appendix B.
- **Excel integration (Windows, manual script):** `scripts/excel_smoke.py` against a copy of the workbook. Write, read back, undo, verify.
- **UI:** Playwright smoke test of the keyboard entry flow (optional).

## 10. Privacy & safety

- Real files live only in `fixtures/private/` (git-ignored) and on the work PC. Committed fixtures are sanitized JSON only.
- The server makes no internet calls and has no telemetry. LAN access is off by default.
- The audit log stores calling names, cells and values. It does not store names or IDs.

## 11. Out of scope (v1)

ERP upload/integration, payroll, rates, BP billing, editing formulas or the template, other workbooks (SUB CONTRACT, supply) beyond keeping the code template-driven, user accounts (a name prompt is enough).

## 12. Open questions (ask the user; don't guess)

1. Who uses it: only the data-entry PC, or colleagues on the LAN too? (default: localhost only)
2. Where does the workbook live (local disk or shared drive)? Is it ever open on two PCs at once?
3. Can Python be installed on the Excel PC, or must it be the packaged `.exe`?
4. Excel's rule quirks (7→22 keeps the dinner hour; evening shifts lose a lunch hour): keep mirroring them? (default: mirror and warn)
5. The 2026 holiday list (which dates are "Holiday").
6. Approval to replace the 37 broken employee-code formulas in `Labour Detail!G214:G250` with values (Phase 4).

---

## Appendix A — Golden numbers (INDIAN snapshot, 26 Oct 2026)

- `Labour Detail`:
  - 248 calling names: INB 85, INC 86, INH 32, INM 37, INR 6, INS 2.
  - 5 role-suffix codes.
  - Employee codes: 210 `X#####`, 37 `#N/A` (rows 214–250), 1 zero (row 193, `INH-21`).
  - 247 IDs filled (`INC-46 M` empty); 3 IDs stored as numbers.
  - Activity list: L3:L311 = 309 entries, 306 unique.
- Headers:
  - dates = 2026-10-01 + (n−1), **except sheet 16 = 2026-10-15**;
  - day types per calendar, **except sheet 4 = Saturday** (Sun 4 Oct) **and sheet 31 = Normal Day** (Sat 31 Oct); sheet 25 = Holiday;
  - F4 = n **except sheet 31 = 30**.
- Entries:
  - 4,075 worker-days with input (days 1–24), 4,074 complete; 228 workers.
  - 4,202 activity lines, 73 distinct codes.
  - Allocation: 4,066 full, 5 partial, 2 none, 1 over.
- Rules: effective and OT recomputed = cached for 4,074/4,074.
- Upload lines: 1,358 with blank employee code (36 workers); 48 with employee `0`.

## Appendix B — Known issues the health check must find (INDIAN snapshot)

| Check | Expected |
|---|---|
| H02 sheet 4 | Saturday on a Sunday: 118 worker-days, 1,070 h effective, OT 421 h (Sunday rule = 1,070 h) |
| H01 sheet 16 | dated 2026-10-15 (duplicate of 15): 208 worker-days |
| H02/H03 sheet 31 | Normal Day on a Saturday; sheet no. 30 |
| M02 | 37 `#N/A` employee codes (rows 214–250) + `INH-21` = 0 |
| M03 | IDs shared by different names: `INB-59`/`INR-09`, `INH-14`/`INH-17`, `INH-16`/`INR-03`; same person with two employee codes: `INH-19`/`INR-07` |
| W03 | 32 worker-days where one ID is booked on two codes with overlapping times: `INB-59`/`INR-09` ×14, `INH-14`/`INH-17` ×17, `INH-19`/`INR-07` ×1 |
| E05 | `INB-31` day 19: effective 13 h, activities 21 h → ZIDLE −8 |
| E03 | `INC-74` day 15: hours typed as text `13\`` |
| M06 | `INC-41` day 16: activity code with surrounding spaces |
| M05 | duplicates `03-31-05-35-P`, `03-11-00-00-C-8`, `31-23-23-01-C-1`; leading space at L290 |
| W04 | 16 non-zero Additional Hours (−1 ×14 on 7→22 shifts, +1 ×1, +7 ×1 `INB-77` day 18) |
| W01 | 206 worker-days with effective > 16 h; 257 with Out > 24 |
| W02 | 374 shifts with < 8 h rest before the next day's shift |
| M04 | trade groups `Masan` (37), `Superviser` (2) |
| Registration | 13 duplicate XIN codes (`XIN112`–`XIN124`); 29 of 32 ID-matched workers have a different calling name; 2 one-character ID differences; 2 IDs not found |

## Appendix C — `config.example.yaml`

```yaml
workbook_pattern: "Labour Entry Sheet * - INDIAN*.xlsb"
month: 2026-10
registration_files:
  - "C:/Labour/External labour registeration-Indians.xlsx"
holidays: [2026-10-25]          # office to confirm (open question 5)
server: { host: 127.0.0.1, port: 8000, allow_lan: false }
backups: { dir: "C:/Labour/backups", keep: 10 }
template:
  master_sheet: "Labour Detail"
  master_rows: [3, 502]
  master_cols: { calling_name: A, name: B, trade_group: C, id: D, daily_rate: E, bp: F, employee_code: G, epf: H }
  activity_list: "L3:L311"      # read until first blank in practice
  day_sheets: "1..31"
  header: { date: F3, day_type: H3, sheet_no: F4, project: C6 }
  first_block_row: 9
  block_size: 7
  blocks: 500
  cols: { calling_name: A, effective: E, in: G, out: H, activity: J, hours: K, additional: L,
          upload_employee: M, upload_date: N, upload_activity: O, upload_hours: P, upload_ot: Q, remarks: R }
  activity_rows: [1, 5]         # block-relative
  zidle_row: 6
  ot_row: 7
```
