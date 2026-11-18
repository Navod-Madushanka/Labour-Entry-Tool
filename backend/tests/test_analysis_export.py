"""The Analysis export: tables become worksheets; made-up values only."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.api.analysis import ExportRequest, build_xlsx, sheet_title


def test_tables_become_sheets():
    req = ExportRequest(
        title="Oct",
        sheets=[
            {
                "name": "Activities",
                "note": "Hours by code",
                "columns": ["Code", "Hours"],
                "rows": [["03-11-00-00-P", 48.5], ["ZIDLE", 2]],
            },
            {
                "name": "Odd/name:with*chars and far too long for excel",
                "columns": ["A"],
                "rows": [["=1+1"], ["-5"], [None]],
            },
        ],
    )
    wb = load_workbook(io.BytesIO(build_xlsx(req)))
    assert wb.sheetnames[0] == "Activities"
    ws = wb["Activities"]
    assert ws["A1"].value == "Hours by code"
    assert [c.value for c in ws[3]] == ["Code", "Hours"]
    assert ws["B4"].value == 48.5
    odd = wb[wb.sheetnames[1]]
    assert len(odd.title) <= 31 and "/" not in odd.title
    assert odd["A2"].value == "=1+1" and odd["A2"].data_type == "s"  # never a live formula
    assert odd["A3"].value == "-5"


def test_sheet_titles_unique():
    taken: set[str] = set()
    assert [sheet_title(n, taken) for n in ["Data", "data", "Data"]] == [
        "Data",
        "data (2)",
        "Data (3)",
    ]


def test_endpoint(monkeypatch):
    from app.main import create_app

    client = TestClient(create_app())
    res = client.post(
        "/api/analysis/export",
        json={
            "title": "Labour analysis 2026-10",
            "sheets": [{"name": "S", "columns": ["x"], "rows": [[1]]}],
        },
    )
    assert res.status_code == 200
    assert "Labour analysis 2026-10.xlsx" in res.headers["content-disposition"]
    assert load_workbook(io.BytesIO(res.content))["S"]["A2"].value == 1
    assert client.post("/api/analysis/export", json={"sheets": []}).status_code == 422


def test_odd_text_from_the_workbooks_still_exports():
    """Seen exporting the BP bill check over four workbooks: a control character in one cell (pasted
    into Excel from another program) made the whole export fail with error 500. Made-up values."""
    import io

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from openpyxl import load_workbook

    from app.api.analysis import router

    app = FastAPI()
    app.include_router(router)
    c = TestClient(app)
    base = {"columns": ["Worker", "Days"], "rows": [["Worker\x0bone", 3], ["Two\x07", 2]]}
    sheets = [{"name": "Summary", "note": "note\x01", **base}, {"name": "BP\x07one", **base},
              {"name": "'Quoted BP'", **base}, {"name": "History", **base}]
    sheets += [{"name": f"BP {i}", **base} for i in range(80)]  # many business partners
    res = c.post("/api/analysis/export", json={"title": "BP bill check", "sheets": sheets})
    assert res.status_code == 200
    wb = load_workbook(io.BytesIO(res.content))
    assert wb.sheetnames[:4] == ["Summary", "BPone", "Quoted BP", "History (sheet)"]
    assert wb["Summary"]["A4"].value == "Workerone" and len(wb.sheetnames) == 84
