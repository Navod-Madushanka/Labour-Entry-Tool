"""Build a small synthetic entry workbook (.xlsb) with desktop Excel, for reader tests.

It uses the template layout (PLAN.md §5) with made-up workers only, no real data. It runs in its
own hidden Excel instance and never touches workbooks the user has open.

Usage (Windows with Excel):
    python scripts/make_synthetic_xlsb.py [-o fixtures/synthetic/template_synthetic.xlsb]
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = REPO_ROOT / "fixtures" / "synthetic" / "template_synthetic.xlsb"
XL_EXCEL12 = 50  # FileFormat for .xlsb

# Labour Detail rows 3.. (row 7 left blank on purpose): A..H. "=NA()" makes a real #N/A.
WORKERS = {
    3: ["INB-01", "Test Worker A", "Barbender", "T0000001", None, None, "X00001", None],
    4: ["INB-01 CH", "Test Worker A", "Carpenter", "T0000001", None, None, "X00001", None],
    5: ["INC-02", "Test Worker B", "Carpenter", 12345678, None, None, "=NA()", None],
    6: ["INH-03", "Test Worker C", "Helper", "T0000003", None, None, 0, None],
    8: ["INM-04", "Test Worker D", "Masan", "T0000004", None, None, "X00004", None],
}
ACTIVITIES = ["03-11-00-00", "03-11-00-00-P", " 03-20-00-00-C-8", "03-31-05-35-P", "03-31-05-35-P"]
DAY_TYPES = ["Normal Day", "Saturday", "Sunday", "Holiday"]

# (sheet, block) -> In, Out, Add, [(J, K) rows 1-5], remark
ENTRIES = {
    ("1", 0): (7, 19, None, [("03-11-00-00", 8), ("03-11-00-00-P", 3)], "test remark"),
    ("1", 2): (7, 22, -1, [("03-11-00-00", 13)], None),
    ("1", 3): (18, 23.5, None, [(" 03-20-00-00-C-8 ", "13`")], None),
    ("1", 5): (7, None, None, [], None),
    ("2", 1): (7, 30, None, [("03-11-00-00-P", 21)], None),
}

FIRST_BLOCK_ROW, BLOCK_SIZE, BLOCKS = 9, 7, 500


def effective_formula(r: int) -> str:
    """A stand-in for the real E formula: only here so pyxlsb has cached numbers to read."""
    g, h, add = f"G{r}", f"H{r}", f"L{r}"
    return f"=IF({h}>22,({h}-{g})-2+{add},IF({h}>12,({h}-{g}+{add})-1,{h}-{g}+{add}))"


def build(out: Path) -> None:
    import xlwings as xw

    app = xw.App(visible=False, add_book=False)
    try:
        app.display_alerts = False
        app.screen_updating = False
        wb = app.books.add()
        master = wb.sheets[0]
        master.name = "Labour Detail"
        while len(wb.sheets) > 1:
            wb.sheets[1].delete()

        master.range("A2").value = [
            "Calling Name", "Name", "Trade Group", "NIC No.",
            "Daily Rate", "Business Partner", "Employee Code", "EPF No",
        ]  # fmt: skip
        master.range("L2").value = "WBS Code"
        master.range("A3:A502").number_format = "@"
        master.range("D3:D502").number_format = "@"
        master.range("L3:L400").number_format = "@"
        for row, values in WORKERS.items():
            for col, value in zip("ABCDEFGH", values, strict=True):
                if value is None:
                    continue
                cell = master.range(f"{col}{row}")
                if isinstance(value, int):
                    cell.number_format = "General"
                if isinstance(value, str) and value.startswith("="):
                    cell.formula = value
                else:
                    cell.value = value
        master.range("A503").value = "End"
        for i, code in enumerate(ACTIVITIES):
            master.range(f"L{3 + i}").value = code
        master.range(f"L{3 + len(ACTIVITIES) + 1}").value = "after-blank"  # must not be read
        master.range("N3").options(transpose=True).value = DAY_TYPES

        last_row = FIRST_BLOCK_ROW + BLOCK_SIZE * BLOCKS - 1
        for n in range(1, 32):
            sht = wb.sheets.add(str(n), after=wb.sheets[-1])
            sht.range("F3").value = dt.datetime(2026, 10, n)
            weekday = dt.date(2026, 10, n).weekday()
            sht.range("H3").value = {5: "Saturday", 6: "Sunday"}.get(weekday, "Normal Day")
            sht.range("F4").value = n
            sht.range("F5").value = "Tester"
            sht.range("C6").value = "KMTT"
            sht.range("J9:J3508").number_format = "@"
            col_a = [[""] for _ in range(FIRST_BLOCK_ROW, last_row + 1)]
            for k in range(BLOCKS):
                col_a[k * BLOCK_SIZE] = [f"='Labour Detail'!A{3 + k}"]
            sht.range(f"A{FIRST_BLOCK_ROW}:A{last_row}").formula = col_a

        for (sheet, block), (t_in, t_out, add, acts, remark) in ENTRIES.items():
            sht = wb.sheets[sheet]
            r = FIRST_BLOCK_ROW + BLOCK_SIZE * block
            sht.range(f"G{r}:H{r}").value = [t_in, t_out]
            if add is not None:
                sht.range(f"L{r}").value = add
            if remark:
                sht.range(f"R{r}").value = remark
            for i, (code, hours) in enumerate(acts):
                sht.range(f"J{r + i}").value = code
                if isinstance(hours, str):
                    sht.range(f"K{r + i}").number_format = "@"
                sht.range(f"K{r + i}").value = hours
            sht.range(f"E{r}").formula = effective_formula(r)
            sht.range(f"M{r}").formula = f"=IFERROR(VLOOKUP(A{r},'Labour Detail'!A:G,7,FALSE),\"\")"
            sht.range(f"O{r + 5}").value = "ZIDLE"
            sht.range(f"P{r + 5}").formula = f"=E{r}-SUM(K{r}:K{r + 4})"
            sht.range(f"Q{r + 6}").formula = f'=IF(E{r}-8>0,E{r}-8,"")'

        app.calculate()
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists():
            out.unlink()
        wb.api.SaveAs(str(out), FileFormat=XL_EXCEL12)
        wb.close()
    finally:
        try:
            app.quit()
        except Exception:
            app.kill()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("-o", "--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    build(args.out.resolve())
    print(f"wrote {args.out.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
