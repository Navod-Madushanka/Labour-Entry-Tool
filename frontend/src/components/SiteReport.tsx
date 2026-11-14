// One-click site report (roadmap #4): one A4 page per week or month with the headline numbers,
// the rule-written "what changed" lines, the manpower histogram, top activities and the as-built
// bars; and the monthly labour return (people of each trade on site each day). Printed by the
// browser, so "Save as PDF" in the print dialog makes the PDF; nothing is installed.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { LostView, Master } from "../api";
import {
  byCode,
  daily,
  lostTime,
  hasRates,
  kpis,
  labourReturn,
  periods,
  programme,
  whatChanged,
  within,
  NO_CODE,
  type Change,
  type Data,
  type DayRow,
} from "../analysis";
import { COLORS, DayBars, dayLabel, h } from "./charts";
import { num as fmtNum } from "../fmt";

type Desc = (code: string) => string | null;
const rs = (n: number) => `Rs ${fmtNum(Math.round(n))}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function SiteReport({ data, master, desc, lost, onClose, onView }: {
  data: Data;
  master: Master;
  desc: Desc;
  lost?: LostView;
  onClose: () => void;
  onView: (view: Change["view"]) => void;
}) {
  const list = useMemo(() => periods(data), [data]);
  // the last week with hours, by default
  const withWork = list.filter((p) => p.key !== "month" && within(data.slices, p.from, p.to).length);
  const [key, setKey] = useState(() => withWork[withWork.length - 1]?.key ?? list[0]?.key ?? "month");
  const [doc, setDoc] = useState<"report" | "return">("report");
  const money = hasRates(master.rates);

  useEffect(() => {
    const before = () => document.body.classList.add("printing");
    const after = () => document.body.classList.remove("printing");
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      window.removeEventListener("keydown", esc);
      after();
    };
  }, [onClose]);

  const cur = list.find((p) => p.key === key) ?? list[0];
  const weeks = list.filter((p) => p.key !== "month");
  const prev = cur && cur.key !== "month" ? weeks[weeks.indexOf(cur) - 1] ?? null : null;
  const label = (code: string) => (desc(code) ? `${code} ${desc(code)}` : code);
  const changes = useMemo(() => {
    if (!cur) return [];
    const out = whatChanged(data, cur, prev, label, money);
    // lost time (roadmap #5): disrupted days and the unallocated hours with a reason
    if (lost && lost.items.length) {
      const s = lostTime(data, within(data.slices, cur.from, cur.to), lost.items, lost.causes);
      const name = new Map(lost.causes.map((c) => [c.id, c.label.toLowerCase()]));
      const days = s.disrupted.filter((d) => d.day >= cur.from && d.day <= cur.to);
      const top = s.byCause.find((c) => c.cause !== "No reason given");
      if (days.length || top)
        out.push({
          text: `${days.length ? `Disrupted: ${days.map((d) => `${d.causes.map((c) => name.get(c) ?? c).join(" and ")} (day ${d.day})`).join("; ")}. ` : ""}${top ? `Unallocated hours with a reason: ${h(s.explained)} h, most to ${top.label.toLowerCase()} (${h(top.hours)} h, ${top.party.toLowerCase()}).` : ""}`.trim(),
          view: "lost",
          tone: "warn",
        });
    }
    return out;
  }, [data, cur, prev, money, lost]); // eslint-disable-line react-hooks/exhaustive-deps

  const print = () => {
    document.body.classList.add("printing");
    setTimeout(() => window.print(), 50);
  };

  return createPortal(
    <div className="report-portal" role="dialog" aria-label="Site report">
      <div className="report-toolbar">
        <span className="seg">
          <button className={doc === "report" ? "active" : ""} onClick={() => setDoc("report")}>Site report</button>
          <button className={doc === "return" ? "active" : ""} onClick={() => setDoc("return")}>Monthly labour return</button>
        </span>
        {doc === "report" && (
          <select aria-label="Period" value={key} onChange={(e) => setKey(e.target.value)}>
            {list.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        )}
        <button className="primary" onClick={print}>Print / Save as PDF</button>
        <span className="muted small">In the print window choose "Save as PDF" for a file. Esc closes.</span>
        <button className="link" onClick={onClose} style={{ marginLeft: "auto" }}>Close</button>
      </div>
      <div className="report-scroll">
        {doc === "report" && cur ? (
          <ReportSheet data={data} master={master} period={cur} prevLabel={prev?.label} changes={changes} money={money} desc={desc} onView={(v) => { onView(v); onClose(); }} />
        ) : (
          <ReturnSheet data={data} master={master} />
        )}
      </div>
    </div>,
    document.body,
  );
}

function SheetHead({ title, master, sub }: { title: string; master: Master; sub: string }) {
  return (
    <header className="rs-head">
      <div>
        <div className="rs-eyebrow">{master.workbook.replace(/\.(xlsb|xlsx|json)$/i, "")}</div>
        <h1>{title}</h1>
        <div className="rs-sub">{sub}</div>
      </div>
      <div className="rs-meta">
        Generated {new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
        <br />
        From the daily labour sheets
      </div>
    </header>
  );
}

function ReportSheet({ data, master, period, prevLabel, changes, money, desc, onView }: {
  data: Data;
  master: Master;
  period: { key: string; label: string; from: number; to: number };
  prevLabel?: string;
  changes: Change[];
  money: boolean;
  desc: Desc;
  onView: (v: Change["view"]) => void;
}) {
  const slices = within(data.slices, period.from, period.to);
  const k = kpis(slices);
  const days: DayRow[] = daily(data, slices, { from: period.from, to: period.to });
  const sums = new Map<string, number>();
  for (const d of days) for (const [t, c] of d.byTrade) sums.set(t, (sums.get(t) ?? 0) + c);
  const order = [...sums].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const top = order.slice(0, 5), rest = new Set(order.slice(5));
  const series = [...top.map((t, i) => ({ key: t, label: t, color: COLORS[i] })), ...(rest.size ? [{ key: "__o", label: "Other", color: COLORS[6] }] : [])];
  const value = (d: DayRow, key: string) => (key === "__o" ? [...d.byTrade].filter(([t]) => rest.has(t)).reduce((s, [, c]) => s + c, 0) : d.byTrade.get(key) ?? 0);
  const acts = byCode(slices).filter((g) => g.key !== NO_CODE).slice(0, 8);
  const bars = programme(slices).filter((b) => acts.some((a) => a.key === b.key));
  const peak = Math.max(1, ...bars.map((b) => b.peak));
  const tiles: [string, string, string?][] = [
    ["Hours worked", h(k.hours), `${h(k.normal)} normal`],
    ["Overtime", `${h(k.ot)} h`, `${pct(k.otPct)} of hours`],
    ["Headcount", String(Math.round(k.avgHeadcount)), `a day on average · peak ${k.peak?.count ?? 0}`],
    ["Worker-days", h(k.workerDays), `${k.workDays} days with work`],
    ["Unallocated (ZIDLE)", `${h(k.idle)} h`, k.hours ? `${pct(k.idle / k.hours)} of hours` : undefined],
    ...(money ? ([["Labour cost", rs(k.cost), `OT premium ${rs(k.otPremium)}`]] as [string, string, string][]) : []),
  ];
  return (
    <article className="report-sheet">
      <SheetHead title={period.key === "month" ? "Monthly site labour report" : "Weekly site labour report"} master={master} sub={`${period.label}${prevLabel ? ` · compared with the ${prevLabel.replace(/^Week/, "week")}` : ""}`} />
      <section className="rs-tiles">
        {tiles.map(([l, v, n]) => (
          <div key={l} className="rs-tile">
            <div className="rs-v">{v}</div>
            <div className="rs-l">{l}</div>
            {n && <div className="rs-n">{n}</div>}
          </div>
        ))}
      </section>
      <section className="rs-block">
        <h2>What changed</h2>
        <ul className="rs-changes">
          {changes.map((c, i) => (
            <li key={i} className={`tone-${c.tone}`}>
              {c.text}{" "}
              <button className="link small no-print" onClick={() => onView(c.view)} title="Open the table behind this line">table →</button>
            </li>
          ))}
        </ul>
      </section>
      <section className="rs-block">
        <h2>Manpower by day and trade</h2>
        <DayBars days={days} series={series} value={value} unit="people" />
      </section>
      <div className="rs-two">
        <section className="rs-block">
          <h2>Top activities</h2>
          <table className="rs-table">
            <thead>
              <tr>
                <th>Activity</th>
                <th className="num">Hours</th>
                <th className="num">People</th>
                {money && <th className="num">Cost</th>}
              </tr>
            </thead>
            <tbody>
              {acts.map((g) => (
                <tr key={g.key}>
                  <td>
                    <span className="mono">{g.key}</span>
                    <div className="rs-desc">{[desc(g.key), g.place].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="num">{h(g.hours)}</td>
                  <td className="num">{g.workers}</td>
                  {money && <td className="num">{rs(g.cost)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="rs-block">
          <h2>As-built bars</h2>
          <table className="rs-gantt">
            <thead>
              <tr>
                <th />
                {days.map((d) => <th key={d.day} className={d.kind === "Sunday" || d.kind === "Holiday" ? "off" : ""}>{d.day}</th>)}
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.key}>
                  <th className="mono">{b.key}</th>
                  {days.map((d) => {
                    const n = b.people.get(d.day) ?? 0;
                    return <td key={d.day} title={n ? `${n} people` : undefined}>{n ? <i style={{ opacity: 0.3 + 0.7 * (n / peak) }} /> : null}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rs-foot">Darker = bigger crew that day.</p>
        </section>
      </div>
      <footer className="rs-footer">
        Hours are effective hours as Excel works them out. {money ? "Rupees are at standard rates (costing rates, not pay). " : ""}Unallocated (ZIDLE) = hours not booked
        to an activity code. Headcount counts each person once a day.
      </footer>
    </article>
  );
}

function ReturnSheet({ data, master }: { data: Data; master: Master }) {
  const ret = labourReturn(data);
  const totals = ret.trades.map((t) => ret.rows.reduce((s, r) => s + (r.byTrade.get(t) ?? 0), 0));
  return (
    <article className="report-sheet return-sheet">
      <SheetHead title="Monthly labour return" master={master} sub={`Personnel on site each day, by class (trade) · ${master.month}`} />
      <table className="rs-table rs-return">
        <thead>
          <tr>
            <th>Day</th>
            <th>Date</th>
            {ret.trades.map((t) => <th key={t} className="num">{t}</th>)}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {ret.rows.map((r) => (
            <tr key={r.day} className={r.kind === "Sunday" || r.kind === "Holiday" ? "off" : ""}>
              <td>{dayLabel(r)}</td>
              <td>{r.date ?? ""}{r.kind === "Holiday" ? " (holiday)" : ""}</td>
              {ret.trades.map((t) => <td key={t} className="num">{r.byTrade.get(t) || ""}</td>)}
              <td className="num"><b>{r.total || ""}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2}>Worker-days</th>
            {totals.map((n, i) => <th key={ret.trades[i]} className="num">{n}</th>)}
            <th className="num">{totals.reduce((a, b) => a + b, 0)}</th>
          </tr>
        </tfoot>
      </table>
      <div className="rs-sign">
        <div>Prepared by</div>
        <div>Checked by</div>
        <div>Approved (Engineer)</div>
      </div>
    </article>
  );
}
