"""The tool never closes a workbook in Excel, nor Excel itself."""

import re


def test_the_tool_never_closes_excel():
    """No code path closes a workbook in Excel or quits / kills Excel. Files that talk to Excel
    (xlwings) may not call close at all; nowhere may quit, kill or taskkill."""
    import pathlib

    import app

    anywhere = re.compile(r"\.(quit|kill|Quit)\(|taskkill|\.Close\b")
    excel_close = re.compile(r"\.close\b|\.Close\b")
    # not Excel: the openpyxl reader of an uploaded name list, the change-log database
    allowed = {("timecards.py", "wb.close()"), ("api/setup.py", "book.service.audit.close()")}
    root = pathlib.Path(app.__file__).parent
    hits = []
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        talks_to_excel = "xlwings" in text
        for n, line in enumerate(text.splitlines(), 1):
            if (path.relative_to(root).as_posix(), line.strip()) in allowed:
                continue
            if anywhere.search(line) or (talks_to_excel and excel_close.search(line)):
                hits.append(f"{path.relative_to(root)}:{n}: {line.strip()}")
    assert not hits, "\n".join(hits)
