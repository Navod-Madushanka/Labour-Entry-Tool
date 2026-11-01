// Analysis tab: what the loaded month says about hours, manpower, overtime, attendance and data
// quality. Every figure is worked out in the browser from the day sheets already loaded
// (src/analysis.ts); Excel is not asked. Export puts the same tables in an .xlsx file.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type ExportTable, type Master } from "../api";
import type { Month } from "../history";
import {
  applyFilter,
  buildData,
  byCode,
  byPlace,
  byTrade,
  daily,
  heatmap,
  kpis,
  LONG_DAY,
  NO_CODE,
  people,
  quality,
  round2,
  summarise,
  type BookSummary,
  type DayRow,
  type Filter,
  type Group,
  type PersonRow,
} from "../analysis";
import { store } from "../store";
import { formatShift } from "../time";

type View = "overview" | "activities" | "places" | "manpower" | "timeline" | "overtime" | "attendance" | "quality" | "compare";
const VIEWS: [View, string][] = [
  ["overview", "Overview"],
  ["activities", "Activities"],
  ["places", "Places & trades"],
  ["manpower", "Daily manpower"],
  ["timeline", "Task timeline"],
  ["overtime", "Overtime"],
  ["attendance", "Attendance"],
  ["quality", "Data quality"],
  ["compare", "Compare months"],
];
const SUMMARY_PREFIX = "labour.summary.";
const RUN_FLAG = 14; // days in a row without a day off that are flagged
const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"];

const h = (n: number) => (Math.abs(n) < 0.005 ? "0" : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));
const pct = (n: number) => `${(n * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

interface Props {
  master: Master;
  month: Month;
  loaded: number;
  total: number;
}

export function Analysis({ master, month, loaded, total }: Props) {
  const [view, setView] = useState<View>(() => (store.get("labour.analysis.view") as View) || "overview");
  const [filter, setFilter] = useState<Filter>({});
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => store.set("labour.analysis.view", view), [view]);

  const data = useMemo(() => buildData(month, master), [month, master]);
  const { slices, entries } = useMemo(() => applyFilter(data, filter), [data, filter]);
  const k = useMemo(() => kpis(slices), [slices]);
  const allDays = data.days;
  const trades = useMemo(() => [...new Set(data.slices.map((s) => s.trade))].sort(), [data]);
  const places = useMemo(() => byPlace(data.slices).map((g) => g.key), [data]);
  const codes = useMemo(() => byCode(data.slices).map((g) => g.key), [data]);
  const complete = loaded >= total && total > 0;

  // Keep this workbook's summary for "Compare months" once the whole month is loaded.
  useEffect(() => {
    if (!complete || !data.slices.length) return;
    store.set(SUMMARY_PREFIX + master.workbook, JSON.stringify(summarise(master.workbook, master.month, data)));
  }, [complete, data, master.workbook, master.month]);

  const set = (patch: Partial<Filter>) => setFilter((f) => ({ ...f, ...patch }));
  const filtered = Boolean(filter.trade || filter.place || filter.code || filter.from || filter.to);

  const doExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const blob = await api.exportAnalysis(`Labour analysis ${master.month}`, exportTables(data, slices, entries, filter, master));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Labour analysis ${master.month}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="analysis">
      <div className="section-head">
        <h2>Analysis · {master.workbook}</h2>
        <button className="primary" onClick={doExport} disabled={exporting || !slices.length}>
          {exporting ? "Exporting…" : "Export to Excel"}
        </button>
      </div>
      <p className="muted small">
        Worked out from the day sheets as loaded ({loaded} of {total}
        {complete ? "" : ", still loading"}), including entries pushed today. Waiting entries are not counted until pushed.
        Excel is not changed.
      </p>
      {error && <p className="error-text">{error}</p>}

      <div className="filters card">
        <label>
          Trade
          <select value={filter.trade ?? ""} onChange={(e) => set({ trade: e.target.value || undefined })}>
            <option value="">All trades</option>
            {trades.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Place
          <select value={filter.place ?? ""} onChange={(e) => set({ place: e.target.value || undefined })}>
            <option value="">All places</option>
            {places.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label>
          Activity
          <select value={filter.code ?? ""} onChange={(e) => set({ code: e.target.value || undefined })}>
            <option value="">All activities</option>
            {codes.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>
          From day
          <select value={filter.from ?? ""} onChange={(e) => set({ from: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">first</option>
            {allDays.map((d) => <option key={d.sheet} value={d.day}>{dayLabel(d)}</option>)}
          </select>
        </label>
        <label>
          To day
          <select value={filter.to ?? ""} onChange={(e) => set({ to: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">last</option>
            {allDays.map((d) => <option key={d.sheet} value={d.day}>{dayLabel(d)}</option>)}
          </select>
        </label>
        {filtered && (
          <button className="link" onClick={() => setFilter({})}>
            Clear filters
          </button>
        )}
      </div>

      <nav className="subtabs" role="tablist">
        {VIEWS.map(([v, label]) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
      </nav>

      {!slices.length && view !== "compare" ? (
        <p className="muted">{data.slices.length ? "Nothing matches these filters." : "No entries with worked hours yet."}</p>
      ) : view === "overview" ? (
        <Overview k={k} data={{ slices, entries }} days={daily(data, slices, filter)} onView={setView} />
      ) : view === "activities" ? (
        <Activities groups={byCode(slices)} onPick={(code) => set({ code })} withActivities={data.withActivities} />
      ) : view === "places" ? (
        <PlacesTrades places={byPlace(slices)} trades={byTrade(slices)} onPlace={(place) => set({ place })} onTrade={(trade) => set({ trade })} />
      ) : view === "manpower" ? (
        <Manpower days={daily(data, slices, filter)} />
      ) : view === "timeline" ? (
        <Timeline slices={slices} days={daily(data, slices, filter)} onPick={(code) => set({ code })} />
      ) : view === "overtime" ? (
        <Overtime days={daily(data, slices, filter)} trades={byTrade(slices)} persons={people(data, entries)} />
      ) : view === "attendance" ? (
        <Attendance persons={people(data, entries)} />
      ) : view === "quality" ? (
        <QualityView data={data} entries={entries} />
      ) : (
        <Compare current={master.workbook} />
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------ the views

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

function Overview({ k, data, days, onView }: { k: ReturnType<typeof kpis>; data: ReturnType<typeof applyFilter>; days: DayRow[]; onView: (v: View) => void }) {
  const top = byCode(data.slices).filter((g) => g.key !== NO_CODE).slice(0, 5);
  const trades = byTrade(data.slices).slice(0, 5);
  return (
    <>
      <div className="kpis">
        <Kpi label="hours worked" value={h(k.hours)} note={`${h(k.normal)} normal`} />
        <Kpi label="overtime hours" value={h(k.ot)} note={`${pct(k.otPct)} of all hours`} />
        <Kpi label="worker-days" value={h(k.workerDays)} note={`${k.workDays} days with work`} />
        <Kpi label="people" value={String(k.people)} note={`${h(k.avgHeadcount)} a day on average`} />
        <Kpi label="peak headcount" value={String(k.peak?.count ?? 0)} note={k.peak ? `day ${k.peak.day}` : undefined} />
        <Kpi label="ZIDLE hours" value={h(k.idle)} note={k.hours ? `${pct(k.idle / k.hours)} without an activity` : undefined} />
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Headcount by day</h3>
          <button className="link small" onClick={() => onView("manpower")}>by trade →</button>
        </div>
        <DayBars days={days} series={[{ key: "all", label: "People", color: COLORS[0] }]} value={(d) => d.headcount} unit="people" />
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <h3>Top activities</h3>
            <button className="link small" onClick={() => onView("activities")}>all →</button>
          </div>
          <ShareList items={top.map((g) => ({ key: g.key, value: g.hours, note: g.place }))} total={k.hours} />
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Hours by trade</h3>
            <button className="link small" onClick={() => onView("places")}>all →</button>
          </div>
          <ShareList items={trades.map((g) => ({ key: g.key, value: g.hours, note: `${g.workers} people` }))} total={k.hours} />
        </div>
      </div>
    </>
  );
}

function ShareList({ items, total }: { items: { key: string; value: number; note?: string }[]; total: number }) {
  return (
    <ul className="share-list">
      {items.map((i) => (
        <li key={i.key}>
          <span className="share-name">
            {i.key}
            {i.note && <span className="muted small"> · {i.note}</span>}
          </span>
          <span className="share-value">{h(i.value)} h</span>
          <Bar frac={total ? i.value / total : 0} />
        </li>
      ))}
    </ul>
  );
}

const Bar = ({ frac, color = COLORS[0] }: { frac: number; color?: string }) => (
  <span className="bar" aria-hidden>
    <span style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: color }} />
  </span>
);

const groupCols = (first: string, extra: Col<Group>[] = []): Col<Group>[] => [
  { key: "key", label: first, value: (g) => g.key },
  ...extra,
  { key: "hours", label: "Hours", value: (g) => g.hours, num: true, fmt: (v) => h(v as number) },
  { key: "normal", label: "Normal", value: (g) => g.normal, num: true, fmt: (v) => h(v as number) },
  { key: "ot", label: "OT", value: (g) => g.ot, num: true, fmt: (v) => h(v as number) },
  { key: "wd", label: "Worker-days", value: (g) => g.workerDays, num: true, fmt: (v) => h(v as number), title: "Each worker-day shared over its activity lines by hours" },
  { key: "workers", label: "People", value: (g) => g.workers, num: true },
  { key: "days", label: "Days", value: (g) => g.days, num: true },
  { key: "pct", label: "Share", value: (g) => g.pct, num: true, fmt: (v) => <span className="share-cell">{pct(v as number)}<Bar frac={v as number} /></span> },
];

function Breakdown({ g, label }: { g: Group; label: string }) {
  return (
    <div className="breakdown">
      <span className="muted small">{label}:</span>{" "}
      {g.breakdown.slice(0, 12).map((b) => (
        <span key={b.key} className="chip static">
          {b.key} <b>{h(b.hours)} h</b>
        </span>
      ))}
      {g.first !== null && (
        <span className="muted small">
          {" "}
          · days {g.first}–{g.last}
        </span>
      )}
    </div>
  );
}

function Activities({ groups, onPick, withActivities }: { groups: Group[]; onPick: (code: string) => void; withActivities: boolean }) {
  return (
    <div className="card">
      <h3>Hours by activity code</h3>
      <p className="muted small">
        {withActivities
          ? "Overtime and worker-days are shared over each entry's lines by their hours. Click a row for its trades; the filter button shows only that code everywhere."
          : "This workbook is kept without activity codes, so all hours are ZIDLE."}
      </p>
      <SortTable
        cols={groupCols("Activity", [{ key: "place", label: "Place", value: (g) => g.place ?? "" }])}
        rows={groups}
        rowKey={(g) => g.key}
        expand={(g) => (
          <>
            <Breakdown g={g} label="By trade" />
            <button className="link small" onClick={() => onPick(g.key)}>Filter by this activity</button>
          </>
        )}
      />
    </div>
  );
}

function PlacesTrades({ places, trades, onPlace, onTrade }: { places: Group[]; trades: Group[]; onPlace: (p: string) => void; onTrade: (t: string) => void }) {
  return (
    <>
      <div className="card">
        <h3>Hours by place</h3>
        <p className="muted small">From the activity code's place ending (named once per project on the start page).</p>
        <SortTable cols={groupCols("Place")} rows={places} rowKey={(g) => g.key}
          expand={(g) => (<><Breakdown g={g} label="By trade" /><button className="link small" onClick={() => onPlace(g.key)}>Filter by this place</button></>)} />
      </div>
      <div className="card">
        <h3>Hours by trade</h3>
        <SortTable
          cols={groupCols("Trade", [])}
          rows={trades}
          rowKey={(g) => g.key}
          expand={(g) => (<><Breakdown g={g} label="By activity" /><button className="link small" onClick={() => onTrade(g.key)}>Filter by this trade</button></>)}
        />
      </div>
    </>
  );
}

function topTrades(days: DayRow[], n = 6) {
  const sums = new Map<string, number>();
  for (const d of days) for (const [t, c] of d.byTrade) sums.set(t, (sums.get(t) ?? 0) + c);
  const sorted = [...sums].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return { top: sorted.slice(0, n), rest: new Set(sorted.slice(n)) };
}

function Manpower({ days }: { days: DayRow[] }) {
  const { top, rest } = topTrades(days);
  const series = [
    ...top.map((t, i) => ({ key: t, label: t, color: COLORS[i] })),
    ...(rest.size ? [{ key: "__other", label: "Other trades", color: COLORS[6] }] : []),
  ];
  const value = (d: DayRow, key: string) =>
    key === "__other" ? [...d.byTrade].filter(([t]) => rest.has(t)).reduce((s, [, c]) => s + c, 0) : d.byTrade.get(key) ?? 0;
  const worked = days.filter((d) => d.headcount);
  return (
    <>
      <div className="card">
        <h3>People on site by day, by trade</h3>
        <DayBars days={days} series={series} value={value} unit="people" />
      </div>
      <div className="card">
        <h3>By day</h3>
        <p className="muted small">
          {worked.length} days with work · average {h(worked.reduce((s, d) => s + d.headcount, 0) / Math.max(worked.length, 1))} people a day
        </p>
        <SortTable
          cols={[
            { key: "day", label: "Day", value: (d) => d.day, num: true, fmt: (_v, d) => dayLabel(d) },
            { key: "kind", label: "Day type", value: (d) => d.kind },
            { key: "n", label: "People", value: (d) => d.headcount, num: true },
            ...top.map((t) => ({ key: `t-${t}`, label: t, value: (d: DayRow) => d.byTrade.get(t) ?? 0, num: true })),
            ...(rest.size ? [{ key: "other", label: "Other", value: (d: DayRow) => value(d, "__other"), num: true }] : []),
            { key: "hours", label: "Hours", value: (d) => d.hours, num: true, fmt: (v) => h(v as number) },
            { key: "ot", label: "OT", value: (d) => d.ot, num: true, fmt: (v) => h(v as number) },
          ]}
          rows={days}
          rowKey={(d) => d.sheet}
          initial={{ key: "day", desc: false }}
          limit={40}
        />
      </div>
    </>
  );
}

function Timeline({ slices, days, onPick }: { slices: ReturnType<typeof applyFilter>["slices"]; days: DayRow[]; onPick: (code: string) => void }) {
  const [top, setTop] = useState(15);
  const map = useMemo(() => heatmap(slices, top), [slices, top]);
  if (!map.codes.length) return <p className="muted">No activity codes in these entries.</p>;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Hours per activity per day</h3>
        <label className="small">
          Show{" "}
          <select value={top} onChange={(e) => setTop(Number(e.target.value))}>
            {[10, 15, 25, 50].map((n) => <option key={n}>{n}</option>)}
          </select>{" "}
          activities with most hours
        </label>
      </div>
      <p className="muted small">Darker = more hours. Shows when each task started, peaked and finished. Click a code to filter by it.</p>
      <div className="table-wrap">
        <table className="heatmap">
          <thead>
            <tr>
              <th>Activity</th>
              {days.map((d) => (
                <th key={d.sheet} className={d.kind === "Sunday" || d.kind === "Holiday" ? "sun" : d.kind === "Saturday" ? "sat" : ""} title={dayLabel(d)}>
                  {d.day}
                </th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {map.codes.map((c) => {
              const row = map.cells.get(c)!;
              const sum = [...row.values()].reduce((s, v) => s + v, 0);
              return (
                <tr key={c}>
                  <th>
                    <button className="link" onClick={() => onPick(c)}>{c}</button>
                  </th>
                  {days.map((d) => {
                    const v = row.get(d.day) ?? 0;
                    return (
                      <td key={d.sheet} title={v ? `${c}, day ${d.day}: ${h(v)} h` : undefined}
                          style={v ? { background: `color-mix(in srgb, var(--c1) ${Math.round(15 + 85 * (v / map.max))}%, transparent)` } : undefined} />
                    );
                  })}
                  <td className="num">{h(sum)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Overtime({ days, trades, persons }: { days: DayRow[]; trades: Group[]; persons: PersonRow[] }) {
  const ot = trades.reduce((s, t) => s + t.ot, 0);
  const all = trades.reduce((s, t) => s + t.hours, 0);
  return (
    <>
      <div className="card">
        <h3>Overtime hours by day</h3>
        <p className="muted small">
          {h(ot)} h overtime, {pct(all ? ot / all : 0)} of all hours. Overtime as Excel works it out (after 8 h on a normal day,
          5.5 h on Saturday, all hours on Sundays and holidays).
        </p>
        <DayBars days={days} series={[{ key: "ot", label: "OT hours", color: COLORS[1] }]} value={(d) => d.ot} unit="h" />
      </div>
      <div className="card">
        <h3>By trade</h3>
        <SortTable
          cols={[
            { key: "key", label: "Trade", value: (g) => g.key },
            { key: "ot", label: "OT hours", value: (g) => g.ot, num: true, fmt: (v) => h(v as number) },
            { key: "hours", label: "All hours", value: (g) => g.hours, num: true, fmt: (v) => h(v as number) },
            { key: "share", label: "OT share", value: (g) => (g.hours ? g.ot / g.hours : 0), num: true, fmt: (v) => <span className="share-cell">{pct(v as number)}<Bar frac={v as number} color={COLORS[1]} /></span> },
            { key: "per", label: "OT per person", value: (g) => (g.workers ? g.ot / g.workers : 0), num: true, fmt: (v) => h(v as number) },
          ]}
          rows={trades}
          rowKey={(g) => g.key}
          initial={{ key: "ot", desc: true }}
        />
      </div>
      <div className="card">
        <h3>By person</h3>
        <SortTable cols={personCols(["ot", "hours", "days", "late", "overnight", "sundays"])} rows={persons} rowKey={(p) => p.person} initial={{ key: "ot", desc: true }} search />
      </div>
    </>
  );
}

const PERSON_COLS: Record<string, Col<PersonRow>> = {
  person: { key: "person", label: "Worker", value: (p) => p.names[0] ?? p.person, fmt: (v, p) => <span title={p.names.join(", ")}>{v}{p.names.length > 1 && <span className="muted small"> +{p.names.length - 1}</span>}</span> },
  name: { key: "name", label: "Name", value: (p) => p.name },
  trade: { key: "trade", label: "Trade", value: (p) => p.trade },
  days: { key: "days", label: "Days", value: (p) => p.days, num: true },
  hours: { key: "hours", label: "Hours", value: (p) => p.hours, num: true, fmt: (v) => h(v as number) },
  ot: { key: "ot", label: "OT", value: (p) => p.ot, num: true, fmt: (v) => h(v as number) },
  late: { key: "late", label: "Out after 22:00", value: (p) => p.late, num: true },
  overnight: { key: "overnight", label: "Past midnight", value: (p) => p.overnight, num: true },
  saturdays: { key: "saturdays", label: "Saturdays", value: (p) => p.saturdays, num: true },
  sundays: { key: "sundays", label: "Sundays", value: (p) => p.sundays, num: true },
  holidays: { key: "holidays", label: "Holidays", value: (p) => p.holidays, num: true },
  longestRun: { key: "longestRun", label: "Longest run", title: "Most days in a row with work (site days)", value: (p) => p.longestRun, num: true, fmt: (v) => <span className={(v as number) >= RUN_FLAG ? "warn-text" : ""}>{String(v)}</span> },
  currentRun: { key: "currentRun", label: "Current run", title: "Days in a row up to the last day with work", value: (p) => p.currentRun, num: true, fmt: (v) => <span className={(v as number) >= RUN_FLAG ? "warn-text" : ""}>{String(v)}</span> },
  daysOff: { key: "daysOff", label: "Days away", title: "Site work days between their first and last day without them", value: (p) => p.daysOff, num: true },
  first: { key: "first", label: "First day", value: (p) => p.first, num: true },
  last: { key: "last", label: "Last day", value: (p) => p.last, num: true },
};
const personCols = (keys: string[]) => [PERSON_COLS.person, PERSON_COLS.name, PERSON_COLS.trade, ...keys.map((k) => PERSON_COLS[k])];

function Attendance({ persons }: { persons: PersonRow[] }) {
  const long = persons.filter((p) => p.currentRun >= RUN_FLAG || p.longestRun >= RUN_FLAG);
  return (
    <>
      {long.length > 0 && (
        <div className="banner WARN">
          <p>
            <b>{long.length} worker{long.length === 1 ? "" : "s"}</b> worked {RUN_FLAG} or more days in a row without a day off:{" "}
            {long.slice(0, 12).map((p) => `${p.names[0] ?? p.person} (${p.longestRun})`).join(", ")}
            {long.length > 12 ? " …" : ""}
          </p>
        </div>
      )}
      <div className="card">
        <h3>Attendance by person</h3>
        <p className="muted small">
          Days count each worker once a day, also with two calling names (one person). Runs count site work days: a day with nobody on
          site does not break a run.
        </p>
        <SortTable
          cols={personCols(["days", "daysOff", "saturdays", "sundays", "holidays", "longestRun", "currentRun", "first", "last", "hours"])}
          rows={persons}
          rowKey={(p) => p.person}
          initial={{ key: "days", desc: true }}
          search
        />
      </div>
    </>
  );
}

function QualityView({ data, entries }: { data: ReturnType<typeof buildData>; entries: ReturnType<typeof applyFilter>["entries"] }) {
  const q = useMemo(() => quality(data, entries), [data, entries]);
  const idleTotal = q.idle.reduce((s, x) => s + x.hours, 0);
  const sections: [string, number, ReactNode][] = [
    ["Checks the tool found", q.issues.reduce((s, x) => s + x.count, 0),
      <SortTable key="i" cols={[
        { key: "sev", label: "Level", value: (r) => r.severity, fmt: (v) => <span className={`badge ${v === "BLOCK" ? "error" : "warn"}`}>{v === "BLOCK" ? "Error" : "Warning"}</span> },
        { key: "title", label: "Check", value: (r) => r.title },
        { key: "count", label: "Entries", value: (r) => r.count, num: true },
        { key: "ex", label: "For example", value: (r) => r.example },
      ]} rows={q.issues} rowKey={(r) => r.rule} initial={{ key: "count", desc: true }} />],
    ["Workers with entries but no valid employee code (blocks the ERP upload)", q.noEmployeeCode.length,
      <SortTable key="e" cols={[
        { key: "name", label: "Worker", value: (r) => r.name },
        { key: "status", label: "Employee code", value: (r) => r.status },
        { key: "days", label: "Days with entries", value: (r) => r.days, num: true },
      ]} rows={q.noEmployeeCode} rowKey={(r) => r.name} />],
    [`ZIDLE: hours without an activity (${h(idleTotal)} h)`, q.idle.length,
      <SortTable key="z" cols={[
        { key: "sheet", label: "Day", value: (r) => Number(r.sheet), num: true },
        { key: "name", label: "Worker", value: (r) => r.name },
        { key: "hours", label: "Hours", value: (r) => r.hours, num: true, fmt: (v) => h(v as number) },
      ]} rows={q.idle} rowKey={(r) => `${r.sheet}|${r.name}`} initial={{ key: "hours", desc: true }} />],
    ["Entries without any activity code", q.noCode.length,
      <SortTable key="n" cols={[
        { key: "sheet", label: "Day", value: (r) => Number(r.sheet), num: true },
        { key: "name", label: "Worker", value: (r) => r.name },
        { key: "hours", label: "Hours", value: (r) => r.hours, num: true, fmt: (v) => h(v as number) },
      ]} rows={q.noCode} rowKey={(r) => `${r.sheet}|${r.name}`} />],
    ["Codes not in the Labour Detail activity list", q.unknownCodes.length,
      <SortTable key="u" cols={[
        { key: "code", label: "Code", value: (r) => r.code },
        { key: "uses", label: "Entries", value: (r) => r.uses, num: true },
        { key: "sheets", label: "Days", value: (r) => r.sheets.join(", ") },
      ]} rows={q.unknownCodes} rowKey={(r) => r.code} />],
    ["Codes used only once or twice (often a typing mistake)", q.rareCodes.length,
      <SortTable key="r" cols={[
        { key: "code", label: "Code", value: (r) => r.code },
        { key: "uses", label: "Entries", value: (r) => r.uses, num: true },
        { key: "names", label: "Workers", value: (r) => r.names.join(", ") },
        { key: "sheets", label: "Days", value: (r) => r.sheets.join(", ") },
      ]} rows={q.rareCodes} rowKey={(r) => r.code} />],
    [`Long days (more than ${LONG_DAY} hours worked)`, q.longDays.length,
      <SortTable key="l" cols={[
        { key: "sheet", label: "Day", value: (r) => Number(r.sheet), num: true },
        { key: "name", label: "Worker", value: (r) => r.name },
        { key: "shift", label: "Times", value: (r) => formatShift(r.shift[0], r.shift[1]) },
        { key: "worked", label: "Worked", value: (r) => r.worked, num: true, fmt: (v) => h(v as number) },
      ]} rows={q.longDays} rowKey={(r) => `${r.sheet}|${r.name}`} initial={{ key: "worked", desc: true }} />],
  ];
  return (
    <>
      {sections.map(([title, n, body]) => (
        <details key={title} className="card" open={n > 0 && n <= 30}>
          <summary>
            <b>{title}</b> <span className={`badge${n ? " warn" : ""}`}>{n}</span>
          </summary>
          {n ? body : <p className="muted small">None.</p>}
        </details>
      ))}
    </>
  );
}

function loadSummaries(): BookSummary[] {
  const out: BookSummary[] = [];
  for (const key of store.keys().filter((k) => k.startsWith(SUMMARY_PREFIX))) {
    try {
      const s = JSON.parse(store.get(key) ?? "") as BookSummary;
      if (s && typeof s.hours === "number") out.push(s);
    } catch {
      /* broken entry: skipped */
    }
  }
  return out.sort((a, b) => a.month.localeCompare(b.month) || a.workbook.localeCompare(b.workbook));
}

function Compare({ current }: { current: string }) {
  const [books, setBooks] = useState(loadSummaries);
  if (!books.length)
    return <p className="muted">No months saved yet. Each workbook's figures are kept here once its whole month has loaded in this tab.</p>;
  const rows: [string, (b: BookSummary) => number, (n: number) => string][] = [
    ["Hours worked", (b) => b.hours, h],
    ["Overtime hours", (b) => b.ot, h],
    ["OT share", (b) => (b.hours ? b.ot / b.hours : 0), pct],
    ["Worker-days", (b) => b.workerDays, h],
    ["People", (b) => b.people, String],
    ["Average a day", (b) => b.avgHeadcount, h],
    ["Peak headcount", (b) => b.peak, String],
    ["ZIDLE hours", (b) => b.idle, h],
    ["Day sheets", (b) => b.days, String],
  ];
  const tradeNames = [...new Set(books.flatMap((b) => Object.keys(b.trades)))].sort();
  const codeNames = [...new Set(books.flatMap((b) => Object.keys(b.codes)))].sort();
  const remove = (wb: string) => {
    store.remove(SUMMARY_PREFIX + wb);
    setBooks(loadSummaries());
  };
  const head = (
    <tr>
      <th />
      {books.map((b) => (
        <th key={b.workbook} className="num" title={`Saved ${new Date(b.savedAt).toLocaleString()}`}>
          {b.workbook}
          {b.workbook === current && <span className="muted small"> (open)</span>}
          <div className="muted small">
            {b.month}{" "}
            <button className="link small" onClick={() => remove(b.workbook)} aria-label={`Forget ${b.workbook}`}>
              forget
            </button>
          </div>
        </th>
      ))}
    </tr>
  );
  const block = (title: string, names: string[], get: (b: BookSummary, n: string) => number | undefined) => (
    <>
      <tr className="group-row"><th colSpan={books.length + 1}>{title}</th></tr>
      {names.map((n) => (
        <tr key={title + n}>
          <th>{n}</th>
          {books.map((b) => <td key={b.workbook} className="num">{get(b, n) === undefined ? "—" : h(get(b, n)!)}</td>)}
        </tr>
      ))}
    </>
  );
  return (
    <div className="card">
      <h3>Workbooks side by side</h3>
      <p className="muted small">
        Saved in this browser each time a workbook's month is fully loaded here (open each workbook once to add it). Hours by
        activity show each workbook's 15 largest codes.
      </p>
      <div className="table-wrap">
        <table className="data compare">
          <thead>{head}</thead>
          <tbody>
            {rows.map(([label, get, fmt]) => (
              <tr key={label}>
                <th>{label}</th>
                {books.map((b) => <td key={b.workbook} className="num">{fmt(get(b))}</td>)}
              </tr>
            ))}
            {block("Hours by trade", tradeNames, (b, n) => b.trades[n])}
            {block("Hours by activity", codeNames, (b, n) => b.codes[n])}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------- building blocks

const dayLabel = (d: { day: number; date: string | null }) => {
  if (!d.date) return `Day ${d.day}`;
  const wd = new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
  return `${wd} ${d.day}`;
};

/** Bars per day, stacked by series; Sundays and holidays marked under the axis. */
function DayBars({ days, series, value, unit }: {
  days: DayRow[];
  series: { key: string; label: string; color: string }[];
  value: (d: DayRow, key: string) => number;
  unit: string;
}) {
  const totals = days.map((d) => series.reduce((s, x) => s + value(d, x.key), 0));
  const max = Math.max(1, ...totals);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const bw = 22, gap = 6, left = 40, bottom = 34, height = 220;
  const width = left + days.length * (bw + gap) + 8;
  const y = (v: number) => height - bottom - (v / top) * (height - bottom - 12);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  return (
    <div className="chart">
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} width={Math.max(width, 320)} height={height} role="img" aria-label={`${series.map((s) => s.label).join(", ")} by day`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - 4} y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{t}</text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = left + i * (bw + gap) + gap / 2;
            let acc = 0;
            const off = d.kind === "Sunday" || d.kind === "Holiday";
            return (
              <g key={d.sheet}>
                {series.map((s) => {
                  const v = value(d, s.key);
                  if (!v) return null;
                  const y0 = y(acc), y1 = y(acc + v);
                  acc += v;
                  return (
                    <rect key={s.key} x={x} y={y1} width={bw} height={Math.max(y0 - y1, 0.5)} fill={s.color}>
                      <title>{`${dayLabel(d)}: ${s.label} ${h(v)} ${unit}`}</title>
                    </rect>
                  );
                })}
                {totals[i] > 0 && series.length > 1 && (
                  <text x={x + bw / 2} y={y(totals[i]) - 3} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{Math.round(totals[i])}</text>
                )}
                <text x={x + bw / 2} y={height - bottom + 14} textAnchor="middle" fontSize="11" fill={off ? "var(--sun)" : d.kind === "Saturday" ? "var(--sat)" : "var(--text)"} fontWeight={off ? 600 : 400}>
                  {d.day}
                </text>
                {off && <text x={x + bw / 2} y={height - bottom + 27} textAnchor="middle" fontSize="9" fill="var(--sun)">{d.kind === "Sunday" ? "Sun" : "Hol"}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function niceStep(max: number): number {
  const raw = max / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p * 10;
}

interface Col<T> {
  key: string;
  label: string;
  value: (r: T) => string | number | null;
  fmt?: (v: string | number | null, r: T) => ReactNode;
  num?: boolean;
  title?: string;
}

function SortTable<T>({ cols, rows, rowKey, initial, limit = 30, expand, search }: {
  cols: Col<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  initial?: { key: string; desc: boolean };
  limit?: number;
  expand?: (r: T) => ReactNode;
  search?: boolean;
}) {
  const [sort, setSort] = useState(initial ?? { key: cols.find((c) => c.num)?.key ?? cols[0].key, desc: true });
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const col = cols.find((c) => c.key === sort.key) ?? cols[0];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? rows.filter((r) => cols.some((c) => !c.num && String(c.value(r) ?? "").toLowerCase().includes(needle))) : rows;
    return [...list].sort((a, b) => {
      const va = col.value(a), vb = col.value(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va ?? "").localeCompare(String(vb ?? ""), undefined, { numeric: true });
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, col, sort.desc, q, cols]);
  const visible = all ? shown : shown.slice(0, limit);
  return (
    <>
      {search && (
        <input className="table-search" placeholder="Search worker, name or trade" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={c.num ? "num" : ""} title={c.title} aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}>
                  <button className="sort" onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : Boolean(c.num) }))}>
                    {c.label}
                    {sort.key === c.key ? (sort.desc ? " ▾" : " ▴") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const key = rowKey(r);
              return (
                <RowWithDetail key={key} open={open === key} cols={cols.length} detail={expand ? expand(r) : null}
                  onToggle={expand ? () => setOpen(open === key ? null : key) : undefined}>
                  {cols.map((c) => {
                    const v = c.value(r);
                    return <td key={c.key} className={c.num ? "num" : ""}>{c.fmt ? c.fmt(v, r) : v === null ? "—" : String(v)}</td>;
                  })}
                </RowWithDetail>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <button className="link small" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${shown.length}`}
        </button>
      )}
    </>
  );
}

function RowWithDetail({ open, cols, detail, onToggle, children }: { open: boolean; cols: number; detail: ReactNode; onToggle?: () => void; children: ReactNode }) {
  return (
    <>
      <tr className={onToggle ? `clickable${open ? " open" : ""}` : ""} onClick={onToggle}>{children}</tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={cols} onClick={(e) => e.stopPropagation()}>{detail}</td>
        </tr>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------- export

function exportTables(data: ReturnType<typeof buildData>, slices: ReturnType<typeof applyFilter>["slices"], entries: ReturnType<typeof applyFilter>["entries"], filter: Filter, master: Master): ExportTable[] {
  const r = round2;
  const k = kpis(slices);
  const f = [filter.trade && `trade ${filter.trade}`, filter.place && `place ${filter.place}`, filter.code && `activity ${filter.code}`,
    (filter.from || filter.to) && `days ${filter.from ?? "first"}–${filter.to ?? "last"}`].filter(Boolean).join(", "); // prettier-ignore
  const note = `${master.workbook} · ${master.month}${f ? ` · filtered: ${f}` : ""}`;
  const groupRows = (gs: Group[], withPlace = false) =>
    gs.map((g) => [g.key, ...(withPlace ? [g.place ?? ""] : []), r(g.hours), r(g.normal), r(g.ot), r(g.workerDays), g.workers, g.days, g.first, g.last, r(g.pct * 100)]);
  const groupColsX = ["Hours", "Normal", "OT", "Worker-days", "People", "Days", "First day", "Last day", "Share %"];
  const days = daily(data, slices, filter);
  const { top, rest } = topTrades(days, 20);
  const ps = people(data, entries);
  const q = quality(data, entries);
  return [
    { name: "Summary", note, columns: ["Figure", "Value"], rows: [
      ["Hours worked", r(k.hours)], ["Normal hours", r(k.normal)], ["Overtime hours", r(k.ot)], ["OT share %", r(k.otPct * 100)],
      ["Worker-days", r(k.workerDays)], ["People", k.people], ["Days with work", k.workDays], ["Average people a day", r(k.avgHeadcount)],
      ["Peak headcount", k.peak?.count ?? 0], ["Peak day", k.peak?.day ?? null], ["ZIDLE hours", r(k.idle)], ["Activity codes used", k.codes],
    ] }, // prettier-ignore
    { name: "Activities", note, columns: ["Activity", "Place", ...groupColsX], rows: groupRows(byCode(slices), true) },
    { name: "Places", note, columns: ["Place", ...groupColsX], rows: groupRows(byPlace(slices)) },
    { name: "Trades", note, columns: ["Trade", ...groupColsX], rows: groupRows(byTrade(slices)) },
    { name: "Activity by trade", note, columns: ["Activity", "Trade", "Hours"],
      rows: byCode(slices).flatMap((g) => g.breakdown.map((b) => [g.key, b.key, r(b.hours)])) },
    { name: "Daily manpower", note, columns: ["Day", "Date", "Day type", "People", ...top, ...(rest.size ? ["Other"] : []), "Hours", "OT"],
      rows: days.map((d) => [d.day, d.date, d.kind, d.headcount, ...top.map((t) => d.byTrade.get(t) ?? 0),
        ...(rest.size ? [[...d.byTrade].filter(([t]) => rest.has(t)).reduce((s, [, c]) => s + c, 0)] : []), r(d.hours), r(d.ot)]) }, // prettier-ignore
    { name: "Workers", note, columns: ["Worker", "Calling names", "Name", "Trade", "Employee code", "Days", "Hours", "OT", "Out after 22:00", "Past midnight",
        "Saturdays", "Sundays", "Holidays", "Longest run", "Current run", "Days away", "First day", "Last day"],
      rows: ps.map((p) => [p.names[0] ?? p.person, p.names.join(", "), p.name, p.trade, p.employeeCode, p.days, r(p.hours), r(p.ot), p.late, p.overnight,
        p.saturdays, p.sundays, p.holidays, p.longestRun, p.currentRun, p.daysOff, p.first, p.last]) }, // prettier-ignore
    { name: "Checks", note, columns: ["Level", "Check", "Entries", "For example"], rows: q.issues.map((i) => [i.severity, i.title, i.count, i.example]) },
    { name: "No employee code", note, columns: ["Worker", "Employee code", "Days"], rows: q.noEmployeeCode.map((x) => [x.name, x.status, x.days]) },
    { name: "ZIDLE", note, columns: ["Day", "Worker", "Hours"], rows: q.idle.map((x) => [Number(x.sheet), x.name, r(x.hours)]) },
    { name: "Unknown codes", note, columns: ["Code", "Entries", "Days"], rows: q.unknownCodes.map((x) => [x.code, x.uses, x.sheets.join(", ")]) },
    { name: "Rare codes", note, columns: ["Code", "Entries", "Workers", "Days"], rows: q.rareCodes.map((x) => [x.code, x.uses, x.names.join(", "), x.sheets.join(", ")]) },
    { name: "Long days", note, columns: ["Day", "Worker", "Times", "Worked"], rows: q.longDays.map((x) => [Number(x.sheet), x.name, formatShift(x.shift[0], x.shift[1]), r(x.worked)]) },
  ];
}
