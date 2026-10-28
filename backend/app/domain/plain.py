# ruff: noqa: SIM102  (one "if rule ...: if match ..." per message shape reads best)
"""Problems in plain words for people who know the workbook from Excel, not the tool's rules.

``explain`` turns an ``Issue`` (rule id, technical message, cell) into a short title, where to look
(sheet, row, column name), what is wrong and what to do. No rule ids, "effective", "ZIDLE", "ERP"
or "block". The numbers come from the technical message, so a message that doesn't match keeps a
general wording instead of wrong numbers.
"""

from __future__ import annotations

import datetime as dt
import re

from pydantic import BaseModel

from app.config import TemplateConfig
from app.domain.models import Issue
from app.domain.validators import RULES
from app.excel.refs import parse_cell


class Plain(BaseModel):
    title: str  # what is wrong, in a few words
    where: str  # "Sheet 15, row 128, Hours column (cell K128), worker INB-17"
    what: str  # the problem, with the values from the sheet
    fix: str  # what to do


DAY_COLUMNS = {
    "calling_name": "Calling name",
    "total": "Total hours",
    "effective": "Worked hours",
    "time_in": "Time In",
    "time_out": "Time Out",
    "activity": "Activity code",
    "hours": "Hours",
    "additional": "Additional hours",
    "remarks": "Remarks",
}
MASTER_COLUMNS = {
    "calling_name": "Calling name",
    "name": "Name",
    "trade_group": "Trade",
    "id": "ID number",
    "daily_rate": "Daily rate",
    "bp": "BP",
    "employee_code": "Employee code",
    "epf": "EPF",
}
HEADER_CELLS = {"date": "date", "day_type": "day type", "sheet_no": "sheet number"}


def nice_date(text: str) -> str:
    """'2026-10-16' -> '16 Oct 2026' (left as it is when it isn't a date)."""
    try:
        return dt.date.fromisoformat(text).strftime("%d %b %Y").lstrip("0")
    except ValueError:
        return text


def nice_time(text: str) -> str:
    return text.replace(" (+1 day)", " next morning")


def where(issue: Issue, t: TemplateConfig) -> str:
    parts: list[str] = []
    master = issue.sheet == t.master_sheet
    if issue.sheet:
        parts.append(f"{issue.sheet} sheet" if master else f"Sheet {issue.sheet}")
    if issue.cell:
        try:
            row, col = parse_cell(issue.cell)
        except ValueError:
            row, col = None, None
        letter = re.sub(r"\d", "", issue.cell)
        name = None
        if master:
            name = {getattr(t.master_cols, k): v for k, v in MASTER_COLUMNS.items()}.get(letter)
            if letter == re.sub(r"\d", "", t.activity_list.split(":")[0]):
                name = "Activity list"
        elif issue.cell in {getattr(t.header, k): v for k, v in HEADER_CELLS.items()}:
            header = {getattr(t.header, k): v for k, v in HEADER_CELLS.items()}[issue.cell]
            parts.append(f"the {header} at the top (cell {issue.cell})")
            row = None
        else:
            name = {getattr(t.cols, k): v for k, v in DAY_COLUMNS.items()}.get(letter)
        if row is not None and col is not None:
            parts.append(f"row {row}")
            parts.append(f"{name} column (cell {issue.cell})" if name else f"cell {issue.cell}")
    if issue.calling_name:
        parts.append(f"worker {issue.calling_name}")
    return ", ".join(parts)


def _hours(text: str) -> str:
    return f"{text} hour" if text == "1" else f"{text} hours"


def _jargon(text: str) -> str:
    """Last resort for messages without their own wording."""
    for old, new in (
        ("effective hours", "worked hours"),
        ("effective", "worked"),
        ("ZIDLE", "idle time"),
        ("ERP upload lines", "payroll upload lines"),
        ("ERP line", "payroll upload line"),
        ("the ERP", "the payroll upload"),
        ("ERP", "payroll"),
        ("the block", "this worker's rows"),
        (" (+1 day)", " next morning"),
    ):
        text = text.replace(old, new)
    return text


def explain(issue: Issue, template: TemplateConfig | None = None) -> Plain:
    t = template or TemplateConfig()
    title, what, fix = _words(issue)
    return Plain(title=title, where=where(issue, t), what=what, fix=fix)


def _words(issue: Issue) -> tuple[str, str, str]:
    rule, msg = issue.rule, issue.message
    m = lambda pattern: re.search(pattern, msg)  # noqa: E731

    if rule == "E01":
        side = "Time Out" if msg.startswith("Out") else "Time In"
        verb = "left" if side == "Time Out" else "came in"
        return (
            f"{side} is empty",
            f"This worker has an activity or hours on this day, but the {side} box is empty.",
            f"Type the time they {verb} (for example 7 or 16). "
            "If they did not work that day, clear the whole row instead.",
        )
    if rule == "E02":
        return (
            "Time Out is not after Time In",
            "Time Out must be later than Time In, and no more than 24 hours later.",
            "Check the two times. If they worked past midnight, add 24 to Time Out "
            "(2 am becomes 26).",
        )
    if rule == "E03":
        if msg == "Activity has no hours.":
            return (
                "Hours are missing",
                "An activity code is entered, but the Hours box next to it is empty.",
                "Type how many hours they worked on that activity.",
            )
        if g := m(r"^Hours typed as text \('(.*)'\)"):
            return (
                "Hours typed wrongly",
                f"The Hours box has “{g.group(1)}”. Excel treats this as text, not a number, "
                "so it is not added up.",
                "Retype it as a plain number, for example 8 or 2.5.",
            )
        if g := m(r"^(In|Out) is text \('(.*)'\)"):
            side = "Time In" if g.group(1) == "In" else "Time Out"
            return (
                f"{side} typed wrongly",
                f"The {side} box has “{g.group(2)}”, which Excel cannot use as a time.",
                "Retype it as a number: 7 for 7:00, 7.5 for 7:30, 16.25 for 16:15.",
            )
        if g := m(r"^Additional hours is text \('(.*)'\)"):
            return (
                "Additional hours typed wrongly",
                f"The Additional hours box has “{g.group(1)}”, which is text, not a number.",
                "Retype it as a number, for example -1 or 1.5.",
            )
        if g := m(r"^(.+) is not on the 15-minute grid"):
            return (
                "Time is not in quarter hours",
                f"{g.group(1)} is not a whole quarter hour.",
                "Use quarter hours: .25 for :15, .5 for :30, .75 for :45 (7.5 is 7:30).",
            )
        return (
            "Hours are not a quarter-hour number",
            _jargon(msg),
            "Hours must be more than 0 and in quarter hours, for example 2, 2.25, 2.5 or 2.75.",
        )
    if rule == "E04":
        if g := m(r"^Activity '(.*)' is not in the activity list"):
            return (
                "Unknown activity code",
                f"“{g.group(1)}” is not in the activity list (Labour Detail, column L).",
                "Check the code for a typing mistake, or ask for it to be added to the list.",
            )
        return (
            "Activity code is missing",
            "Hours are entered, but the Activity code box next to them is empty.",
            "Type the activity code for those hours.",
        )
    if rule == "E05":
        if g := m(r"Activities total (\S+) h but effective is (\S+) h"):
            return (
                "More activity hours than hours worked",
                f"The activity hours add up to {g.group(1)} h, but Time In and Time Out only "
                f"give {g.group(2)} h of work.",
                f"Check the times and the hours. The hours should add up to {g.group(2)} or less.",
            )
    if rule == "E06":
        return (
            "Too many activities",
            "One worker has room for 5 activity lines on a day.",
            "Combine activities so there are 5 lines or fewer.",
        )
    if rule == "E07":
        if "twice in this batch" in msg:
            return (
                "Worker added twice",
                f"{issue.calling_name} is in the list twice for the same day.",
                "Remove one of the two from the list below.",
            )
        if g := m(r"is in (\d+) blocks of"):
            return (
                "Worker appears more than once on the sheet",
                f"{issue.calling_name} appears {g.group(1)} times on this day sheet in Excel, so "
                "the tool can't tell which rows to use.",
                "Check the calling names in column A of Labour Detail for a duplicate.",
            )
        return (
            "Worker not on this day sheet",
            f"{issue.calling_name} is not on this day sheet in Excel.",
            "Check the calling name, or press Reload from Excel if they were added just now.",
        )
    if rule == "E08":
        return (
            "Already entered for this day",
            f"{issue.calling_name} already has times or hours on this day in Excel.",
            "Press Replace to write over them, or Remove to keep what is in Excel.",
        )
    if rule == "E09":
        return (
            "Cell can't be written",
            "The tool refused to write into a locked or formula cell.",
            "Nothing was changed. Tell the person who looks after the tool.",
        )
    if rule == "W09":
        return (
            "Overtime on a medical day",
            _jargon(msg).replace("Excel books", "Excel gives").replace(" OT ", " overtime "),
            "Check whether medical leave should get overtime on this day.",
        )
    if rule == "H01":
        if g := m(r"^Dated (\S+), expected (\S+)\."):
            return (
                "Wrong date at the top of the sheet",
                f"The date says {nice_date(g.group(1))}, but this sheet is for "
                f"{nice_date(g.group(2))}. Every worker's payroll line from this sheet "
                "gets the wrong date.",
                f"Press Fix to set the date to {nice_date(g.group(2))}.",
            )
    if rule == "H02":
        if g := m(r"marked Holiday, but (\S+) is not in the holiday list \(a (\w+)\)"):
            return (
                "Day type says Holiday",
                f"The day type says Holiday, but {nice_date(g.group(1))} (a {g.group(2)}) "
                "is not set as a holiday.",
                "If it really is a holiday, press Keep as holiday. If not, press Fix.",
            )
        if g := m(r"^Day type '(.*)' on a (\w+)"):
            right = g.group(2) if g.group(2) in ("Saturday", "Sunday") else "Normal Day"
            if "(holiday list)" in msg:
                right = "Holiday"
            return (
                "Wrong day type at the top of the sheet",
                f"The day type says {g.group(1)}, but this day is a {g.group(2)}"
                + (" and set as a holiday" if right == "Holiday" else "")
                + ". Overtime is worked out from the day type, so it is wrong for everyone "
                "on this sheet.",
                f"Press Fix to change it to {right}.",
            )
    if rule == "H03":
        if g := m(r"^Sheet no\. is (.+), expected (\S+)\."):
            return (
                "Wrong sheet number at the top",
                f"The sheet number says {g.group(1)}, but this is sheet {g.group(2)}.",
                f"Press Fix to set it to {g.group(2)}.",
            )
    if rule == "M01":
        return (
            "Problem with a calling name",
            _jargon(msg),
            "Correct the calling name in column A of Labour Detail."
            + (f" {issue.suggestion}" if issue.suggestion else ""),
        )
    if rule == "M02":
        if g := m(r"^Employee code is used by (.+), which have different IDs"):
            return (
                "One employee code on different people",
                f"The same employee code is given to {g.group(1)}, but their ID numbers "
                "are different.",
                "Check the registration file and correct the code in column G of Labour Detail.",
            )
        shown = "is empty"
        if g := m(r"^Employee code shows (\S+)"):
            shown = f"shows {g.group(1)} (Excel could not find the code)"
        elif msg.startswith("Employee code is 0"):
            shown = "shows 0 instead of a code"
        elif g := m(r"^Employee code is '(.*)', not"):
            shown = f"has “{g.group(1)}”, which is not a code like X12345 or XIN123"
        return (
            "Employee code missing or wrong",
            f"The employee code box {shown}.",
            "Drop the registration files on this page to fill it in, or type the code in "
            "column G of Labour Detail.",
        )
    if rule == "M03":
        if g := m(r"^Same ID number on (.+), but the names differ"):
            return (
                "Same ID number on different names",
                f"{g.group(1)} have the same ID number but different names.",
                "Check the passport/NIC numbers (column D of Labour Detail) against the "
                "registration.",
            )
        if g := m(r"has two employee codes: (.+)\.$"):
            return (
                "One person with two employee codes",
                f"The same person (same name and ID) has two codes: {g.group(1)}.",
                "Ask the office which code is right, and change column G of Labour Detail.",
            )
    if rule == "M04":
        return (
            "Trade spelled differently",
            _jargon(msg).replace("Trade group", "Trade"),
            f"In column C of Labour Detail: {issue.suggestion or 'use the usual spelling.'}",
        )
    if rule == "M05":
        return (
            "Activity list needs tidying",
            _jargon(msg),
            f"In column L of Labour Detail: {issue.suggestion or 'tidy the list.'}",
        )
    if rule == "M06":
        if g := m(r"^Activity '(.*)' has stray spaces"):
            return (
                "Activity code has extra spaces",
                f"“{g.group(1)}” has a space before or after it, and the spaces go into the "
                "payroll upload too.",
                "Retype the code without spaces.",
            )
    if rule == "W01":
        if g := m(r"^Effective (\S+) h \((.+)\)"):
            return (
                "Very long day",
                f"Worked {g.group(1)} hours ({nice_time(g.group(2))}). That is more than 16 hours.",
                "Check Time In and Time Out. If they are right, nothing needs to change.",
            )
    if rule == "W02":
        if g := m(r"^Out (.+) on day (\d+), in again (.+) on day (\d+): (\S+) h rest"):
            return (
                "Short rest between two days",
                f"Left at {nice_time(g.group(1))} on day {g.group(2)} and came in again at "
                f"{g.group(3)} on day {g.group(4)}: only {_hours(g.group(5))} of rest.",
                "Check the times on both days. If they are right, nothing needs to change.",
            )
    if rule == "W02":
        if g := m(r"^Only (\S+) h rest (after|before) day (\d+) \((?:out|in) (\S+)\)"):
            other = (f"leaving at {g.group(4)} on day {g.group(3)}" if g.group(2) == "after"
                     else f"coming in at {g.group(4)} on day {g.group(3)}")  # fmt: skip
            return (
                "Short rest between two days",
                f"Only {_hours(g.group(1))} of rest {g.group(2)} {other}.",
                "Check the times. If they are right, tick “It's correct”.",
            )
    if rule == "W03":
        time = r"(\d\d:\d\d(?: \(\+1 day\))?)"
        name = r"(\S+(?: [A-Z]{1,3})?)"
        if g := m(rf"^{name} {time}-{time} and {name} {time}-{time} overlap"):
            a, a_in, a_out, b, b_in, b_out = (nice_time(x) for x in g.groups())
            return (
                "Same person entered twice at the same time",
                f"{a} ({a_in} to {a_out}) and {b} ({b_in} to {b_out}) are the same person, "
                "and the times overlap.",
                "Keep the hours on only one of the two lines, or correct the times.",
            )
        if g := m(rf"^Overlaps {name} {time}-{time} on this sheet"):
            return (
                "Same person entered twice at the same time",
                f"This is the same person as {g.group(1)} ({nice_time(g.group(2))} to "
                f"{nice_time(g.group(3))}) on this sheet, and the times overlap.",
                "Keep the hours on only one of the two lines, or correct the times.",
            )
    if rule == "W04":
        if g := m(r"^Additional hours (\S+) with no remark"):
            return (
                "Additional hours without a reason",
                f"Additional hours of {g.group(1)} are entered, but the Remarks box is empty.",
                "Type the reason in Remarks (for example: dinner).",
            )
    if rule == "W05":
        return (
            "Left at exactly 22:00",
            "When Time Out is 22:00 Excel takes off only the lunch hour. Usually -1 is put in "
            "Additional hours for dinner.",
            "If they had dinner, type -1 in Additional hours and 'dinner' in Remarks.",
        )
    if rule == "W06":
        if g := m(r"^In (\S+): .*\(effective (\S+) h\)"):
            return (
                "Came in after noon",
                f"Came in at {g.group(1)}, but Excel still takes off a lunch hour, so only "
                f"{g.group(2)} hours count.",
                "Check Time In. If it is right and they had no lunch break, type 1 in "
                "Additional hours and the reason in Remarks.",
            )
    if rule == "W07":
        if g := m(r"^(\d+) upload lines on (\d+) day"):
            return (
                "No employee code",
                f"This worker has no employee code, so {g.group(1)} of their payroll upload "
                f"lines ({g.group(2)} days) go out without one.",
                "Drop the registration files on this page to fill in the code, or type it in "
                "column G of Labour Detail.",
            )
    if rule == "W08":
        if g := m(r"^(\S+) of (\S+) effective hours"):
            return (
                "Some hours have no activity",
                f"{g.group(1)} of {g.group(2)} worked hours have no activity, so Excel counts "
                "them as idle time.",
                "Add the missing activity hours if the worker was on a job.",
            )
    title = RULES[rule].title if rule in RULES else "Check this"
    return (_jargon(title), _jargon(msg), _jargon(issue.suggestion or "Check this in Excel."))
