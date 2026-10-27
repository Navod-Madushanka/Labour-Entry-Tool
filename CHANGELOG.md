# Changelog

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
