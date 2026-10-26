# Changelog

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
