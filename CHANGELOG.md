# Changelog

## Roadmap #6, productivity and unit cost: hours and Rs per unit against a norm (12 Nov 2026)

Asked for: roadmap #6, the QS's own language: Rs per m³ against the BOQ.

- New Analysis view **Productivity**:
  - **Quantities done (weekly)**: add 5–10 cost-significant codes (most hours first), each with
    its unit (m3, t, m2…), a norm in labour hours per unit and its source (BOQ, BSR, other), and
    the quantity done each week of the month. A block copied from Excel can be pasted (rows
    starting with a code go to that code). Quantities are kept per workbook (month); units and
    norms per project, so they carry on to next month. Excel is not changed.
    `POST /api/setup/quantities`; `/api/master` carries `quantities`, `units`, `norms`.
  - A read-out per code ("Concrete Forming: 1.2 h per m2 · index 0.92 this month (1.15 in days
    19–25) · Rs 450 per m2 at standard rates").
  - **Hours and cost per unit**: quantity, hours, hours per unit, Rs per unit (with rates), norm,
    the **productivity index** (earned hours = quantity × norm, over actual hours; below 1 is
    slower than the norm, coloured), and the hours not measured; a row opens its weeks.
  - Without a norm, the code's own weekly median is used ("site median", from two weeks on).
  - **Measured mile**: hours per unit in clean weeks against weeks with a disrupted day (Lost
    time, roadmap #5) while the code had hours, and the extra hours that implies
    ((disrupted rate − clean rate) × quantity in disrupted weeks).
- A week counts once it has both a quantity and hours: a quantity for days not entered yet
  would make the rate look better than it is. "Quantities to day N" says how far it goes.
- Tests: `tests/analysis.test.cjs` (hours per unit, index, norm source, site median rule,
  disrupted weeks, weeks without hours left out), `backend/tests/test_rates.py`
  (quantities, units and norms saved and checked), `e2e/productivity.cjs` (made-up quantities,
  norm and rates; measured mile with a rainy day).

## Roadmap #5, lost-time reasons: unallocated hours become evidence (12 Nov 2026)

Asked for: roadmap #5, one optional pick at push so ZIDLE hours say why.

- **At push** ("Whose manpower sheet is this?") an optional **Lost time** section: the sheet's
  unallocated hours are shown ("3 h unallocated on this sheet") with the causes to pick from,
  and the day can be tagged as disrupted, with a note. Causes and who is responsible: rain or
  weather (neutral), waiting for concrete (supplier), no materials (contractor), no drawings or
  instructions (client / consultant), plant breakdown (contractor), power cut (neutral), client or
  consultant instruction (client / consultant), other (see note). Nothing is required.
- Kept in the tool's log (`audit.db`, table `lost_time`, the latest answer wins, no causes clears
  it); Excel is not changed. `GET/POST /api/lost-time`.
- **Day strip**: a disrupted day gets a ☂ (rain) or ! mark and says why on hover.
- **Analysis → Lost time**: unallocated hours, how much has a reason, disrupted days; hours by
  cause and by responsible party (a sheet given two causes shares its hours); disrupted days
  compared with clean days (headcount, hours per person-day, unallocated share, OT share), with
  each disrupted day's causes and note; a reason can be picked or changed for every supervisor
  sheet with unallocated hours, and any day tagged later.
- **Site report**: a line on the period's disrupted days and the unallocated hours with a reason.
- Tests: `backend/tests/test_losttime.py`, `tests/analysis.test.cjs` (causes, parties, disrupted
  vs clean), `e2e/lost-time.cjs` (pick at push, day mark, view, change a reason, report line);
  made-up data.

## Roadmap #4, one-click site report and monthly labour return (12 Nov 2026)

Asked for: roadmap #4, a one-page weekly (and monthly) report and a monthly labour return.

- **Site report** button on Analysis opens an A4 sheet; **Print / Save as PDF** prints only the
  sheet (the browser's print, "Save as PDF" makes the file; nothing installed). Esc closes.
  - Period: each week of the month (Monday to Sunday, cut at the month's ends; the last week with
    hours by default) or the whole month, compared with the week before.
  - Headline tiles: hours, overtime, headcount (average and peak), worker-days, unallocated hours
    and, with rates, labour cost and OT premium.
  - **What changed**, written by rules (no AI, no worker names): hours against the previous
    period, headcount, the biggest movers by trade, activities started and activities with no
    hours any more, the OT share change and the trade and activity that drove it, unallocated
    spikes and the worst day, workers with 14+ days in a row (a count). A week still being entered
    (or a short first week) is compared **per day with work**, so a part-week does not read as a
    fall. Each line has a "table →" link to the Analysis view behind it.
  - Manpower by day and trade, the top 8 activities (description, place, hours, people, cost) and
    their as-built bars.
- **Monthly labour return**: people of each trade (class of personnel) on site each day, with
  worker-day totals and Prepared / Checked / Approved (Engineer) lines; one landscape A4 page.
- Both are checked to print on exactly one page.
- Tests: `tests/analysis.test.cjs` (periods, the change rules, per-day comparison, the return),
  `e2e/site-report.cjs` (prints both to PDF and counts the pages; a line's link opens its table),
  on made-up data.

## Roadmap #3, rupee lens: labour cost at standard rates (12 Nov 2026)

Asked for: roadmap #3, hours turned into rupees for the QS.

- **Standard rates** (Analysis → *Standard rates…*): a daily rate per trade for this workbook's
  labour source (INDIAN, SUB CONTRACT, … kept apart), the hourly rate shown beside it, and the
  multipliers: overtime on a normal day or Saturday 1.5×, every hour on a Sunday 1.5×, every hour
  on a public holiday 2×, an 8-hour standard day (defaults, to be confirmed with HR). Optionally
  Labour Detail's own Daily Rate column wins where it is filled. Kept on this PC (settings file),
  never written to Excel. Costing rates, not pay: no figure is shown per person.
- **Hours / Rs switch** on Analysis (remembered):
  - Overview gets four tiles: labour cost, OT premium (only the amount above the normal rate),
    unallocated cost (ZIDLE) and cost per worker-day, with how much of the hours have a rate.
  - Activities, Places, Trades and Supervisors tables get Cost (Rs), OT premium (Rs) and Cost
    share columns and sort by cost; the top-activities and trade lists show rupees; Overtime by
    trade shows the OT premium.
  - A line says every figure is "at standard rates" and that OT per activity is attributed.
  - Without rates, Rs shows a small "Add rates to see rupees" card instead of zeros.
- Cost per slice = normal hours × hourly rate + OT hours × hourly rate × the day's multiplier
  (Excel counts every Sunday and holiday hour as OT, so those days cost hours × rate × their
  multiplier); every table still adds up to the same totals.
- **Excel export**: when rates exist, the Activities, Places, Trades and Supervisors sheets get
  Cost and OT premium columns and the Summary sheet the cost figures and the rate coverage.
- API: `GET/POST /api/setup/rates`; `/api/master` carries `rates` for this labour source.
- Tests: `backend/tests/test_rates.py`, cost checks in `tests/analysis.test.cjs` (worked by hand),
  `e2e/rupees.cjs` (made-up rates); `e2e/programme.cjs` now picks the S-curve's Hours button.

## Roadmap #2, as-built programme: Gantt, manpower histogram with the plan, S-curves, flowline (12 Nov 2026)

Asked for: roadmap #2, the programme drawn straight from the daily sheets.

- New Analysis view **As-built programme** (second tab; every filter applies):
  - **Programme bars**: one row per activity code with its description, from its first to its last
    day with hours; each day shaded by the crew on it (darker = more people), gaps left empty,
    Sundays and holidays marked; hours and peak crew at the end. The 10/20/40/all activities with
    most hours, sorted by start. Click a row to filter by that code.
  - **Manpower histogram by trade** with a dashed **planned headcount** line. The plan is typed or
    pasted from the PM's look-ahead in Excel (people a day per trade per week, week commencing
    Monday; rows starting with a trade name go to that trade). With a trade filter the line is that
    trade's plan. Kept per workbook file (`POST /api/setup/plan`).
  - **S-curves**: cumulative labour hours by day for all work and the 6 activities (or places)
    with most hours, in hours or % of each one's total.
  - **Flowline**: time across, places up the side; each activity (code without its place) is a
    line climbing through the places, one segment per place from its first to last day there. The
    PM orders the places once (▲ ▼, Save order), kept for the project
    (`POST /api/setup/place-order`); places not ordered yet follow by name.
  - **Save image** on every chart: a PNG with the chart's title, in the page's colours, for the
    progress meeting.
- The day bar chart moved to `components/charts.tsx` (shared) and can draw a line over the bars.
- `/api/master` carries `place_order` and `plan`.
- Tests: `tests/analysis.test.cjs` (bars, crew per day, S-curves, flowline levels and segments, week
  of a date, planned headcount), `backend/tests/test_descriptions.py` (place order and plan saved and
  checked), `e2e/programme.cjs` (paste a look-ahead row, save, plan line, % S-curves, reorder places,
  PNG download); made-up data.

## Roadmap #1, speak their language: descriptions beside codes, plain words in Analysis (12 Nov 2026)

Asked for: go through the PM & QS roadmap one by one; #1 first.

- **Every activity code has a description.** It starts with its MasterFormat title from the code's
  numbers (03-11 Concrete Forming, 03-20 Concrete Reinforcing, 03-31 Structural Concrete, 31-23-23
  Fill; a code not in the list takes its broader section, then its division; 00-00-10-00 is
  Medical leave). The office can type its own on **Codes & registration → Trades, places &
  activity codes → What each activity code is** (search, used this month, empty a box to go back
  to the standard title). Kept per project with the place names; Excel is not changed.
- Shown beside the code under the activity box and in the suggestion chips and code list
  ("Concrete Forming · Parking area"), in the **manpower sheet's Description column** (the open
  question about that column is answered), on the Supervisors page's sheets, in Analysis
  (Activities, top activities, task timeline, where each supervisor's people worked), in the
  Excel export (Activities, Activity by trade, Supervisor place activity) and as
  `codes.description` in SQL.
- **Plain words in Analysis**: ZIDLE is "Unallocated (ZIDLE)" / "unallocated hours (ZIDLE)"
  everywhere (views, Compare months, export); "people" is "headcount"; every KPI tile has a
  one-line definition (what counts as overtime, that worker-days count a person's two calling
  names twice, that the average headcount counts days with work only).
- API: `GET/POST /api/setup/descriptions`; `/api/master` carries `descriptions`.
- Tests: `backend/tests/test_descriptions.py`, `e2e/descriptions.cjs` (made-up data);
  `e2e/places-edit.cjs` now expects "Concrete Forming · Car park" under the activity box.

## Time cards: grouped printer settings, job size before printing (12 Nov 2026)

Asked for (design review of the Time cards page).

- Time card sheet, Calling name cell and Copies of each sit in one card, "Printer
  configuration", apart from the worker list. A line under them reminds you that the print area,
  page setup and printer come from Excel.
- The cell hint is a small badge: green "✓ Found next to "Calling Name" · now INB-01" when the
  tool found the cell, amber when there is a problem, grey when you typed your own cell.
- Next to the print button a summary shows the size of the job: "231 time cards × 2 copies =
  462 pages, from "Time Card", name into E8". It turns amber from 50 cards up.
- The button says the exact job: "🖨 Print 231 time cards", with "(462 pages)" when there is more
  than one copy. It is larger, and the confirm question before printing is unchanged.

## Codes & registration: three sub-tabs, a dark SQL editor, clearer edit boxes (12 Nov 2026)

Asked for (design review of the Codes & registration tab).

- The tab has three sub-tabs instead of one long page:
  - **SQL & data**: the SQL panel, always open there.
  - **Trades, places & activity codes**: trade letters and place names side by side on a wide
    screen, with the new activity codes below.
  - **Validation & fixes**: employee codes, registration vs Labour Detail, registration check.
  Each part is its own card with a coloured top edge. The tool remembers the last sub-tab; links
  `#codes/sql`, `#codes/places` and `#codes/checks` open one directly. Ctrl+K still jumps to
  the SQL editor from any tab.
- The SQL editor is a dark code box (#0D1117, crisp border, blue focus ring) with its own
  syntax colours in both themes. Table names in the tree are bold with a small TABLE tag.
- The boxes in the trade-letter and place-name tables all have the same padding and a stronger
  border, so they read as editable; endings are shown as small code chips.
- Recent batches (undo) shows on the two other sub-tabs, not on SQL & data.

## Manpower sheet: crisper grid, quiet Discard (11 Nov 2026)

Asked for (visual polish of the manpower sheet).

- Every line inside the sheet is now one solid, clearly visible grid colour. The faint dashed
  lines between activity rows are gone, and the row under the mouse is lightly highlighted.
- "Discard sheet N" is a quiet grey outline button. It turns red only when you point at it.
- "Push N entries to Excel" is a little larger, with a soft orange glow, so it is the one
  obvious next step.

## Medical leave dialog: tiers and a clear button (11 Nov 2026)

Asked for (design review of the Medical leave dialog).

- The intro is a short info strip: "One entry per working day on the worker's medical line …
  Sundays are skipped; holidays too if you tick it."
- Three tiers: worker and first day; the days of leave (box, one-click counts and the span
  under them) in one panel; In, Out, activity and "Skip holidays too".
- The button says what it will do: "Generate medical leave entries" until there is something to
  write (never "Write 0 days"), then "Write 14 days of medical leave for INC-08 M" or "Add INC-08
  M and write 14 days"; larger, solid orange.

## Manpower help, empty waiting list, batch log (11 Nov 2026)

Asked for (design review of the lower entry page).

- Manpower sheet: the paragraph of instructions is a closed **How it works** drawer with four
  short points.
- Waiting to go to Excel, when empty: a count badge (0) and a dashed panel with an icon,
  "Nothing waiting yet" and one line on what comes here, instead of an empty box.
- Recent batches: the batch number and what it did (write, header fix, undo of #…) bold and
  bright, then the sheet and cells; the time and the user dimmed at the end.

## Worker list and scrollbars (11 Nov 2026)

Asked for (design review): the worker list ran onto the Add worker button; scrollbars too dark
to see.

- The worker list is at most 300 px or a third of the window high (whichever is smaller), so
  on a zoomed or small screen it ends above the buttons; it has a clear edge and a deeper shadow,
  and the buttons have more room above them.
- Scrollbars: thin, with a lighter thumb (#3A3F4C in dark) that brightens on hover.

## Entry page with a worker picked: clearer who, cleaner suggestions, codes by the box (11 Nov 2026)

Asked for (a design review of the entry page with a worker picked).

- The worker card: the calling name in orange, the name and the trade bold and bright, on its
  own tinted strip with an orange edge, so the right person is confirmed at a glance.
- "Usually on the same record": a solid **+ Add all N** button at the top; the pills lighter with
  the calling name bright and the "5/10" in a small blue tag; still in rows by trade, each with
  "add these N".
- The suggested activity codes are under the Activity code boxes ("Suggested codes (↓ in the
  box)") instead of in the side panel, next to where the code is typed. The side panel keeps the
  usual times and the copy of yesterday.
- "✓ Looks right. Press Enter to add." shows Enter as a key cap.

## Entry page: calmer day strip, the day so far, two-column form, key caps (11 Nov 2026)

Asked for (a design review of the entry page).

- Day strip: one signal per meaning. The day you are on: solid orange. Days with entries: green
  tint and edge. Saturday / Sunday or holiday: the number in amber / red only. No more dots or a
  second fill colour. The legend says so.
- The side panel before a worker is picked: **This day so far**, with the workers entered on
  the sheet, their hours and overtime, how many have hours without an activity code, and how many
  wait to be pushed. With a worker it shows their day, as before.
- The form in two equal columns: Time In | Time Out (Next day under it), Activity code | Hours,
  Additional hours | Remark; the worker box across the top.
- Keyboard hints as key caps (Enter, Esc, ↑ ↓, Alt ← →): a raised key with a lighter face.

## Ready list: warnings stand out and have a quick fix (11 Nov 2026)

Asked for (a design review of the Ready step): a warning among the green ticks is read past;
there is no way to fix it from there.

- A row with a warning (amber) or a failure (red) is tinted, with a coloured edge and a frame,
  and its text is brighter, so it stands out from the green ticks.
- Its button goes straight to the fix: **Fix codes** (the employee-code card, where the
  registration files fill them in), **Fix sheets** (dates and day types), **See them** (Excel's
  formulas disagreeing), **Set the month**. Back on Check and fix the page scrolls to that card;
  nothing is read again.

## Check and fix: colour by severity, structured rows, buttons in reach (11 Nov 2026)

Asked for (a design review of the check page): real errors must stand out from notes; the
issue rows are hard to scan; Continue is buried under long lists.

- Colour means severity: **red** (with an "Error" badge) for mistakes to correct and the sheet
  dates/day types to fix; **amber** ("Check") for things worth checking; quiet **slate/blue**
  ("Note") for small notes with nothing to do.
- Each issue: where it is as pills (sheet · row · column/cell · worker), what is wrong on its own
  line under them, and what to do last; a coloured left edge per severity.
- "Check again" and "Continue" stay at the bottom of the window while scrolling, with a short
  summary ("No mistakes · 925 worth checking", or "3 to correct").

## Start page: clearer first step, crisper dark theme (11 Nov 2026)

Asked for (a design review of the start page): more contrast between page, card, fields and the
drop zone; a stronger title and readable helper text; one clear way in instead of two
competing ones.

- A workbook already open in Excel shows first, as a "Detected in Excel" card with its name and
  a **Use this workbook** button; "or open another workbook" and the drop zone come below it.
  With nothing detected the drop zone is the main way in (its Browse… is the main button).
- The drop zone has a file icon, a visible dashed edge, a glow on hover, and the whole zone opens
  the file choice (click, Enter or Space).
- Title bigger and bolder with room around it; the steps sit under it. Helper text 14 px in a
  readable grey instead of small dim text; the practice-mode line larger.
- Dark theme (every page): page #121417, cards #1A1D24 with a #2A2E39 edge, input boxes sunk
  into the card with a crisp edge, orange #FF7A00, secondary text #9CA3AF. The light theme keeps
  its look.

## Supervisors: the last three on top, everyone else A–Z (11 Nov 2026)

Asked for: with many supervisors they are hard to find; put them in alphabetical order with the
last three used on top.

- The question at push ("Whose manpower sheet is this?"): a **Recent** row with the last three
  supervisors used (latest first), then everyone else A–Z in a row per first letter. Typing a
  name that is not on the list narrows the buttons to those containing it.
- The supervisor filter on the Supervisors page: "Recent" (the last three) and "All supervisors
  (A–Z)" groups.

## Medical leave: any number of days (11 Nov 2026)

Asked for: the medical leave days vary with the report (14, 10, 2, 20 …); make them adjustable.

- "Days of leave" is a number box (1 to 90 working days; it was capped at 31) with one-click
  counts: 2, 3, 5, 7, 10, 14, 20, 30. It still starts at 10.
- Under it: the first and last sheet of the leave, and how many days fall in next month's
  workbook ("Sheet 10 to 31, then 6 more in next month's workbook"). Sundays never count;
  holidays only when "Skip holidays too" is ticked.

## "Start day from previous days" removed (11 Nov 2026)

Asked for: remove "⟲ Start day from previous days".

- Removed: the button and its dialog (a whole sheet proposed from the workers' last days, in
  crews to tick), the `/api/days/{sheet}/build` endpoint, `app/domain/daybuilder.py` and its
  tests, the start page's "Start day from previous days" readiness line, and the day-builder
  numbers in `scripts/replay.py`. Nothing else used them.
- The previous month's last days are still read for the suggestions on the 1st (carry-over).

## Crew entry removed (11 Nov 2026)

Asked for: remove the crew feature; it has never been used.

- Removed: the "☰ Crew entry" button and its dialog (pick workers by trade or search, save named
  crews, queue them with the form's times or yesterday's), and the "+ crew …" buttons of saved
  crews under "Same entry also for". Saved crews in the browser are no longer read.
- Kept (they need nothing set up, they come from the days already entered): the "Crew today"
  suggestion, the ⚠ crew mark on the manpower sheet, "Start day from previous days", and
  "crew of INB-03" in commands.

## Suggested workers in rows by trade (11 Nov 2026)

Asked for: the suggestion box is hard to read; put the suggested workers in rows by trade
(Barbenders in one row, Carpenters in another).

- "Same entry also for": the usual-crew suggestions ("Usually on the same record") and the search
  results ("Found:") are in rows by trade, labelled (BARBENDER, CARPENTER …), the trade of the
  worker being entered first, then the biggest groups. Each suggested row has "add these N";
  "add all" adds every suggestion. The trade is the one from the calling name's letter (else
  Labour Detail's column). The arrow keys go through the found workers in the order shown.

## Trade from the calling name's letter, Labour Detail's column as the fallback (11 Nov 2026)

Asked for: take the trade from the last letter of the calling name (INR-01 is a Rigger, ADB-100
a Barbender), and fall back to Labour Detail's trade column when the letter does not tell it.

- A worker's trade = the trade of the last letter before the "-" (INR-01 → R → Rigger, ADB-100 →
  B → Barbender, INB-04 CH → B); a two-letter group like PL is looked up whole first. A letter not
  in the list, or a name that does not follow the pattern, takes the trade column (as before).
- Letters to start with: B Barbender, C Carpenter, H Helper, M Mason, R Rigger, S Supervisor.
- **Codes & registration → Trades by calling-name letter**: change, add or remove letters (kept
  in the settings file, for every workbook); it lists Labour Detail's letters that have no trade
  yet and how many workers take the column now. "Back to the tool's list" restores the six.
- Used everywhere the trade is shown: Analysis (trade filter, hours by trade, daily manpower,
  exports), the SQL panel's `trade` column, crews. Excel is not changed; the API also gives
  `trade_column` (Labour Detail's value) and `trade_source` ("name" or "column").

## SQL: change one code for chosen workers with UPDATE (5 Nov 2026)

Asked for: `update entries set code = '03-11-00-00-P' where code = '03-11-00-00' and calling
name = (…)` for days 1 to 31.

- `UPDATE entries SET code = 'new' WHERE code = 'old' …` now changes only the matching code line:
  a worker's other codes that day and every line's hours stay (it used to put the new code in
  place of all of them). Also with `code IN (…)` and `code LIKE '…%'` in the WHERE.
- `WHERE code = 'X'` on entries finds a worker who has X among several codes that day
  (entries.code shows them joined with "+"); `!=` means none of them.
- `calling_name = (INB-01, INB-02)` is read as `IN (…)`; names in a list need no quotes;
  `calling name` with a space works. A name in the list that is no worker is said, with the
  workers it starts ("AAW" → "4 start with it … use calling_name LIKE 'AAW%'").
- Workers with many activity lines (up to 5): only the matching lines change. When that leaves
  a code on two lines (the old code was on two lines, or the worker had the new code already),
  they become one line with the hours added; the line freed is emptied in Excel. The same for the
  `replace` command.
- The days: `AND day BETWEEN 1 AND 31` (or leave the day out for the whole month).
- New example in Examples…: "Change a code for some workers (their other codes stay)".

## Codes typed oddly in Excel are found by replace and SQL (5 Nov 2026)

Asked for: "replace 01-51-23-00 with 01-51-23-00-P for all on 1-31" said "Nothing matches"
although a SELECT showed rows with that code.

- A code in the sheet with a trailing space, a non-breaking hyphen or an en dash (easy to get in
  Excel) looks the same but did not match "replace" or "=" letter for letter. Codes are now
  compared as codes: case, spaces and look-alike dashes ignored (REPLACE, and SQL =, IN and
  comparisons on the code column). Replacing writes the clean new code, so such cells get fixed.
- When REPLACE still finds nothing, it lists the codes those entries do have that look like the
  one asked for ("Codes like it there: "01-51-23-00-P" (14)…").

## SQL panel: pasted queries, and why a query found no rows (5 Nov 2026)

Asked for: queries pasted into the SQL panel showed no rows.

- Text pasted from a chat, Word or a web page often has curly quotes (‘ ’ “ ”), look-alike dashes
  (a non-breaking hyphen or an en dash in a code looks like "-" but matches nothing) and
  non-breaking spaces. They are made plain before a query or command runs.
- A SELECT that finds no rows on a code now says why, under the result: the codes in this
  workbook that look like the one asked for (with how often they are used), that "=" needs the
  whole code (place ending too: use LIKE '…%'), and that entries.code holds all of a worker's
  codes joined with "+" (use the activities table, one row per code). If no code is like it:
  "check the code, or that the right workbook is open".
- Editor fix: keys typed right after Tab took a completion could land in the wrong place
  ("selectcalling_name…", the space lost): the cursor was put back a moment later from an old
  copy. The completion and the Tab indent now go straight into the box. Run also reads the query
  from the box itself, so Ctrl+Enter right after typing runs all of it.

## "Start the next month" removed; staying connected to Excel while printing (5 Nov 2026)

Asked for: the tool loses its connection to Excel now and then, most often when printing; remove
the create-new-workbook feature entirely without breaking anything.

- **Removed**: "📅 Start the next month from this workbook…" (the menu item, its dialog, the
  `/api/setup/new-month` endpoints, `app/newmonth.py`, the cell-clearing Excel call it used, its
  tests). Nothing else used them. The guard test that the tool never closes Excel moved to
  `tests/test_excel_safety.py`. Changing a workbook's month (🗓) stays.
- **Connection, while printing** (what was found in the code):
  - Attaching to Excel listed its open workbooks without waiting for a busy Excel, so attaching
    while Excel was printing (or a cell was being edited) failed at once and showed "not
    connected". It now waits for a busy Excel like every other call.
  - After each card, Excel keeps spooling with its "Printing…" box and turns calls away; the tool
    gave up after 10 s. Now it waits until Excel says it is ready again (up to 2 minutes per
    card), and if Excel stays busy the message names the card and says to check the printer,
    then press Continue (instead of "finish editing the cell").
  - "The remote procedure call failed", which Excel gives for a moment while printing, was taken
    as "Excel is gone". It is now retried first (never for the print itself, which must not run
    twice). A read that still finds the connection lost attaches again and is tried once more;
    writes are not repeated.
- When it happens again, `labour-tool.log` in the "Labour Entry Tool" folder (in the user's home
  folder) has the Excel errors with their times.

## Analysis: worker × supervisor × date, whose worker, supervisor × place × activity (5 Nov 2026)

Asked for: in Analysis, know that this worker worked under this supervisor on this date, that
this worker belongs to this supervisor, and that this supervisor worked on this place on this
activity code.

Three new tables in Analysis → Supervisors, each with its own search box; they follow the filters
(supervisor, trade, place, activity, days) and go into the Excel export:

- **Who worked under whom, by date**: date, worker, name, trade, supervisor, hours, OT, codes.
  Export sheet "Worker days by supervisor".
- **Whose worker**: each worker's main supervisor (most of their days; a supervisor counts
  before "No supervisor", a tie goes to the latest), the share of their days, and every
  supervisor they worked under with days and first–last day. Export sheet "Whose worker".
- **Where each supervisor's people worked**: supervisor × place × activity code with hours, OT,
  people, days, first and last day. Export sheet "Supervisor place activity".

## Supervisors: search and review; supervisors in Analysis (5 Nov 2026)

Asked for: search and review the supervisors' sheets; supervisor data in the Analysis section.

- **Search** (Supervisors page): a worker (calling name or name), an activity code, a supervisor,
  a sheet number or a date. Matching sheets are listed, the workers found are named ("AAA-03 on
  sheet 4 (Kamal)") and highlighted on the sheet.
- **Review**: on each sheet, "✓ Matches the paper" or "⚠ Problem…" (with a note); "Take back the
  review" undoes it. The table shows each sheet's review, who did it and when; filter by Not
  reviewed / Matches / Problem / Changed since review. A review remembers what the sheet looked
  like: when it changes afterwards (edited in Excel, pushed again, moved to another supervisor)
  it shows "Changed since review" until checked again. Kept in the change log (`sheet_reviews`);
  renaming a supervisor renames their reviews too.
- **Analysis**: a Supervisor filter (every view and the Excel export follow it), and a new
  Supervisors view: hours, OT, people and days by supervisor, with their sheets, reviewed sheets
  and problems; people per day by supervisor. Entries without a supervisor show as "No
  supervisor". The export gets "Supervisors" and "Supervisor by activity" sheets.
- Entry form fix: ↓ then Enter Enter at full speed could lose the last Enter (the code box took
  the cursor back a frame later), so the worker was not added. It now keeps the cursor where the
  Enter moved it.
- Top bar: below 1500 px wide it wraps to a second line instead of running off the screen.

## Supervisors: each pushed manpower sheet belongs to a supervisor (5 Nov 2026)

Asked for: when pushing to Excel, ask who the supervisor is, so a day's entries can be checked
again later against that supervisor's paper manpower sheet; pick a supervisor or type a new one.

- Push → "Whose manpower sheet is this?": the supervisors used before (most recent first) as
  buttons, or type a name (a new one joins the list; "kamal" becomes the known "Kamal").
- New **Supervisors** page: each day's entries by supervisor, laid out like the paper form, with
  what is in Excel now. "≠ Excel" marks a worker changed in Excel after the push (hover: what
  changed). Filter by supervisor and day; entries of a day with no supervisor are listed.
- Wrong supervisor chosen: "Give this sheet to …" moves it. The supervisor list (rename,
  remove, add) is at the bottom of the page; removing a name keeps it on its sheets.
- Storage: SQLite, in the change log the tool already keeps (`audit.sqlite` in the data
  folder), table `sheet_owners`: one row per pushed entry with its supervisor and the entry as
  pushed, linked to the push. An entry belongs to the supervisor of its latest push that is not
  undone, so Undo gives it back to the supervisor before. The list of typed names is in the
  settings file. Practice copies keep theirs in the practice folder, as before.
- API: `supervisor` on `POST /api/entries` (optional for other callers), `GET/POST
  /api/supervisors`, `/api/supervisors/remove`, `/api/supervisors/rename`,
  `GET /api/supervisor-sheets`, `POST /api/supervisor-sheets/reassign`.

## The tool never closes Excel or a workbook (4 Nov 2026)

Asked for: check whether the tool can close Excel under any condition, and remove it.

- Found one: when "Start the next month" failed half-way while clearing the new copy in Excel, it
  closed that copy in Excel without saving. It never closed the month's own workbook, and
  nothing quit Excel. That call and the adapter's `close()` are removed.
- Now on such an error the copy stays open in Excel, not saved, and the message says to close it
  there without saving and delete the file (the copy is deleted when Windows allows it).
- "✕ / Close" on the workbook list only takes a workbook off the tool's list, as before.
- A test fails if any code that talks to Excel calls close, or anything calls quit, kill or
  taskkill.

## Time cards: pause, resume, and continue after a stop (4 Nov 2026)

Asked for: a pause button for printing time cards; after Stop, printing started again from the
beginning.

- While printing: "⏸ Pause" waits after the card being printed (Excel is free meanwhile);
  "▶ Resume" goes on with the next card. Stop still works, also while paused.
- After a stop, or a printer error: "▶ Continue from AAA-004 (37 left)" prints only the cards not
  printed yet; the card that failed is printed again. "Print the whole list again" is still there.
- Backend: `POST /api/timecards/pause` and `/resume`; the job has `paused` and `left`.

## Month asked once per workbook; change it any time (3 Nov 2026)

Asked for: how does the tool know the month? Ask the user when a new workbook is opened, set the
days for that month and year, and allow changing the month of any workbook.

- Before: the month came from the file name ("… November 2026 …"), else from the dates on most
  sheets, without asking.
- Now the start page asks once per workbook: "Which month is this workbook for?", pre-filled with
  that guess and where it came from. The answer is kept for the file (settings), so it is not
  asked again, also after a restart.
- The sheet checks (date in F3, day type in H3, sheet no. in F4) use that month: an empty
  November workbook gets 30 dates, Saturdays/Sundays/holidays as day types, and "Fix all N
  sheets" writes them. Sheet 31 is flagged as not a day of November.
- Change it any time: workbook menu → "🗓 Change the month of this workbook…", or "Change month"
  on the start page. The checks run again for the new month.
- A workbook made with "Start the next month" is already confirmed for its new month.

## Manpower sheet: a worker on up to 4 codes (3 Nov 2026)

Asked for: ticking a worker on a second code took them off the first; allow up to 4 codes, the
hours split from In/Out by the number of ticks.

- Ticking a worker on a code adds it to their codes (up to 4; a fifth tick box is disabled until
  one is unticked). The worked hours (from In and Out, lunch/dinner and additional hours counted)
  are shared equally over the ticked codes in quarter hours: 11 h over 2 = 5.5 + 5.5, over 3 =
  3.75 + 3.75 + 3.5, over 4 = 2.75 each.
- Unticking shares the hours over the codes left (none left: the "No activity code" warning).
- Another split (6 + 5) is still made with ✎ in the form, or by clicking the hours on the sheet.

## Place names editable at any time (3 Nov 2026)

Asked for: the code-ending (place) registration was only shown when a workbook was first opened;
make it possible to edit and update it.

- Codes & registration → **Places in the activity codes**: change a name, empty a box to remove it,
  or add an ending ahead of its codes (e.g. -S = Skywalk). Saved for every workbook of the project;
  the entry screen and the manpower sheet show the new names at once.
- Endings named by hand show in the list even before a code in the activity list has them.
- The start page still asks once for a new project.
- Tests: `e2e/places-edit.cjs`, place editing in `backend/tests/test_setup.py`.

## Start the next month (2 Nov 2026)

Asked for: in a new month, make a folder named after the month, copy the old workbook into it with
the name the user wants, and clear only the entries (keep Labour Detail and the rest).

- Workbook menu → **📅 Start the next month from this workbook…**: month (next one suggested),
  folder (suggested: a "November 2026" folder next to the "October 2026" folder, or inside the
  workbook's folder), file name (the old name with the new month; editable).
- Cleared on every day sheet, in blocks with input only: Time In/Out (G:H), activity lines (J:K,
  five rows), Additional hours (L), Remarks (R). Kept: Labour Detail (workers, employee codes,
  activity list), every formula, the ERP upload columns, summary and time card sheets.
- Each day sheet gets the new month's date (F3), day type (H3: Saturday, Sunday, holidays from the
  holiday list) and sheet number (F4); a sheet the month does not have (31 in November) keeps its
  header and is only cleared.
- With Excel: the copy is opened in Excel, cleared in a few large calls, saved, read back to check
  that no entry is left and no worker is lost, then opened in the tool (the check page follows).
  Anything fails: the copy is closed without saving and removed; the old file is never changed.
  Unsaved changes in the old workbook: "Save Excel file" first. A file already there: refused.
- Tests: `backend/tests/test_newmonth.py` (names, folders, what is cleared, the endpoint, the Excel
  steps with a stand-in), `e2e/new-month.cjs`. Not yet run against real Excel.

## One query window for SQL and commands (2 Nov 2026)

Asked for: the command box above the SQL panel is no longer needed.

- The command box is gone from Codes & registration. The SQL panel's editor takes SQL **and** the
  plain commands (copy, fill, move, swap, set, shift, clear, replace, round, show), with
  suggestions and explanations for both; SHOW gives a grid, and every change (SQL or command)
  waits under "Changes waiting for you" old -> new before it goes to the waiting list.
- Ctrl+K from any tab opens the SQL panel with the cursor in the editor. Command examples are in
  the Examples list.

## SQL panel like a database browser (2 Nov 2026)

Asked for: the SQL part was hard to work with; a HeidiSQL-like view under the command box.

- New **SQL panel** on Codes & registration, under the command box:
  - **Tables tree**: entries, activities, workers, codes, days with their row counts; each column
    with its type (✎ = can be changed with UPDATE). Click a column to put it in the query; click a
    table to browse it.
  - **Query editor**: line numbers, colours (keywords, tables, columns, text, numbers), completion
    as you type (Ctrl+Space, Tab/Enter), the word under the cursor explained, several statements
    with `;` (Run takes the one under the cursor or the selection), `--` comments, examples and
    history. Ctrl+Enter or F9 runs. Errors are shown and the wrong word is underlined.
  - **Result grid**: row numbers, click a header to sort, (NULL) shown, time taken, Copy (CSV) and
    Export to Excel; the first 1,000 rows are shown.
  - **Data tab**: `SELECT * FROM <table> WHERE …` with a filter box; on entries, double-click In,
    Out, code, hours, additional or remark to change it (the cell shows the new value in yellow).
  - **Changes waiting for you**: INSERT / UPDATE / DELETE and grid edits are listed old -> new per
    worker and day before anything happens; "Add N changes to the waiting list" or Discard.
- Test: `e2e/sql-panel.cjs`; `splitSql`, row counts and schema in `tests/sql.test.cjs`.

## Reload from Excel shows what it did (2 Nov 2026)

Asked for: the "Reload from Excel" button gave no sign it was clicked and did not refresh the page.

- While it runs the button shows a spinner and what it is reading; at the end a message says what
  changed: "sheet 9: 1 new, 2 changed; Labour Detail: +1 activity codes" or "no changes".
- It now also checks the waiting entries again against the fresh sheet (an entry now in Excel
  shows as such), and reads the other days of the month in the background (suggestions, the day
  list and Analysis use them).
- Test: `e2e/reload.cjs` (a worker written behind the page shows up after Reload).

## Missing activity code warns; codes editable on the manpower sheet (2 Nov 2026)

Asked for: an entry without an activity code (where codes are needed) went to Excel without any
warning; and a quick way to change codes on the manpower sheet before pushing.

- New check W10 "No activity code": an entry with worked hours and no activity line at all, in a
  workbook kept with codes, is a warning that must be ticked "It's correct" before Push (it was
  only a note, W08, before). Workbooks kept without codes (SUB CONTRACT) are not affected.
- Manpower sheet (waiting entries only):
  - Click a code to rename it for every waiting worker on that page who has it.
  - "+ code" adds a row for a new code; tick a worker on any code row to put their whole day on
    it (one line, all worked hours); untick to take them off (no code left: the W10 warning).
  - A split over several codes or a part of the day is still made with ✎ in the form.
- Tests: `e2e/sheet-codes.cjs`, helpers in `tests/dinner.test.cjs`, W10 in the backend tests.

## Suggestions measured and tuned (1 Nov 2026)

Asked for: measure the suggestions continuously, then try a list of accuracy and fewer-keys
changes, keeping only what the replay shows is better.

**Measuring**
- `cd backend && python ../scripts/replay.py` replays every workbook in `fixtures/private` (in sheet
  order and crew by crew) and reports per book: codes (first guess, top 3, per rule, filled boxes
  and how often a fill is wrong), times (per rule), whole record, worker search keys, the "probably
  next" list, chips, the crew warning (false alarms and planted misreads caught), and the day
  builder (ticks right, carried exactly, actions to finish a day). A baseline per book is kept next
  to the workbooks; the run fails if any book gets worse (`--update` accepts new numbers).
- Suggestion log on the office PC (`Labour Entry Tool/logs/suggestions-YYYY-MM.jsonl`, no names):
  which rule offered the times and the code, kept or typed over, keys and seconds per entry.
  Analysis → Suggestions shows it.

**Kept (October replay: INDIAN / SUB CONTRACT)**
- Previous month carry-over: the last 7 days of last month's workbook (found next to this one) are
  days 0, -1, … for the suggestions and the day builder. First week: codes right 63.5 -> 70.9%,
  times 70 -> 73.9% / 35 -> 56.8% (tested by splitting October in two).
- Crews for workbooks without codes (same In and Out): SUB CONTRACT times right 36.6 -> 51.7%.
- The worker's own times weigh recent days most (0.8 per day back): 71.1 -> 71.4% / +0.5.
- Day builder: gaps counted in working days, a working day's entry carried over a Sunday's, and
  holidays run like Sundays: INDIAN actions to finish a day 164.6 -> 159.0, workers left to type
  19.8 -> 16.0 a day. (Holidays could not be measured: no holiday entries in the data.)
- A code fills the box only when 2+ partners agree and they are at least 75% of the crew entered
  today ("3/3 crew today"); other suggestions are chips and ↓ steps through them. Silent wrong
  codes (accepted with Enter) 24.3 -> 3.9% of entries; the box is filled for 51% of entries.
- A crew's record of several lines (with the hour split) fills every line when the crew agrees
  (12 of 13 right); whole record right 55.4 -> 55.8%.
- Empty worker box: "probably next" (3 of the last worker's crew, then the last day's workers in
  sheet order). The next worker is in the list 4% -> 75% of the time (crew order, top 12); ↓ and
  Enter picks, a plain Enter never does.
- Worker search: `inb3` finds INB-03 (leading zeros optional).
- "⚠ crew" on the manpower sheet when the code differs from 3+ of the worker's usual partners in
  that day: fires on 3-4% of correct entries, catches 41% of planted misread codes.

**Tried and rolled back**
- Partners with Out within ±1 h (or 2 h): times worse (SUB CONTRACT 51.7 -> 44.6%), codes no better.
- Working-day distance in the browser suggestions: within ±0.3 points, so left out.
- Day builder crews for workbooks without codes: SUB CONTRACT 56 -> 83 actions a day.
- Companion chips: fewer chips (8) find fewer crew members (2.3 vs 2.8 right per entry); lowering
  recently absent workers changed nothing.

## Analysis tab (1 Nov 2026)

Asked for: an analysis part with everything the data can give; the QS will say what to drop.

- New **Analysis** tab, worked out in the browser from the loaded month (Excel is not asked):
  - **Overview**: hours, normal and overtime hours, OT share, worker-days, people, average and
    peak headcount, ZIDLE hours; headcount by day; top activities and trades.
  - **Activities**: hours, normal, OT, worker-days, people, days, first/last day and share per
    code with its place; click a row for its trades.
  - **Places & trades**: the same per place (from the code's place ending) and per trade.
  - **Daily manpower**: people on site per day stacked by trade, Sundays and holidays marked,
    with a table per day.
  - **Task timeline**: hours per activity per day as a heat map (when each task ran).
  - **Overtime**: by day, by trade (share, per person) and by person (late and past-midnight days).
  - **Attendance**: days, days away, Saturdays/Sundays/holidays, longest and current run without
    a day off (14+ flagged); one person with two calling names counts once.
  - **Data quality**: the tool's checks by rule, workers with entries but no valid employee code,
    ZIDLE hours, entries without a code, codes not in the activity list, codes used once or
    twice, days over 14 hours.
  - **Compare months**: each workbook's totals, trades and top codes side by side (kept in the
    browser once a workbook's month has loaded).
- Filters for trade, place, activity and day range apply to every view.
- **Export to Excel**: all tables as sheets of one .xlsx (`POST /api/analysis/export`, openpyxl;
  text that looks like a formula stays text).
- Overtime and worker-days of an entry are shared over its activity lines by their hours, so every
  table adds up to the same totals.
- The top bar wraps below 1280 px wide so the new tab fits on laptop screens.
- Tests: `tests/analysis.test.cjs` (in `npm test`), `backend/tests/test_analysis_export.py`,
  `e2e/analysis.cjs`; made-up data only.

## Out at 22:00 takes off dinner (1 Nov 2026)

Asked for: when Time Out is 22, 2 hours must come off (in Excel, -1 in Additional hours); it
did not happen automatically.

- Typing or picking Time Out exactly 22:00 now fills **-1** in Additional hours and *dinner* in
  Remarks (an existing remark is kept). Worked hours and the activity hours update at once.
- Changing Out away from 22:00 takes the automatic values out again. Clearing Additional by hand
  (no dinner taken) is left alone; a value typed in Additional is never replaced.
- Not for 22:00 the next morning (Excel already takes off 2 h after 22:00).
- Tests: `tests/dinner.test.cjs` (in `npm test`) and `e2e/dinner.cjs`, on made-up data.

## SQL in the command box (1 Nov 2026)

Asked for: full SQL in the command feature (names starting with B or ending with S, SELECT …
WHERE ZIDAL = …, GROUP BY with SUM, INSERT, UPDATE, DELETE).

- The command box takes **SELECT** (DISTINCT, expressions, COUNT/SUM/AVG/MIN/MAX with DISTINCT,
  GROUP BY, HAVING, ORDER BY by column, alias or number, LIMIT/OFFSET; WHERE with AND/OR/NOT,
  = != <> < > <= >=, LIKE with % and _, IN, BETWEEN, IS NULL, + - * /, ROUND, UPPER, LOWER,
  LENGTH, TRIM, ABS, COALESCE), **INSERT … VALUES** (several rows), **UPDATE … SET … WHERE**
  (values may use columns: `SET out = out + 1`) and **DELETE … WHERE**.
- Tables: `entries` (also labor, labour, work, timesheet: worker-days from Excel plus the queue,
  with worked, OT and normal hours), `activities` (one row per activity line), `workers` (Labour
  Detail), `codes` (the activity list) and `days`.
- Column names are forgiving: case, spaces, underscores and a final s do not matter, and common
  other names work (`` `in times` `` = in, `` `ot hours` `` = ot, `` `activity codes` `` = code,
  ZIDAL = employee_code). Dates with times pick the day and the time; LIKE '2026-10-01%' works on
  In and Out.
- Same safety as the commands: SELECT changes nothing; INSERT, UPDATE and DELETE only fill the
  queue (checked, on the manpower sheet, one undoable push). UPDATE and DELETE without WHERE are
  refused; OT, worked and normal hours cannot be set (Excel works them out from the times), and
  the message says what to change instead. Workers, codes and days cannot be changed with SQL.
- While typing: SQL is recognised from the first word in capitals, suggestions offer tables (by
  any of their names), columns, functions and keywords, and the card explains each keyword,
  table and column ("ZIDAL" means employee_code). The box is now several lines: Enter runs,
  Shift+Enter adds a line. The help lists the tables and their columns.
- Fixed while testing: the suggestions stayed open after running and covered the button to the
  queue; a SELECT showed "in the queue now".
- Tests on made-up data: `frontend/tests/sql.test.cjs` (14 tests, the examples asked for) in
  `npm test`, and `frontend/e2e/sql.cjs`.

## All day without a restart: reliability and data cleaning (1 Nov 2026)

Asked for: the tool must work all day without crashing or slowing down, safely, with the
suggestions as good as before. Measured first, on made-up data only:

- **A long day** (`frontend/e2e/soak.cjs`, a made-up month of 250 workers): 11 days x 60 workers
  entered at full speed with the suggestions, a push a day, window switches, tab changes and
  commands. Picking a worker stayed at 45-60 ms from the first day to the last, pushes 0.3 s,
  the server at 143-148 MB, the page at 7-8 MB; the page only grows by the new rows of Recent
  batches (kept to 200). No leak: an early reading that looked like one was the test tool
  holding on to elements, not the app.
- **Waiting entries are kept.** The queue is saved per workbook as it changes: a reload, a
  browser crash, a restart of the PC or a switch to another workbook no longer loses entries
  that were not pushed yet ("Restored 12 entries that were waiting…"). Switching workbooks no
  longer asks; closing a workbook asks, then drops its entries. Saved entries older than 3 days
  are dropped.
- **The Excel thread restarts itself** if it stopped (e.g. Excel crashed during a call), instead
  of every request waiting until it timed out.
- **Temporary copies are deleted**: a dropped workbook's copy (~100 MB) and its practice folder
  when it is replaced or closed (its change log closed first: Windows keeps open files, and a
  closed workbook no longer holds one open all day), the session folder when the tool stops, and leftovers of earlier runs older than a day
  at start (Windows' temp folder no longer fills up over the weeks).
- **Recent batches** shows the batches of the workbook in use only (the log holds all of them;
  undo of another workbook's batch was refused anyway).
- **Data cleaning:** odd cell values (text in times, #N/A, true/false, huge numbers, dates in
  odd places) were fed through the readers, the calculations, every check and the health check
  (`backend/tests/test_fuzz.py`, 40 rounds) and through the suggestions and the commands
  (`frontend/tests/fuzz.test.cjs`, 300 runs): no crash. Requests with impossible values (times
  past 48, hours out of range, huge remarks) are refused with a 422 instead of a server error.
- **Suggestions unchanged:** `frontend/tests/suggestions.test.cjs` compares every code, time and
  "usually together" suggestion for a made-up month with a saved reference (916 entries,
  identical). The "usually on the same record" chips are now worked out only when their inputs
  change.
- Story progress older than two weeks is dropped from the browser's storage.
- Two health-check tests no longer depend on the current month.
- `npm test` runs the command, suggestion and junk-value tests.

## Commands moved to Codes & registration (31 Oct 2026)

- The command box is now at the top of the **Codes & registration** tab, out of the way of
  daily entry. **Ctrl+K** still works from any tab: it opens that tab with the cursor in the box.
- After a command, **Check and push N waiting entries →** goes to the entry screen, where the
  queue and the manpower sheet are.

## Commands: change many entries at once by typing (31 Oct 2026)

Asked for: a programmable way to do bulk changes ("out 19 to 20 on 10 days", "copy these four
workers' day 26 to day 21"), with as many control words as possible, good suggestions and a box
that explains each word (typing `insert` explains ADD).

- **Commands** above the entry form (Ctrl+K). Eleven commands, each with plain-English synonyms
  (about 70 words in all): SET, SHIFT, ADD, COPY, FILL, MOVE, SWAP, CLEAR, REPLACE, ROUND, SHOW.
  Workers by name, range, prefix, all, crew of, trade, except; days by number, range, weekdays,
  saturdays, sundays, holidays, today/yesterday; WHERE with =, !=, <, >, <=, >=, like, contains,
  empty, joined with and. Times as 7, 7.30, 19:00; amounts as +1, -0.5, +30m, 1:30.
- While typing: suggestions complete the word (Tab), a card explains the word under the cursor
  (a synonym names its command; a number after a time field reads as a time, after FROM as a
  day), and a preview says what Enter will do or what is wrong ("Did you mean set?"). ↑ recalls
  earlier commands; *All commands* lists every command with clickable examples.
- Safe by design: a command only puts ordinary entries in the queue (the queue counts as the
  current state, so commands build on each other). They get the usual checks, show on the
  manpower sheet where each can be changed or removed, and are written only by Push, as one
  undoable batch. Hours follow new times. Copying onto entries already in Excel asks for Replace
  in the queue unless OVERWRITE is added. No AI: a strict parser.
- Tests on made-up data only: `npm test` (the command engine, `frontend/tests/commands.test.cjs`)
  and `frontend/e2e/commands.cjs` (the box, down to what a push writes).

## Add activity codes from the tool (31 Oct 2026)

Asked for: add new activity codes to Labour Detail without switching to Excel.

- **Codes & registration** tab, **Activity codes**: type new codes (one per line or comma
  separated). Each is checked as you type: letters, digits and dashes only, already in the list,
  typed twice, not the usual NN-NN-NN-NN form, or a place ending not named yet. **Add N codes to
  Labour Detail** asks first, then writes each code (trimmed, in capitals) into the next empty
  or space-only cell of column L, rows 3 to 502 (the INDIAN list is full to L311 and padded with
  spaces below, so new codes go to L312 on). Like every write: checked again on a fresh read,
  backup first, read back, logged, and undoable from Recent batches. The codes can be used in
  entries at once; they are not saved in Excel until **Save Excel file**.
- Only those column L cells are allowed for this write (E09 guard); undo of them needs no worker
  on the row.
- If Labour Detail is protected in Excel, Excel refuses the write and the tool says so.
- `POST /api/activities/add`; tests in `backend/tests/test_setup.py` and
  `frontend/e2e/add-activity.cjs`. Two older browser tests updated (the new section comes first
  on the tab; a timing race).

## Slow PCs: less reading through Excel, progress, a log (30 Oct 2026)

Reported: on coworkers' PCs (i5 10th gen, 8 GB, 3 GB of it for graphics) the tool kept loading.
In practice mode it is light (about 150 MB for the server, 11 MB for the page, a worker picked in
0.1-0.2 s with the CPU slowed 4x), so the cost is in live mode, where every read goes through
Excel. Found and changed:

- **Half the reading.** A day sheet was read whole through Excel: 3,508 rows x 18 columns, 31
  times on every check. Now only the blocks that can hold a worker are read (the last worker in
  Labour Detail plus 10 blocks): about 1,780 rows for the INDIAN workbook. Rows past them are
  blank, so the result is the same.
- **No pile-up.** The check gave up after 2 minutes while Excel went on reading, and pressing
  Check again queued a second full read behind the first. The check now has 15 minutes, a second
  one is refused while one reads, and re-reading on switching back from Excel is skipped while
  the last one is still on its way.
- **Progress.** While the start page reads it shows "Reading from Excel: sheet 12 (12 of 32)" with
  a bar, instead of a spinner.
- **A log on each PC**: `Labour Entry Tool/logs/labour-tool.log` (path printed at start): version,
  Windows and memory at start, Excel steps over 2 s, requests over 5 s, errors.

## Day list newest first; batches list scrolls (30 Oct 2026)

- **Already in Excel for this day** shows the workers pushed most recently at the top, each with
  "added 12:54" (the push time), newest push first. The workbook keeps no entry times, so the
  order comes from the tool's change log; rows typed in Excel directly have no time and follow
  below in sheet order. Undone pushes don't count.
- **Recent batches** keeps a fixed height (240 px) and scrolls; it now loads the last 200 pushes.
- `frontend/e2e/daylist-order.cjs` tests both on made-up data.

## Time cards from an Excel list (30 Oct 2026)

Asked for: print time cards from an Excel file of calling names instead of typing them.

- On the Time cards tab, **Load from Excel file…** (or drop the file on the list box) reads an
  .xlsx, .xlsm or .csv and fills the list with its calling names **in the file's order**, which
  is the print order. A file with several columns works too: the column with the most names
  from Labour Detail is used, a header row is skipped, other columns (names, NIC) are not read.
  Names not in Labour Detail are listed as "Not found" before printing.
- The file is only read, in memory: nothing is saved or changed.
- `POST /api/timecards/list`; tests in `backend/tests/test_timecards.py` and
  `frontend/e2e/timecards-list.cjs` (made-up files).

## Entered on the wrong day: move a sheet (30 Oct 2026)

Found in use: entries typed without checking the day only showed up as wrong in the manpower
sheet, and the only way out was to discard the sheet and type it all again.

- Under each day of the manpower sheet: **Move to [another day…]** moves all of that sheet's
  waiting entries to the chosen day, after a confirmation naming both days. A worker already
  waiting on that day is replaced (said in the confirmation), not doubled. The moved entries are
  checked again for the new day (confirmations and overwrite start over), and the entry screen
  follows to it. Nothing is written to Excel until the push.
- The form heading shows the day being entered: "Add a worker · Friday, October 9 (sheet 9)", in
  orange, so the day is in view while typing.
- `frontend/e2e/move-sheet.cjs` tests it on made-up data, down to what reaches the workbook.

## Reverted: suggestions for workbooks without codes (30 Oct 2026)

The change that found partners by times alone and grouped workers by calling-name prefix
(commit 12387d8) broke the suggestions in use and was reverted: suggestions work as before it.

## Close a workbook from the top bar (30 Oct 2026)

- The workbook name in the top bar is now a menu of the workbooks open in the tool: click one to
  work on it, **✕ Close** to take it off the list, or **Open another workbook** (was *+ Workbook*).
  Closing asks first and only takes the workbook off the list: the file and Excel are not
  changed, and it can be opened again later.
- Closing one that is not in use leaves the entry screen and its waiting entries as they are.
  Closing the one in use warns if entries are still waiting, then moves to another open
  workbook; closing the last one goes back to choosing a workbook.
- The made-up demo (`scripts/demo_two_books.py`) now opens three workbooks;
  `frontend/e2e/close-workbook.cjs` tests closing them.

## Test pass: two bugs fixed (30 Oct 2026)

Every test run end to end: 354 backend tests (with the golden tests on the sanitized October
snapshot), lint, type checks, and all 12 browser tests on practice copies.

- **Fixed: "Next day" kept from a suggestion.** A worker whose suggested times run past midnight
  (e.g. 07:00-03:00) got "Next day" with the suggestion; typing a day shift over it (Out 19)
  kept "Next day", so 07:00-19:00 counted as 34 hours. Typing over suggested times now works
  "Next day" out again from the times typed.
- **Fixed: a fast Enter after taking a suggested code.** The second activity box only appeared
  a moment after the code was taken, so a quick next Enter moved to it instead of adding the
  worker (4 of 20 workers in a fast run). The box is now there beforehand, and the times and
  code move the cursor on at once: name and Enter five times adds a worker at any speed.
- Lint: the lines the rename made too long (the pre-commit check would have refused a commit).
- `fixtures/sanitized/*.json` is now ignored by git: the snapshot is built from the real
  workbook and stays on the PC (nothing of it was ever committed).
- Two older browser tests (`ui-smoke`, `same-for-many`) updated for the cleared form.
- Data note, not a bug: in the October INDIAN workbook, sheet 25 (Sunday 25 Oct) has day type
  "Holiday" while 25 Oct is not in the holiday list; the tool blocks a push there until the day
  type is fixed or 25 Oct is added as a holiday.

## Discard a whole sheet before pushing (30 Oct 2026)

- Under each day of the manpower sheet: **Discard sheet N** removes all of that sheet's waiting
  entries, after a confirmation that names the sheet, its date and how many entries go. Other
  sheets stay in the queue and Excel is not changed. (Entries already pushed are taken back with
  Undo, as before.)
- `frontend/e2e/discard-sheet.cjs` tests it on made-up data.

## Suggested times filled in (30 Oct 2026)

Found in testing: the suggested times were only shown in the empty boxes; they had to be typed.

- Picking a worker now **fills in** Time In and Time Out with the suggested times (orange until
  changed) and selects Time In. Right: Enter, Enter goes on to the activity. Wrong: type, and the
  new time replaces it (also when typed straight after picking the worker). Typing another name
  takes the suggested times away again; times already in the form are never replaced.

## A clean form after each worker, with suggested times (30 Oct 2026)

Found in testing: after adding a worker (or a set of workers) or pushing, the times and activity
code stayed in the form, so the next worker's suggestions never showed.

- After **Add worker** the form is cleared, and after a push too (unless a worker is being
  typed). Keeping the last entry was there for crews; the suggestions now cover that, because the
  workers just added count as "today" for their partners.
- **Suggested times**: the empty Time In and Time Out show the suggested times; Enter on Time In
  takes both and goes to the activity. From the times most of the worker's usual partners have
  today, else their usual times this month, else their trade's times today. Replayed on the
  October INDIAN workbook: exactly right for 71% of 4,074 entries (code suggestions unchanged:
  76% first, 89% top three).
- A worker of a crew is now four Enters when the suggestions are right: name, Enter (times),
  Enter (code), Enter (add).
- `frontend/e2e/suggest-fill.cjs` tests it on made-up data.

## Change entries on the manpower sheet before pushing (30 Oct 2026)

Found in testing: the manpower sheet only showed the waiting entries; nothing could be adjusted
there before pushing.

- Click an **In**, **Out** or **hours** cell to change it in place (Enter saves, Esc cancels). A
  new In or Out also scales the activity hours when they added up to the worked hours (as the
  entry form does): 07:00-19:00 with 11 h becomes 07:00-21:00 with 13 h. Times accept the same
  input as the form (7, 7.30, =16-7); an Out earlier than In is the next morning.
- Under each worker's name: **✎** moves the entry back into the form, **✕** removes it.
- The queue re-checks after every change; while it does, the sheet says "Checking…" instead of
  showing the entries as problems.
- `frontend/e2e/manpower-edit.cjs` tests it on made-up data, down to what reaches the workbook.

## Name: Pattern-Based Labour Entry Assistant (29 Oct 2026)

The tool is now called the **Pattern-Based Labour Entry Assistant** ("Labour Entry Assistant" in
the top bar and the browser tab): pattern recognition on the workbook's own entries, by counting,
with no AI and no internet. The data folder (`Labour Entry Tool`), `LabourEntryTool.exe` and the
repository keep their names, so nothing moves.

## v1.0.0 (29 Oct 2026)

First release: the Windows package (`LabourEntryTool-windows.zip` on the Releases page) and
everything below.

## Windows package: no Python needed (29 Oct 2026)

Asked for: run the tool on a PC where Python is not installed.

- `LabourEntryTool.exe` in a folder with Python and every package inside (PyInstaller, one
  folder, about 60 MB unzipped). Double-click starts the tool and opens the browser, like
  `start.bat`; double-clicked again while it runs, it just opens the browser. An error stays on
  screen instead of the window vanishing. An optional `config.yaml` goes next to the .exe.
- Built on GitHub's Windows machines on every push to main
  (`.github/workflows/windows-package.yml`): tests, build, a self-test of the parts that load
  late (Excel COM, the Browse dialog, the .xlsb readers), a start-up check against the start
  page, then `LabourEntryTool-windows.zip` under the run's Artifacts. A `v*` tag also publishes
  it as a release.
- `start.bat` (with Python and `git pull`) still works as before.

## Place names and better activity code suggestions (29 Oct 2026)

Research on the INDIAN October workbook (read only): the activity list is the project's WBS
codes, numbered after MasterFormat: four pairs for the kind of work (`03-11` formwork, `03-20`
reinforcing, `04-22` block masonry, `01-54-23` scaffolding, ...) and an optional suffix for the
place (on this project `-P` parking area, `-A` arcade, `-C` core, `-S` skywalk, `-C-1` core 1,
`-C-8` core 8). Codes and suffixes differ per project, so none is written into the tool.

- **Place names, asked once.** After the first check of a workbook, the start page lists the
  suffixes found in its activity list (most used first; the rare ones folded away) and asks what
  they mean. The names are kept per project (the sheets' Project / Activity Centre), so every
  workbook of the site shares them, and they survive restarts. A suffix is asked about once,
  named or left blank; a new one appearing in a later list is the only thing asked again.
  *Place names* on the start page edits them.
- The entry screen shows the place under the activity code, in the code list and on the
  suggestion chips; the manpower sheet shows it in the Description column.
- **Code suggestions, partners first.** Replaying the whole month showed what predicts a
  worker's code best: the code their usual partners (same code and times on the last days) have
  today, then workers of the trade with the same times, their own last day, the trade today and
  this month. First guess right for 76% of the 4,075 entries, top three 89% (own last day first,
  as before: 64% and 85%). The best one shows in the empty first Activity box; **Enter takes
  it**. The others are chips ("Codes:") with the place and why they are suggested; the code
  list puts them first.

## Several workbooks; activity checks per workbook (29 Oct 2026)

Asked for: the SUB CONTRACT workbook has the same layout as the INDIAN one, but no activity codes
(Excel books all the hours to ZIDLE). Work on several workbooks, and make the activity-code and
hours check a setting of each workbook.

- **Several workbooks at once.** *+ Workbook* (top bar) opens another workbook on the start page;
  the ones already open stay open, each with its own connection, month, checks and undo. A menu in
  the top bar switches between them; one already checked opens straight on the entry screen. If
  entries are still waiting to go to Excel, switching asks first (they belong to the workbook
  they were made for). The start page lists the open workbooks, to switch to or close.
  *Change workbook* is now *Check workbook*.
- **Check activity codes and hours**, a tick box on the start page, per workbook. Off: the rules
  on activity codes and their hours (E04, E05, E06, M05, M06, W08, and E03 on activity hours)
  are left out of the health check, the queue and the day list; the readiness check no longer
  asks for an activity list or the medical code; the entry form has no activity boxes (Enter on
  Time Out adds the worker); medical leave is hidden; the manpower sheet has no activity rows.
- The tool unticks it by itself for a workbook whose activity list is empty, or where many
  entries have times and none has a code. A choice made by hand is remembered for that kind of
  workbook (next month's "... November 2026 - SUB CONTRACT" too), in `workbooks.json` in the data
  folder.
- On the SUB CONTRACT file (read only, nothing changed): its activity list is empty, and none of
  its 1,497 entries with times has a code. Its health check had 1,496 "unallocated hours go to
  ZIDLE" (W08) notes; with the box unticked they are gone.
- `scripts/demo_two_books.py` and `frontend/e2e/workbooks.cjs`: two made-up workbooks, one with
  codes and one without, to try or test this.

## The page waiting forever for Excel (29 Oct 2026)

Found in testing: the page stayed blank on start. The server was running, but `/api/setup`
never answered. It asks Excel for its open workbooks, and Excel answers no other program while
a message box or dialog is open (or a cell is being edited).

- The start page waits at most 5 seconds for that list, then shows: "Excel isn't answering.
  Check Excel for an open message box or dialog (or a cell being edited), close it, then press
  Check again", with a Check again button.
- Every other request to Excel gives up after 2 minutes with the same advice instead of hanging.
- If anything in the page breaks, the error is shown on screen with a Reload button instead of
  a blank page.

## Time cards on protected sheets (29 Oct 2026)

Found in testing: opening the Time cards tab showed "Excel error: '-2147352567 Exception
occurred. (0, None, None, None, 0, -2146827284)'". That is Excel's 0x800A03EC ("can't do that
here"), raised while reading a time card sheet's formulas to find the Calling Name cell. Excel
refuses that read on a protected sheet whose formula cells are hidden.

- The Calling Name cell is then found from the labels and values alone (E8 on Time Card
  (Internal)). A sheet Excel won't read no longer breaks the tab: it shows a note, and the cell
  can be typed by hand.
- Excel's error inside a COM exception is now decoded: 0x800A03EC reads "Excel refused the
  request. The sheet may be protected, or a cell locked." (or Excel's own description), never
  the raw numbers.
- If the calling name can't be written (a locked cell on a protected sheet), the message says
  how to fix it: unlock the cell (Format Cells > Protection > untick Locked) or unprotect the
  sheet. Printing itself works on protected sheets.

## Print time cards in one go (29 Oct 2026)

- New **Time cards** tab. Give it a list of workers (`INB-01 to INB-20`, a comma list, "everyone
  who worked this month" or "everyone in Labour Detail"); it shows the exact cards and flags names
  it can't find. For each worker it writes the calling name into the time card sheet's Calling
  Name cell, lets Excel recalculate the card, and prints the sheet through Excel (`PrintOut`) with
  the print area, page setup and printer set in Excel, without the print dialog.
- The time card sheets ("Time Card" in the name) and their input cell are found automatically:
  the cell right of the "Calling Name" label that the card's formulas refer to (E8 on Time Card
  (Internal)). The cell can be changed on the page.
- Runs card by card on the Excel thread, with a progress bar ("Printing 5 of 20: INB-05"), 1
  second between cards for the print queue, 1 to 5 copies each, and "Stop after this card".
  Afterwards the cell gets its original value back; nothing is saved. Only a time card sheet's
  single cell can be written this way, never a day sheet or Labour Detail.
- Practice mode goes through the list without printing.
- Tests: `backend/tests/test_timecards.py` (cell detection, the job, refusals, stop), an xlwings
  stand-in test (write, recalculate, print in that order), `frontend/e2e/timecards.cjs`.

## A look with more colour (29 Oct 2026)

- Site palette: a dark slate top bar with an orange brand mark and orange rule, safety orange for
  the main actions and step numbers, a warm paper background and white cards with a soft shadow.
  Dark mode follows the same scheme.
- Each part of the screen has its own coloured top edge: day row (slate), entry form (orange),
  manpower sheet (blue), waiting list (green), day list and batches (grey). The start page cards
  use orange.
- Day row: Saturdays amber, Sundays and holidays red (from each sheet's day type), a green dot
  under days that have entries, the open day solid orange, and a small legend.
- The quick-fill tools are dark slate buttons, apart from the orange main flow; worked hours in
  large orange type (green when all is well).

## Search inside the suggestions box (29 Oct 2026)

- The blue box under the worker now starts with a search field ("Search for another worker…").
  While something is typed, the buttons show matching workers from the whole Labour Detail (up
  to 12; "entered" marks workers who already have the day). With the box empty, the "usually on
  the same record" suggestions come back. It shows even when there are no suggestions.
- A click on a result adds it and keeps the results, to click several. Enter adds the top (or
  highlighted, ←/→) result and clears the box for the next name. A comma list still works; Esc
  clears the search; Backspace on an empty box removes the last added worker.
- This replaces the separate "+ add a worker" box in the "Same entry also for" row.

## Day list scrolls in its own box (29 Oct 2026)

- "Already in Excel for this day" (200+ rows on a full day) now scrolls inside a box of at most
  520 px (60% of the window on small screens), with its column headings fixed at the top. The
  rest of the page no longer stretches.

## Hours follow each worker's own times (29 Oct 2026)

- A worker given their own times in a group gets hours that fit their own day, typed hours
  included: 7–19 typed as 11 h becomes 13 h for a worker at 7–21, and 11 h for one at 7–19.
  - One activity: always that worker's own worked hours.
  - Several activities whose typed hours fill the main worker's day: shared again in the same
    proportions over the other worker's day, in quarter hours (5.5 + 5.5 at 7–19 → 6.5 + 6.5 at
    7–21).
  - Typed hours that don't fill the day stay as typed; blank ones share the rest.
- `frontend/e2e/own-times.cjs` checks the typed case: 11 typed at 7–19 → 13 written at 7–21.

## Own times for one worker in a group (29 Oct 2026)

- Right-click a name in "Same entry also for" (or click it) to give that worker their own Time In
  and Time Out (Enter saves, Esc cancels). The chip then shows them, e.g. "INB-05 · 08:00–17:00".
  Activities stay shared. Hours left blank are worked out from that worker's own times; typed
  hours stay as typed. "Same as the others" removes the own times, and removing the chip removes
  them too.
- New browser test `frontend/e2e/own-times.cjs`: three workers, one with 08:00–17:00, are written
  as 7–19 (11 h), 7–19 (11 h) and 8–17 (8 h).

## Excel-style sums in the number boxes (29 Oct 2026)

- Hours, Additional hours, Time In and Time Out accept a sum starting with "=", as in an Excel
  cell: `=16-7` → 9, `=21-5` → 16, `=(21-5)/2` → 8, `=6+24` → 06:00 next day. The answer shows
  under the box while typing ("= 9"); leaving the box replaces the formula with its number, which
  is what gets written to Excel. Enter adds the worker straight from a formula.
- Only numbers, + − × ÷ (or * /) and brackets: a small parser (`frontend/src/calc.ts`), never
  `eval`. A wrong formula ("=16-", "=1/0") is flagged: "Check the formula, e.g. =16-7".
- New browser test `frontend/e2e/formulas.cjs`.

## Very long days are allowed (29 Oct 2026)

- A day over 16 worked hours (e.g. 07:00 to 06:00 next morning = 21 h) is now a note, not a
  warning: still shown ("Very long day … Nothing to do if the times are right"), but it no longer
  needs "It's correct" ticked and never holds up the push. Rule W01 is INFO.
- "✓ Looks right" also shows when the only messages are notes.

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

Office practice (from the site office): a worker on medical leave gets a medical line `<base> M` (e.g.
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
