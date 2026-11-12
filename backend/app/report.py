# ruff: noqa: E501  (an HTML template: long lines are its markup)
"""The PM and QS report (roadmap #10): one self-contained HTML page with the management figures of
the month and the latest week. Written to a shared folder every evening, and served read-only at
``/viewer`` when LAN viewing is switched on.

Aggregates only: no worker names, no figures per person; rupees only when the office allows them
("at standard rates", costing rates, not pay). Built from the saved workbook file (pyxlsb) or the
practice copy, so a PM's view never waits on Excel.
"""

from __future__ import annotations

import datetime as dt
import html
from collections import defaultdict
from dataclasses import dataclass, field

from app.domain.codes import cell_text, person_key, trade_from_name
from app.domain.descriptions import standard_description
from app.domain.models import WorkbookSnapshot, as_number
from app.domain.places import place_suffix
from app.domain.rules import canonical_day_type, compute_entry

NO_CODE = "Unallocated (ZIDLE)"
COLORS = ["#2f6fb3", "#e8590c", "#2f9e6e", "#8a5cc2", "#c9a227", "#c2477a", "#8b93a1"]


@dataclass
class Row:
    day: int
    date: dt.date | None
    kind: str  # Normal, Saturday, Sunday, Holiday
    person: str
    trade: str
    bp: str
    worked: float
    ot: float
    lines: list[tuple[str, float]]  # (code, hours), unallocated included
    cost: float = 0.0


@dataclass
class Context:
    workbook: str
    month: str
    holidays: list[dt.date] = field(default_factory=list)
    trade_letters: dict[str, str] = field(default_factory=dict)
    descriptions: dict[str, str] = field(default_factory=dict)  # the office's own
    places: dict[str, str] = field(default_factory=dict)
    rates: dict | None = None  # only when rupees are allowed in the report
    lost: list = field(default_factory=list)  # app.audit.store.Lost
    causes: dict[str, str] = field(default_factory=dict)  # cause id -> label
    limits: dict = field(default_factory=dict)


def _kind(day_type: str | None, date: dt.date | None, holidays: list[dt.date]) -> str:
    if (date and date in holidays) or day_type == "Holiday":
        return "Holiday"
    if day_type == "Sunday" or (date and date.weekday() == 6):
        return "Sunday"
    if day_type == "Saturday" or (date and date.weekday() == 5 and day_type != "Normal Day"):
        return "Saturday"
    return "Normal"


def rows_of(snapshot: WorkbookSnapshot, ctx: Context) -> list[Row]:
    workers = {w.calling_name: w for w in snapshot.master.workers}
    rates = ctx.rates or {}
    out = []
    for d in snapshot.days:
        try:
            day = int(d.header.sheet)
        except ValueError:
            continue
        day_type = canonical_day_type(d.header.day_type)
        kind = _kind(day_type, d.header.date, ctx.holidays)
        for e in d.entries:
            name = cell_text(e.calling_name).strip()
            c = compute_entry(e, day_type)
            if not name or c is None or c.effective <= 0:
                continue
            w = workers.get(name)
            column = cell_text(w.trade_group).strip() if w else ""
            trade = trade_from_name(name, ctx.trade_letters) or column or "No trade"
            zidle = max(c.zidle or 0.0, 0.0)
            coded = [(cell_text(a.code).strip(), as_number(a.hours)) for a in e.activities]
            coded = [(code, h) for code, h in coded if code]
            lines = [(code, h if h is not None else (c.effective - zidle if len(coded) == 1 else 0))
                     for code, h in coded]  # fmt: skip
            lines = [(code, h) for code, h in lines if h and h > 0]
            total = sum(h for _, h in lines)
            room = c.effective - zidle
            if total > room > 0:
                lines = [(code, h * room / total) for code, h in lines]
            idle = c.effective - sum(h for _, h in lines)
            if idle > 0.001:
                lines.append((NO_CODE, idle))
            ot = max(c.ot_raw or 0.0, 0.0)
            row = Row(day, d.header.date, kind, person_key(name), trade,
                      (cell_text(w.bp).strip() if w else "") or "", c.effective, ot, lines)  # fmt: skip
            daily = (rates.get("workers") or {}).get(name) or (rates.get("trades") or {}).get(trade)
            if daily:
                hourly = daily / (rates.get("day_hours") or 8)
                mult = {"Holiday": rates.get("holiday", 2), "Sunday": rates.get("sunday", 1.5)}.get(
                    kind, rates.get("ot", 1.5)
                )
                row.cost = hourly * ((c.effective - ot) + ot * mult)
            out.append(row)
    return out


def _describe(code: str, ctx: Context) -> str:
    if code == NO_CODE:
        return "Worked hours not booked to an activity code"
    parts = [ctx.descriptions.get(code) or standard_description(code) or ""]
    if (s := place_suffix(code)) and ctx.places.get(s):
        parts.append(ctx.places[s])
    return " · ".join(p for p in parts if p)


def _kpis(rows: list[Row]) -> dict:
    hours = sum(r.worked for r in rows)
    ot = sum(r.ot for r in rows)
    per_day: dict[int, set[str]] = defaultdict(set)
    for r in rows:
        per_day[r.day].add(r.person)
    heads = [len(p) for p in per_day.values()]
    peak_day = max(per_day, key=lambda d: len(per_day[d])) if per_day else None
    idle = sum(h for r in rows for code, h in r.lines if code == NO_CODE)
    return {
        "hours": hours, "ot": ot, "ot_share": ot / hours if hours else 0, "worker_days": len(rows),
        "people": len({r.person for r in rows}), "avg": sum(heads) / len(heads) if heads else 0,
        "peak": max(heads, default=0), "peak_day": peak_day, "days": len(per_day), "idle": idle,
        "idle_share": idle / hours if hours else 0, "cost": sum(r.cost for r in rows),
    }  # fmt: skip


def _n(x: float, d: int = 0) -> str:
    return f"{x:,.{d}f}"


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def _bars(rows: list[Row], days: list[tuple[int, str]]) -> str:
    """People per day stacked by trade (SVG)."""
    per: dict[int, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for r in rows:
        per[r.day][r.trade].add(r.person)
    totals: dict[str, int] = defaultdict(int)
    for d in per.values():
        for t, p in d.items():
            totals[t] += len(p)
    order = sorted(totals, key=lambda t: -totals[t])
    top, rest = order[:5], set(order[5:])
    series = [*top, *(["Other"] if rest else [])]
    bw, gap, left, height, bottom = 18, 5, 34, 190, 30
    width = left + len(days) * (bw + gap) + 6
    peak = max([sum(len(p) for p in per[d].values()) for d, _ in days] + [1])
    scale = (height - bottom - 10) / peak
    out = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" role="img" aria-label="People per day">'
    ]
    for i in range(0, 5):
        v = round(peak * i / 4)
        y = height - bottom - v * scale
        out.append(f'<line x1="{left}" x2="{width}" y1="{y:.1f}" y2="{y:.1f}" stroke="#e3e6ea"/>'
                   f'<text x="{left - 4}" y="{y + 3:.1f}" text-anchor="end" font-size="9" fill="#5d6676">{v}</text>')  # fmt: skip
    for i, (d, kind) in enumerate(days):
        x = left + i * (bw + gap)
        acc = 0.0
        for k, s in enumerate(series):
            n = (sum(len(p) for t, p in per[d].items() if t in rest) if s == "Other"
                 else len(per[d].get(s, ())))  # fmt: skip
            if not n:
                continue
            y = height - bottom - (acc + n) * scale
            out.append(f'<rect x="{x}" y="{y:.1f}" width="{bw}" height="{n * scale:.1f}" '
                       f'fill="{COLORS[k] if s != "Other" else COLORS[6]}"><title>Day {d}: {html.escape(s)} {n}</title></rect>')  # fmt: skip
            acc += n
        colour = "#b91c1c" if kind in ("Sunday", "Holiday") else "#5d6676"
        out.append(
            f'<text x="{x + bw / 2}" y="{height - bottom + 12}" text-anchor="middle" font-size="9" fill="{colour}">{d}</text>'
        )
    out.append("</svg>")
    legend = "".join(f'<span><i style="background:{COLORS[k] if s != "Other" else COLORS[6]}"></i>{html.escape(s)}</span>'
                     for k, s in enumerate(series))  # fmt: skip
    return f'<div class="legend">{legend}</div>' + "".join(out)


def build_report(snapshot: WorkbookSnapshot, ctx: Context, now: dt.datetime | None = None) -> str:
    now = now or dt.datetime.now()
    rows = rows_of(snapshot, ctx)
    money = bool(ctx.rates)
    esc = html.escape
    days = sorted({(d.header.sheet, d.header.date, canonical_day_type(d.header.day_type))
                   for d in snapshot.days if d.header.sheet.isdigit()}, key=lambda x: int(x[0]))  # fmt: skip
    day_list = [(int(s), _kind(t, date, ctx.holidays)) for s, date, t in days]
    worked_days = sorted({r.day for r in rows})
    last = worked_days[-1] if worked_days else None
    dates = {int(s): date for s, date, _ in days}
    # the latest week (Monday to Sunday) with work, and the one before it
    week = prev = None
    if last and dates.get(last):
        monday = dates[last] - dt.timedelta(days=dates[last].weekday())
        week = [
            d
            for d, date in dates.items()
            if date and monday <= date <= monday + dt.timedelta(days=6)
        ]
        prev = [
            d
            for d, date in dates.items()
            if date and monday - dt.timedelta(days=7) <= date < monday
        ]
    m = _kpis(rows)
    w = _kpis([r for r in rows if week and r.day in week]) if week else None
    p = _kpis([r for r in rows if prev and r.day in prev]) if prev else None

    def tiles(k: dict, title: str, before: dict | None = None) -> str:
        def change(key: str) -> str:
            if not before or not before.get("days") or not k.get("days"):
                return ""
            a, b = k[key] / k["days"], before[key] / before["days"]
            return f' <span class="chg">{"▲" if a >= b else "▼"} {abs(a - b) / b * 100 if b else 0:.0f}% a day</span>'

        items = [
            ("Hours worked", _n(k["hours"]), f"{_n(k['hours'] - k['ot'])} normal{change('hours')}"),
            ("Overtime", f"{_n(k['ot'])} h", f"{_pct(k['ot_share'])} of hours"),
            ("Headcount", _n(k["avg"]), f"a day on average · peak {k['peak']}"),
            ("Worker-days", _n(k["worker_days"]), f"{k['days']} days with work"),
            ("Unallocated (ZIDLE)", f"{_n(k['idle'])} h", f"{_pct(k['idle_share'])} of hours"),
        ]
        if money:
            items.append(("Labour cost", f"Rs {_n(k['cost'])}", "at standard rates"))
        body = "".join(
            f'<div class="tile"><b>{v}</b><span>{lbl}</span><small>{n}</small></div>'
            for lbl, v, n in items
        )
        return f'<h2>{esc(title)}</h2><div class="tiles">{body}</div>'

    by_code: dict[str, dict] = defaultdict(lambda: {"hours": 0.0, "people": set(), "cost": 0.0})
    by_trade: dict[str, dict] = defaultdict(
        lambda: {"hours": 0.0, "ot": 0.0, "people": set(), "cost": 0.0}
    )
    by_bp: dict[str, dict] = defaultdict(lambda: {"billable": 0, "days": 0, "hours": 0.0})
    for r in rows:
        for code, h in r.lines:
            c = by_code[code]
            c["hours"] += h
            c["people"].add(r.person)
            c["cost"] += r.cost * h / r.worked if r.worked else 0
        t = by_trade[r.trade]
        t["hours"] += r.worked
        t["ot"] += r.ot
        t["people"].add(r.person)
        t["cost"] += r.cost
        b = by_bp[r.bp or "(no business partner)"]
        b["days"] += 1
        b["billable"] += r.worked >= 6
        b["hours"] += r.worked
    acts = sorted(by_code.items(), key=lambda x: -x[1]["hours"])[:10]
    cost_head = "<th>Cost</th>" if money else ""
    act_rows = "".join(
        f'<tr><td><code>{esc(code)}</code><div class="d">{esc(_describe(code, ctx))}</div></td>'
        f'<td class="n">{_n(v["hours"])}</td><td class="n">{len(v["people"])}</td>'
        f'<td class="n">{_pct(v["hours"] / m["hours"]) if m["hours"] else ""}</td>'
        + (f'<td class="n">Rs {_n(v["cost"])}</td>' if money else "")
        + "</tr>"
        for code, v in acts
    )
    trade_rows = "".join(
        f'<tr><td>{esc(t)}</td><td class="n">{_n(v["hours"])}</td><td class="n">{_n(v["ot"])}</td>'
        f'<td class="n">{len(v["people"])}</td>'
        + (f'<td class="n">Rs {_n(v["cost"])}</td>' if money else "")
        + "</tr>"
        for t, v in sorted(by_trade.items(), key=lambda x: -x[1]["hours"])
    )
    bp_rows = "".join(
        f'<tr><td>{esc(b)}</td><td class="n"><b>{v["billable"]}</b></td><td class="n">{v["days"]}</td><td class="n">{_n(v["hours"])}</td></tr>'
        for b, v in sorted(by_bp.items(), key=lambda x: -x[1]["billable"])
    )
    # lost time: disrupted days and unallocated hours with a reason
    disrupted = [x for x in ctx.lost if not x.supervisor and x.causes]
    lost_html = ""
    if disrupted:
        items = "".join(
            f"<li>Day {esc(x.sheet)}: {esc(', '.join(ctx.causes.get(c, c) for c in x.causes))}{' — ' + esc(x.note) if x.note else ''}</li>"
            for x in sorted(disrupted, key=lambda x: int(x.sheet) if x.sheet.isdigit() else 0)
        )
        lost_html = f"<h2>Disrupted days</h2><ul>{items}</ul>"
    # fatigue: counts only
    lim_h = ctx.limits.get("week_hours", 60)
    per_person: dict[str, dict[int, float]] = defaultdict(dict)
    for r in rows:
        per_person[r.person][r.day] = per_person[r.person].get(r.day, 0) + r.worked
    over = 0
    if last:
        over = sum(1 for days_ in per_person.values()
                   if sum(h for d, h in days_.items() if last - 6 <= d <= last) > lim_h)  # fmt: skip
    fatigue = (f'<p class="note">{over} worker{"s" if over != 1 else ""} worked more than {lim_h:g} h in the 7 days to day {last}.</p>'
               if last else "")  # fmt: skip

    title = f"Site labour report · {ctx.month}"
    css = """
    body{font:13px/1.45 Inter,"Segoe UI",Arial,sans-serif;color:#1b2230;margin:0;background:#f2efe9}
    main{max-width:1000px;margin:0 auto;background:#fff;padding:22px 26px 30px}
    header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e8590c;padding-bottom:8px}
    h1{font-size:22px;margin:2px 0}h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#5d6676;border-bottom:1px solid #e3e6ea;padding-bottom:3px;margin:20px 0 8px}
    .eyebrow{color:#e8590c;font-weight:700;font-size:11px;letter-spacing:.08em;text-transform:uppercase}.meta{color:#5d6676;font-size:11px;text-align:right}
    .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}.tile{border:1px solid #e3e6ea;border-radius:6px;padding:8px 10px}
    .tile b{display:block;font-size:20px}.tile span{display:block;font-weight:600;font-size:11.5px}.tile small{color:#5d6676}.chg{color:#5d6676}
    table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #e3e6ea;vertical-align:top}th{background:#f4f6f9}
    .n{text-align:right;font-variant-numeric:tabular-nums}.d{color:#5d6676;font-size:11px}code{font-family:Consolas,monospace;font-size:11.5px}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:18px}.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px;color:#5d6676;margin-bottom:4px}
    .legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}.note{background:#fff7e3;border-left:3px solid #c9a227;padding:6px 10px}
    footer{margin-top:22px;color:#5d6676;font-size:11px;border-top:1px solid #e3e6ea;padding-top:6px}
    @media(max-width:700px){.two{grid-template-columns:1fr}main{padding:14px}}@media print{body{background:#fff}main{padding:0}}
    """
    week_label = f"Latest week: days {min(week)}–{max(week)}" if week else ""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title><style>{css}</style></head><body><main>
<header><div><div class="eyebrow">{esc(ctx.workbook.rsplit(".", 1)[0])}</div><h1>{esc(title)}</h1><div class="d">From the daily labour sheets{f" · up to day {last}" if last else ""}</div></div>
<div class="meta">Written {now:%d %b %Y, %H:%M}<br>Read-only report for the PM and QS</div></header>
{tiles(w, week_label + (f" (against days {min(prev)}–{max(prev)})" if prev else ""), p) if w and w["days"] else ""}
{tiles(m, "Month to date")}
<h2>People on site by day and trade</h2>{_bars(rows, day_list)}
{fatigue}
<div class="two"><div><h2>Top activities (month)</h2><table><tr><th>Activity</th><th class="n">Hours</th><th class="n">People</th><th class="n">Share</th>{cost_head}</tr>{act_rows}</table></div>
<div><h2>By trade (month)</h2><table><tr><th>Trade</th><th class="n">Hours</th><th class="n">OT</th><th class="n">People</th>{cost_head}</tr>{trade_rows}</table>
<h2>Business partners (month)</h2><table><tr><th>Partner</th><th class="n">Billable days</th><th class="n">Worker-days</th><th class="n">Hours</th></tr>{bp_rows}</table></div></div>
{lost_html}
<footer>Hours are effective hours as Excel works them out. Billable days follow the BP Bill rule (6 or more effective hours).
{"Rupees are at standard rates (costing rates, not pay). " if money else ""}No worker names or figures per person are in this report.</footer>
</main></body></html>"""
