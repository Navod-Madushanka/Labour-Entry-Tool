// Analysis tab: what the loaded month says about hours, manpower, overtime, attendance and data
// quality. Every figure is worked out in the browser from the day sheets already loaded
// (src/analysis.ts); Excel is not asked. Export puts the same tables in an .xlsx file.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type ExportTable, type LostView, type Master, type Owned, type Review, type SuggestLogSummary, type SuggestOfferSummary } from "../api";
import type { Month } from "../history";
import {
  applyFilter,
  buildData,
  byCode,
  byPlace,
  bySupervisor,
  byTrade,
  daily,
  heatmap,
  kpis,
  LONG_DAY,
  NO_CODE,
  NO_SUPERVISOR,
  people,
  quality,
  round2,
  summarise,
  supervisorDays,
  supervisedDays,
  supervisorWork,
  workerSupervisors,
  type Slice,
  type BookSummary,
  hasRates,
  type DayRow,
  type Filter,
  type Group,
  type PersonRow,
} from "../analysis";
import { store } from "../store";
import { fingerprint, recordColumns } from "./ManpowerSheet";
import { formatShift } from "../time";
import { describe } from "../codes";
import { COLORS, DayBars, DisruptedCtx, dayLabel, h } from "./charts";
import { Programme } from "./Programme";
import { EmptyState } from "./EmptyState";
import { RatesEditor } from "./RatesEditor";
import { SiteReport } from "./SiteReport";
import { LostTime } from "./LostTime";
import { Productivity } from "./Productivity";
import { Fatigue } from "./Fatigue";
import { BpCheck } from "./BpCheck";
import { History } from "./History";
import { Sharing } from "./Sharing";

/** Rupees (at standard rates) instead of hours, where rates are known: the QS's view. */
const MoneyCtx = createContext(false);
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;
const rsShort = (n: number) => (Math.abs(n) >= 1e6 ? `Rs ${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} M` : rs(n));
const byCost = (gs: Group[]) => [...gs].sort((a, b) => b.cost - a.cost);

type Desc = (code: string) => string | null; // what a code is, in words

type View = "overview" | "programme" | "productivity" | "lost" | "fatigue" | "bp" | "history" | "share" | "activities" | "places" | "supervisors" | "manpower" | "timeline" | "overtime" | "attendance" | "quality" | "compare" | "suggestions";
const VIEWS: [View, string][] = [
  ["overview", "Overview"],
  ["programme", "As-built programme"],
  ["productivity", "Productivity"],
  ["activities", "Activities"],
  ["places", "Places & trades"],
  ["supervisors", "Supervisors"],
  ["manpower", "Daily manpower"],
  ["timeline", "Task timeline"],
  ["overtime", "Overtime"],
  ["lost", "Lost time"],
  ["fatigue", "Fatigue & OT risk"],
  ["bp", "BP bill check"],
  ["attendance", "Attendance"],
  ["quality", "Data quality"],
  ["history", "Month history"],
  ["compare", "Compare months"],
  ["suggestions", "Suggestions"],
  ["share", "Share with PM & QS"],
];
const SUMMARY_PREFIX = "labour.summary.";
const RUN_FLAG = 14; // days in a row without a day off that are flagged

const pct = (n: number) => `${(n * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

interface Props {
  master: Master;
  month: Month;
  loaded: number;
  total: number;
  onMasterChanged?: () => void; // place order or plan saved: read the master again
  user?: string; // who gives lost-time reasons here
}

export function Analysis({ master, month, loaded, total, onMasterChanged, user = "" }: Props) {
  const [view, setView] = useState<View>(() => (store.get("labour.analysis.view") as View) || "overview");
  const [filter, setFilter] = useState<Filter>({});
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => store.set("labour.analysis.view", view), [view]);
  const [moneyOn, setMoneyOn] = useState(() => store.get("labour.analysis.money") === "1");
  // compact: tighter spacing for people who want more on one screen (remembered on this PC)
  const [compact, setCompact] = useState(() => store.get("labour.analysis.compact") === "1");
  useEffect(() => store.set("labour.analysis.compact", compact ? "1" : "0"), [compact]);
  // the filters and view tabs stay in sight under the status bar while the page scrolls
  const [barH, setBarH] = useState(0);
  useEffect(() => {
    const bar = document.querySelector(".statusbar") as HTMLElement | null;
    if (!bar) return;
    const fit = () => setBarH(bar.offsetHeight);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  useEffect(() => store.set("labour.analysis.money", moneyOn ? "1" : "0"), [moneyOn]);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [lost, setLost] = useState<LostView>({ causes: [], items: [] });
  useEffect(() => {
    api.lostTime().then(setLost, () => undefined);
  }, [month]);
  const [carry, setCarry] = useState<Record<string, number>>({});
  useEffect(() => {
    api.historyCarry().then(setCarry, () => setCarry({}));
  }, [master.workbook, view]);
  const disruptedSet = useMemo(() => {
    const dayOf = new Map(Object.keys(month).map((s) => [s, Number(s)]));
    return new Set(lost.items.filter((i) => !i.supervisor && i.causes.length).map((i) => dayOf.get(i.sheet) ?? Number(i.sheet)));
  }, [lost, month]);
  const rated = hasRates(master.rates);
  const money = moneyOn && rated;

  // whose manpower sheet each pushed entry came from (Supervisors page), and their reviews
  const [owned, setOwned] = useState<Owned[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  useEffect(() => {
    api.supervisorSheets().then(setOwned).catch(() => undefined);
    api.supervisorReviews().then(setReviews).catch(() => undefined);
  }, [month]);
  const owners = useMemo(() => new Map(owned.map((o) => [`${o.sheet}|${o.calling_name}`, o.supervisor])), [owned]);
  // entries ("sheet|calling name") on supervisor sheets changed after they were reviewed
  const changedAfterReview = useMemo(() => {
    const out = new Set<string>();
    for (const r of reviews) {
      if (r.status === "cleared") continue;
      const list = owned.filter((o) => o.sheet === r.sheet && o.supervisor === r.supervisor);
      if (list.length && fingerprint(recordColumns(list, month[r.sheet])) !== r.fingerprint) for (const o of list) out.add(`${o.sheet}|${o.calling_name}`);
    }
    return out;
  }, [reviews, owned, month]);
  const data = useMemo(() => buildData(month, master, owners), [month, master, owners]);
  const { slices, entries } = useMemo(() => applyFilter(data, filter), [data, filter]);
  const k = useMemo(() => kpis(slices), [slices]);
  const allDays = data.days;
  const trades = useMemo(() => [...new Set(data.slices.map((s) => s.trade))].sort(), [data]);
  const places = useMemo(() => byPlace(data.slices).map((g) => g.key), [data]);
  const codes = useMemo(() => byCode(data.slices).map((g) => g.key), [data]);
  const supervisors = useMemo(() => bySupervisor(data.slices).map((g) => g.key), [data]);
  const complete = loaded >= total && total > 0;
  const desc: Desc = useCallback((code: string) => describe(code, master.descriptions), [master.descriptions]);

  // Keep this workbook's summary for "Compare months" once the whole month is loaded.
  useEffect(() => {
    if (!complete || !data.slices.length) return;
    store.set(SUMMARY_PREFIX + master.workbook, JSON.stringify(summarise(master.workbook, master.month, data)));
  }, [complete, data, master.workbook, master.month]);

  const set = (patch: Partial<Filter>) => setFilter((f) => ({ ...f, ...patch }));
  const filtered = Boolean(filter.trade || filter.supervisor || filter.place || filter.code || filter.from || filter.to);
  const dayName = (d?: number) => { const x = allDays.find((y) => y.day === d); return x ? dayLabel(x) : String(d); };
  const chips: { key: string; label: string; value: string; clear: Partial<Filter> }[] = [
    filter.trade ? { key: "trade", label: "Trade", value: filter.trade, clear: { trade: undefined } } : null,
    filter.supervisor ? { key: "supervisor", label: "Supervisor", value: filter.supervisor, clear: { supervisor: undefined } } : null,
    filter.place ? { key: "place", label: "Place", value: filter.place, clear: { place: undefined } } : null,
    filter.code ? { key: "code", label: "Activity", value: [filter.code, desc(filter.code)].filter(Boolean).join(" · "), clear: { code: undefined } } : null,
    filter.from || filter.to ? { key: "days", label: "Days", value: `${filter.from ? dayName(filter.from) : "first"} – ${filter.to ? dayName(filter.to) : "last"}`, clear: { from: undefined, to: undefined } } : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);

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
    <MoneyCtx.Provider value={money}>
    <DisruptedCtx.Provider value={disruptedSet}>
    <section className={`analysis${compact ? " compact" : ""}`}>
      <div className="section-head">
        <h2>Analysis · {master.workbook}</h2>
        <span className="row analysis-tools">
          <span className="seg" role="group" aria-label="Show hours or rupees">
            <button className={!moneyOn ? "active" : ""} onClick={() => setMoneyOn(false)}>Hours</button>
            <button className={moneyOn ? "active" : ""} onClick={() => setMoneyOn(true)}>Rs</button>
          </span>
          <span className="seg" role="group" aria-label="Spacing">
            <button className={!compact ? "active" : ""} aria-pressed={!compact} onClick={() => setCompact(false)} title="More space between sections">Comfortable</button>
            <button className={compact ? "active" : ""} aria-pressed={compact} onClick={() => setCompact(true)} title="More on one screen">Compact</button>
          </span>
          <button className="link small" onClick={() => setRatesOpen((o) => !o)}>Standard rates…</button>
          <button onClick={() => setReportOpen(true)} disabled={!data.slices.length} title="One A4 page for a week or the month, and the monthly labour return">
            Site report
          </button>
        <button className="primary" onClick={doExport} disabled={exporting || !slices.length}>
          {exporting ? "Exporting…" : "Export to Excel"}
        </button>
        </span>
      </div>
      <p className="muted small">
        Worked out from the day sheets as loaded ({loaded} of {total}
        {complete ? "" : ", still loading"}), including entries pushed today. Waiting entries are not counted until pushed.
        Excel is not changed.
      </p>
      {error && <p className="error-text">{error}</p>}
      {reportOpen && (
        <SiteReport
          data={data}
          master={master}
          desc={desc}
          lost={lost}
          onClose={() => setReportOpen(false)}
          onView={(v) => {
            setFilter({});
            setView(v === "trades" ? "places" : v);
          }}
        />
      )}
      {ratesOpen && <RatesEditor onClose={() => setRatesOpen(false)} onSaved={() => onMasterChanged?.()} />}
      {moneyOn && !rated && !ratesOpen && (
        <div className="card empty-money">
          <b>Add rates to see rupees.</b>{" "}
          <span className="muted small">A standard daily rate per trade (about 10 numbers from the QS) turns every view into labour cost.</span>{" "}
          <button className="small primary" onClick={() => setRatesOpen(true)}>Add standard rates</button>
        </div>
      )}
      {money && (
        <p className="muted small money-note">
          Rupees at standard rates (costing rates, not pay), rates known for {pct(kpis(slices).coverage)} of the hours. Overtime per activity is
          attributed by hours; Excel books it as its own line.
        </p>
      )}

      <div className="analysis-sticky" style={{ top: barH }}>
      <div className="filters card">
        <label>
          Trade
          <select value={filter.trade ?? ""} onChange={(e) => set({ trade: e.target.value || undefined })}>
            <option value="">All trades</option>
            {trades.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        {owned.length > 0 && (
          <label>
            Supervisor
            <select aria-label="Supervisor filter" value={filter.supervisor ?? ""} onChange={(e) => set({ supervisor: e.target.value || undefined })}>
              <option value="">All supervisors</option>
              {supervisors.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        )}
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
      </div>
      {filtered && (
        <div className="filter-chips" aria-label="Active filters">
          {chips.map((c) => (
            <span key={c.key} className="chip">
              <span className="chip-label">{c.label}</span> {c.value}
              <button className="chip-x" aria-label={`Remove filter ${c.label}: ${c.value}`} title="Remove this filter" onClick={() => set(c.clear)}>✕</button>
            </span>
          ))}
          <button className="link small" onClick={() => setFilter({})}>
            Clear filters
          </button>
        </div>
      )}

      <nav className="subtabs" role="tablist">
        {VIEWS.filter(([v]) => v !== "supervisors" || owned.length > 0 || view === v).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
      </nav>
      </div>

      {view === "suggestions" ? (
        <SuggestionLog />
      ) : view === "share" ? (
        <Sharing />
      ) : view === "history" ? (
        <History master={master} desc={desc} onSaved={() => onMasterChanged?.()} />
      ) : !slices.length && view !== "compare" ? (
        <p className="muted">{data.slices.length ? "Nothing matches these filters." : "No entries with worked hours yet."}</p>
      ) : view === "overview" ? (
        <Overview k={k} data={{ slices, entries }} days={daily(data, slices, filter)} onView={setView} desc={desc} />
      ) : view === "programme" ? (
        <Programme slices={slices} days={daily(data, slices, filter)} master={master} trade={filter.trade} desc={desc} onPick={(code) => set({ code })} onSaved={() => onMasterChanged?.()} />
      ) : view === "productivity" ? (
        <Productivity data={data} master={master} desc={desc} money={money} disrupted={disruptedSet} onSaved={() => onMasterChanged?.()} />
      ) : view === "fatigue" ? (
        <Fatigue data={data} entries={entries} days={daily(data, slices, filter)} master={master} disrupted={disruptedSet} carry={carry} onSaved={() => onMasterChanged?.()} />
      ) : view === "bp" ? (
        <BpCheck data={data} entries={entries} master={master} money={money} changedAfterReview={changedAfterReview} />
      ) : view === "lost" ? (
        <LostTime data={data} slices={slices} items={lost.items} causes={lost.causes} user={user} onSaved={(items) => setLost((l) => ({ ...l, items }))} />
      ) : view === "activities" ? (
        <Activities groups={byCode(slices)} onPick={(code) => set({ code })} withActivities={data.withActivities} desc={desc} />
      ) : view === "places" ? (
        <PlacesTrades places={byPlace(slices)} trades={byTrade(slices)} onPlace={(place) => set({ place })} onTrade={(trade) => set({ trade })} />
      ) : view === "supervisors" && !owned.length ? (
        <EmptyState title="No supervisor sheets yet">
          This view fills in once day sheets are pushed from supervisors' manpower sheets (Manpower sheet → Push, with the supervisor
          chosen). Entries typed straight into a day sheet have no supervisor.
        </EmptyState>
      ) : view === "supervisors" ? (
        <SupervisorsView data={data} entries={entries} slices={slices} days={daily(data, slices, filter)} owned={owned} reviews={reviews} month={month} onPick={(supervisor) => set({ supervisor })} desc={desc} />
      ) : view === "manpower" ? (
        <Manpower days={daily(data, slices, filter)} />
      ) : view === "timeline" ? (
        <Timeline slices={slices} days={daily(data, slices, filter)} onPick={(code) => set({ code })} desc={desc} />
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
    </DisruptedCtx.Provider>
    </MoneyCtx.Provider>
  );
}

// ------------------------------------------------------------------------------ the views

function Kpi({ label, value, note, def, badge }: { label: string; value: string; note?: string; def?: string; badge?: { text: string; title: string } }) {
  return (
    <div className="kpi">
      <div className="kpi-value">
        {value}
        {badge && <span className="badge warn kpi-badge" title={badge.title}>{badge.text}</span>}
      </div>
      <div className="kpi-label">{label}</div>
      {note && <div className="kpi-note">{note}</div>}
      {def && <div className="kpi-def">{def}</div>}
    </div>
  );
}

function Overview({ k, data, days, onView, desc }: { k: ReturnType<typeof kpis>; data: ReturnType<typeof applyFilter>; days: DayRow[]; onView: (v: View) => void; desc: Desc }) {
  const disrupted = useContext(DisruptedCtx);
  const money = useContext(MoneyCtx);
  const top = byCode(data.slices).filter((g) => g.key !== NO_CODE).slice(0, 5);
  const trades = byTrade(data.slices).slice(0, 5);
  // some hours have no rate: the cost is understated, and says so on the tile
  const partial = k.coverage < 0.995 ? { text: "partial", title: `Rates known for ${pct(k.coverage)} of the hours: the cost leaves out the rest` } : undefined;
  return (
    <>
      {money && (
        <div className="kpis money">
          <Kpi label="labour cost" value={rsShort(k.cost)} note="at standard rates" badge={partial} def="Normal hours × hourly rate, plus overtime × hourly rate × its multiplier." />
          <Kpi label="OT premium" value={rsShort(k.otPremium)} note={k.cost ? `${pct(k.otPremium / k.cost)} of the cost` : undefined} def="Only the amount above the normal rate: what the overtime adds." />
          <Kpi label="unallocated cost (ZIDLE)" value={rsShort(k.idleCost)} note={k.cost ? `${pct(k.idleCost / k.cost)} of the cost` : undefined} def="Cost of worked hours not booked to an activity code." />
          <Kpi label="cost per worker-day" value={rs(k.costPerWorkerDay)} note={`rates known for ${pct(k.coverage)} of hours`} badge={partial} def="Labour cost over worker-days with a rate." />
        </div>
      )}
      <div className="kpis">
        <Kpi label="hours worked" value={h(k.hours)} note={`${h(k.normal)} normal`} def="Effective hours, as Excel works them out (after lunch and dinner)." />
        <Kpi label="overtime hours" value={h(k.ot)} note={`${pct(k.otPct)} of all hours`} def="After 8 h on a normal day, 5.5 h on Saturday, every hour on Sundays and holidays." />
        <Kpi label="worker-days" value={h(k.workerDays)} note={`${k.workDays} days with work`} def="One per worker per day sheet; a person on two calling names that day counts twice." />
        <Kpi label="headcount" value={String(k.people)} note={`${h(k.avgHeadcount)} a day on average`} def="Different people this period; the average counts days with work only." />
        <Kpi label="peak headcount" value={String(k.peak?.count ?? 0)} note={k.peak ? `day ${k.peak.day}` : undefined} def="Most people on site on one day." />
        <Kpi label="unallocated hours (ZIDLE)" value={h(k.idle)} note={k.hours ? `${pct(k.idle / k.hours)} of all hours` : undefined} def="Worked hours not booked to an activity code: forgotten codes as well as real waiting." />
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Headcount by day</h3>
          <button className="link small" onClick={() => onView("manpower")}>by trade →</button>
        </div>
        <DayBars days={days} series={[{ key: "all", label: "People", color: COLORS[0] }]} value={(d) => d.headcount} unit="people" disrupted={disrupted} />
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <h3>Top activities</h3>
            <button className="link small" onClick={() => onView("activities")}>all →</button>
          </div>
          <ShareList money={money} items={(money ? byCost(top) : top).map((g) => ({ key: g.key, value: money ? g.cost : g.hours, note: [desc(g.key), g.place].filter(Boolean).join(" · ") }))} total={money ? k.cost : k.hours} />
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Hours by trade</h3>
            <button className="link small" onClick={() => onView("places")}>all →</button>
          </div>
          <ShareList money={money} items={(money ? byCost(trades) : trades).map((g) => ({ key: g.key, value: money ? g.cost : g.hours, note: `${g.workers} people` }))} total={money ? k.cost : k.hours} />
        </div>
      </div>
    </>
  );
}

function ShareList({ items, total, money }: { items: { key: string; value: number; note?: string }[]; total: number; money?: boolean }) {
  return (
    <ul className="share-list">
      {items.map((i) => (
        <li key={i.key}>
          <span className="share-name">
            {i.key}
            {i.note && <span className="muted small"> · {i.note}</span>}
          </span>
          <span className="share-value">{money ? rs(i.value) : `${h(i.value)} h`}</span>
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

const groupCols = (first: string, extra: Col<Group>[] = [], money = false): Col<Group>[] => [
  { key: "key", label: first, value: (g) => g.key },
  ...extra,
  ...(money
    ? ([
        { key: "cost", label: "Cost (Rs)", value: (g) => g.cost, num: true, fmt: (v) => rs(v as number), title: "At standard rates: normal hours × hourly rate + overtime × hourly rate × multiplier" },
        { key: "otp", label: "OT premium (Rs)", value: (g) => g.otPremium, num: true, fmt: (v) => rs(v as number), title: "The part of the cost above the normal rate" },
        { key: "costPct", label: "Cost share", value: (g) => g.costPct, num: true, fmt: (v) => <span className="share-cell">{pct(v as number)}<Bar frac={v as number} color={COLORS[2]} /></span> },
      ] as Col<Group>[])
    : []),
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

function Activities({ groups, onPick, withActivities, desc }: { groups: Group[]; onPick: (code: string) => void; withActivities: boolean; desc: Desc }) {
  const money = useContext(MoneyCtx);
  return (
    <div className="card">
      <h3>{money ? "Labour cost by activity code (at standard rates)" : "Hours by activity code"}</h3>
      <p className="muted small">
        {withActivities
          ? "Overtime and worker-days are shared over each entry's lines by their hours. Click a row for its trades; the filter button shows only that code everywhere."
          : "This workbook is kept without activity codes, so all hours are unallocated (ZIDLE)."}
      </p>
      <SortTable
        cols={groupCols("Activity", [{ key: "desc", label: "Description", value: (g) => desc(g.key) ?? "" }, { key: "place", label: "Place", value: (g) => g.place ?? "" }], money)}
        rows={money ? byCost(groups) : groups}
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
  const money = useContext(MoneyCtx);
  return (
    <>
      <div className="card">
        <h3>{money ? "Labour cost by place (at standard rates)" : "Hours by place"}</h3>
        <p className="muted small">From the activity code's place ending (named once per project on the start page).</p>
        <SortTable cols={groupCols("Place", [], money)} rows={money ? byCost(places) : places} rowKey={(g) => g.key}
          expand={(g) => (<><Breakdown g={g} label="By trade" /><button className="link small" onClick={() => onPlace(g.key)}>Filter by this place</button></>)} />
      </div>
      <div className="card">
        <h3>{money ? "Labour cost by trade (at standard rates)" : "Hours by trade"}</h3>
        <SortTable
          cols={groupCols("Trade", [], money)}
          rows={money ? byCost(trades) : trades}
          rowKey={(g) => g.key}
          expand={(g) => (<><Breakdown g={g} label="By activity" /><button className="link small" onClick={() => onTrade(g.key)}>Filter by this trade</button></>)}
        />
      </div>
    </>
  );
}

/** Sheets and reviews per supervisor (all days of the month, whatever the filter). A review counts
 * while the sheet is as it was when reviewed (as on the Supervisors page). */
function sheetCounts(owned: Owned[], reviews: Review[], month: Month) {
  const out = new Map<string, { sheets: number; ok: number; problem: number }>();
  const sheets = new Map<string, Owned[]>();
  for (const o of owned) sheets.set(`${o.sheet}|${o.supervisor}`, [...(sheets.get(`${o.sheet}|${o.supervisor}`) ?? []), o]);
  for (const list of sheets.values()) {
    const c = out.get(list[0].supervisor) ?? { sheets: 0, ok: 0, problem: 0 };
    c.sheets += 1;
    out.set(list[0].supervisor, c);
  }
  for (const r of reviews) {
    const list = sheets.get(`${r.sheet}|${r.supervisor}`);
    if (!list || r.status === "cleared" || fingerprint(recordColumns(list, month[r.sheet])) !== r.fingerprint) continue;
    out.get(r.supervisor)![r.status] += 1;
  }
  return out;
}

function SupervisorsView({ data, entries, slices, days, owned, reviews, month, onPick, desc }: {
  data: ReturnType<typeof buildData>;
  entries: ReturnType<typeof applyFilter>["entries"];
  slices: Slice[];
  days: DayRow[];
  owned: Owned[];
  reviews: Review[];
  month: Month;
  onPick: (s: string) => void;
  desc: Desc;
}) {
  const realName = (n: string) => String(data.workers.get(n)?.name ?? "");
  const log = supervisedDays(data, entries);
  const whose = workerSupervisors(entries);
  const work = supervisorWork(slices);
  const groups = bySupervisor(slices);
  const money = useContext(MoneyCtx);
  const counts = sheetCounts(owned, reviews, month);
  const none = groups.find((g) => g.key === NO_SUPERVISOR);
  const perDay = supervisorDays(slices);
  const named = groups.filter((g) => g.key !== NO_SUPERVISOR).map((g) => g.key);
  const top = named.slice(0, 8);
  const cols = (key: string) => counts.get(key);
  return (
    <>
      <div className="card">
        <h3>Hours by supervisor</h3>
        <p className="muted small">
          Whose manpower sheet each entry came from, as given at push (Supervisors page).
          {none ? ` ${pct(none.pct)} of the hours have no supervisor: pushed before supervisors were asked, or typed in Excel.` : ""}
        </p>
        {!owned.length ? (
          <p className="muted">No supervisors yet: the tool asks for one at each push.</p>
        ) : (
          <SortTable
            cols={groupCols("Supervisor", [
              { key: "sheets", label: "Sheets", value: (g) => cols(g.key)?.sheets ?? 0, num: true, title: "Day sheets with entries from this supervisor (whole month)" },
              { key: "ok", label: "Reviewed", value: (g) => cols(g.key)?.ok ?? 0, num: true, title: "Sheets checked against the paper and matching (not changed since)" },
              { key: "problem", label: "Problems", value: (g) => cols(g.key)?.problem ?? 0, num: true, fmt: (v) => (v ? <span className="warn-text">{v as number}</span> : "0") },
            ], money)}
            rows={money ? byCost(groups) : groups}
            rowKey={(g) => g.key}
            expand={(g) => (
              <>
                <Breakdown g={g} label="By activity" />
                <button className="link small" onClick={() => onPick(g.key)}>
                  Filter by this supervisor
                </button>
              </>
            )}
          />
        )}
      </div>
      {top.length > 0 && (
        <div className="card">
          <h3>People by day, by supervisor</h3>
          <SortTable
            cols={[
              { key: "day", label: "Day", value: (d: DayRow) => d.day, num: true, fmt: (_v, d) => dayLabel(d) },
              ...top.map((t) => ({ key: `s-${t}`, label: t, value: (d: DayRow) => perDay.get(d.day)?.get(t) ?? 0, num: true })),
              ...(none ? [{ key: "none", label: NO_SUPERVISOR, value: (d: DayRow) => perDay.get(d.day)?.get(NO_SUPERVISOR) ?? 0, num: true }] : []),
              { key: "n", label: "All", value: (d: DayRow) => d.headcount, num: true },
            ]}
            rows={days.filter((d) => d.headcount)}
            rowKey={(d) => d.sheet}
            limit={31}
          />
        </div>
      )}
      {owned.length > 0 && (
        <>
          <div className="card sup-log">
            <h3>Who worked under whom, by date</h3>
            <p className="muted small">Each worker's day and the supervisor whose manpower sheet it was on.</p>
            <SortTable
              search="Search worker, name, supervisor, date or code"
              cols={[
                { key: "date", label: "Date", value: (r) => `${r.date ?? ""} ${longDay(r.date, r.day)}`, fmt: (_v, r) => longDay(r.date, r.day) },
                { key: "name", label: "Worker", value: (r) => r.name },
                { key: "real", label: "Name", value: (r) => realName(r.name) },
                { key: "trade", label: "Trade", value: (r) => r.trade },
                { key: "sup", label: "Supervisor", value: (r) => r.supervisor },
                { key: "hours", label: "Hours", value: (r) => r.hours, num: true, fmt: (v) => h(v as number) },
                { key: "ot", label: "OT", value: (r) => r.ot, num: true, fmt: (v) => h(v as number) },
                { key: "codes", label: "Activity codes", value: (r) => r.codes.join(", ") },
              ]}
              rows={log}
              rowKey={(r) => `${r.sheet}|${r.name}`}
              initial={{ key: "date", desc: true }}
            />
          </div>
          <div className="card sup-whose">
            <h3>Whose worker</h3>
            <p className="muted small">The supervisor of most of each worker's days, and every supervisor they worked under.</p>
            <SortTable
              search="Search worker, name, trade or supervisor"
              cols={[
                { key: "name", label: "Worker", value: (r) => r.name },
                { key: "real", label: "Name", value: (r) => realName(r.name) },
                { key: "trade", label: "Trade", value: (r) => r.trade },
                { key: "sup", label: "Supervisor", value: (r) => r.supervisor, fmt: (v) => <b>{v}</b> },
                { key: "share", label: "Of their days", value: (r) => r.share, num: true, fmt: (v) => pct(v as number) },
                { key: "days", label: "Days", value: (r) => r.days, num: true },
                {
                  key: "all",
                  label: "All supervisors (days, first–last day)",
                  value: (r) => r.all.map((x) => `${x.supervisor} ${x.days}`).join(", "),
                  fmt: (_v, r) => r.all.map((x) => `${x.supervisor} ${x.days} (${x.first === x.last ? x.first : `${x.first}–${x.last}`})`).join(" · "),
                },
              ]}
              rows={whose}
              rowKey={(r) => r.person}
              initial={{ key: "name", desc: false }}
            />
          </div>
          <div className="card sup-work">
            <h3>Where each supervisor's people worked</h3>
            <p className="muted small">Supervisor, place and activity code, with the hours and the people on it.</p>
            <SortTable
              search="Search supervisor, place or activity code"
              cols={[
                { key: "sup", label: "Supervisor", value: (r) => r.supervisor },
                { key: "place", label: "Place", value: (r) => r.place },
                { key: "code", label: "Activity code", value: (r) => r.code },
                { key: "desc", label: "Description", value: (r) => desc(r.code) ?? "" },
                { key: "hours", label: "Hours", value: (r) => r.hours, num: true, fmt: (v) => h(v as number) },
                { key: "ot", label: "OT", value: (r) => r.ot, num: true, fmt: (v) => h(v as number) },
                { key: "people", label: "People", value: (r) => r.people, num: true },
                { key: "days", label: "Days", value: (r) => r.days, num: true },
                { key: "first", label: "First day", value: (r) => r.first, num: true },
                { key: "last", label: "Last day", value: (r) => r.last, num: true },
              ]}
              rows={work}
              rowKey={(r) => `${r.supervisor}|${r.place}|${r.code}`}
            />
          </div>
        </>
      )}
    </>
  );
}

const longDay = (date: string | null, day: number) =>
  date ? new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : `Day ${day}`;

function topTrades(days: DayRow[], n = 6) {
  const sums = new Map<string, number>();
  for (const d of days) for (const [t, c] of d.byTrade) sums.set(t, (sums.get(t) ?? 0) + c);
  const sorted = [...sums].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return { top: sorted.slice(0, n), rest: new Set(sorted.slice(n)) };
}

function Manpower({ days }: { days: DayRow[] }) {
  const disrupted = useContext(DisruptedCtx);
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
        <DayBars days={days} series={series} value={value} unit="people" disrupted={disrupted} />
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

function Timeline({ slices, days, onPick, desc }: { slices: ReturnType<typeof applyFilter>["slices"]; days: DayRow[]; onPick: (code: string) => void; desc: Desc }) {
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
                    <button className="link" onClick={() => onPick(c)} title={`${desc(c) ? `${desc(c)}\n` : ""}Click to filter every view by this activity`}>{c}</button>
                    <span className="pick-hint" aria-hidden="true">filter</span>
                    {desc(c) && <div className="muted small heat-desc">{desc(c)}</div>}
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
  const disrupted = useContext(DisruptedCtx);
  const money = useContext(MoneyCtx);
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
        <DayBars days={days} series={[{ key: "ot", label: "OT hours", color: COLORS[1] }]} value={(d) => d.ot} unit="h" disrupted={disrupted} />
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
            ...(money ? [{ key: "otp", label: "OT premium (Rs)", title: "At standard rates", value: (g: Group) => g.otPremium, num: true, fmt: (v: string | number | null) => rs(v as number) }] : []),
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
    [`Unallocated hours (ZIDLE): worked hours not booked to an activity (${h(idleTotal)} h)`, q.idle.length,
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
    ["Unallocated hours (ZIDLE)", (b) => b.idle, h],
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

const TIER_NAMES: Record<string, string> = {
  partners: "Usual partners today",
  sametimes: "Same trade, same times today",
  last: "Worker's last day",
  trade: "Trade today",
  month: "Trade this month",
  usual: "Worker's usual times",
  crew: "Whole record from the crew",
};

/** How the suggestions do as people really use the screen (the log on this PC). */
function SuggestionLog() {
  const [days, setDays] = useState(30);
  const [s, setS] = useState<SuggestLogSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.suggestLogSummary(days).then(setS, (e) => setError(String(e.message ?? e)));
  }, [days]);
  if (error) return <p className="error-text">{error}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  const block = (title: string, o: SuggestOfferSummary) => (
    <div className="card">
      <h3>{title}</h3>
      {o.shown ? (
        <>
          <p className="small">
            Kept as suggested: <b>{pct(o.kept / o.shown)}</b> of {o.shown}
            {o.prefilled > 0 && <> · filled in the box: {o.prefilled}, of them kept {pct(o.prefill_kept / o.prefilled)}</>}
          </p>
          <SortTable
            cols={[
              { key: "tier", label: "Rule", value: (r: [string, { shown: number; kept: number }]) => TIER_NAMES[r[0]] ?? r[0] },
              { key: "shown", label: "Offered", value: (r) => r[1].shown, num: true },
              { key: "kept", label: "Kept", value: (r) => r[1].kept, num: true },
              { key: "rate", label: "Kept %", value: (r) => (r[1].shown ? r[1].kept / r[1].shown : 0), num: true, fmt: (v) => <span className="share-cell">{pct(v as number)}<Bar frac={v as number} /></span> },
            ]}
            rows={Object.entries(o.tiers)}
            rowKey={(r) => r[0]}
            initial={{ key: "shown", desc: true }}
          />
        </>
      ) : (
        <p className="muted small">Nothing logged yet.</p>
      )}
    </div>
  );
  return (
    <>
      <div className="card-head">
        <p className="muted small">
          Logged on this PC each time an entry is added (no names): which rule made the suggestion, whether the entry kept it, and the
          keys it took. File: {s.file}
        </p>
        <label className="small">
          Last{" "}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90, 365].map((d) => <option key={d}>{d}</option>)}
          </select>{" "}
          days
        </label>
      </div>
      <div className="kpis">
        <Kpi label="entries added" value={String(s.entries)} note={`${s.workers} workers`} />
        <Kpi label="keys per worker" value={s.keys_per_worker === null ? "—" : String(s.keys_per_worker)} note={s.keys_per_entry === null ? undefined : `${s.keys_per_entry} per entry`} />
        <Kpi label="keys in the worker box" value={s.worker_keys === null ? "—" : String(s.worker_keys)} note="per entry" />
        <Kpi label="seconds per entry" value={s.seconds_per_entry === null ? "—" : String(s.seconds_per_entry)} />
      </div>
      {block("Times", s.time)}
      {block("Activity code", s.code)}
      {s.record.shown > 0 && block("Whole record", s.record)}
    </>
  );
}

// ------------------------------------------------------------------------- building blocks

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
  search?: boolean | string; // a string: what the box searches (its placeholder and label)
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
        <input className="table-search" placeholder={typeof search === "string" ? search : "Search worker, name or trade"} value={q} onChange={(e) => setQ(e.target.value)} aria-label={typeof search === "string" ? search : "Search"} />
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
      <div className="table-foot">
        {expand && visible.length > 0 && <span className="muted small">▸ Click a row (or press Enter on it) to open its breakdown.</span>}
        {shown.length > limit && (
          <button className="link small" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${shown.length}`}
          </button>
        )}
      </div>
    </>
  );
}

function RowWithDetail({ open, cols, detail, onToggle, children }: { open: boolean; cols: number; detail: ReactNode; onToggle?: () => void; children: ReactNode }) {
  return (
    <>
      <tr
        className={onToggle ? `clickable expandable${open ? " open" : ""}` : ""}
        onClick={onToggle}
        tabIndex={onToggle ? 0 : undefined}
        aria-expanded={onToggle ? open : undefined}
        onKeyDown={onToggle ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
      >
        {children}
      </tr>
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
  const f = [filter.trade && `trade ${filter.trade}`, filter.supervisor && `supervisor ${filter.supervisor}`, filter.place && `place ${filter.place}`, filter.code && `activity ${filter.code}`,
    (filter.from || filter.to) && `days ${filter.from ?? "first"}–${filter.to ?? "last"}`].filter(Boolean).join(", "); // prettier-ignore
  const note = `${master.workbook} · ${master.month}${f ? ` · filtered: ${f}` : ""}`;
  const d = (code: string) => describe(code, master.descriptions) ?? "";
  const money = hasRates(master.rates);
  const groupRows = (gs: Group[], withPlace = false) =>
    gs.map((g) => [g.key, ...(withPlace ? [d(g.key), g.place ?? ""] : []), r(g.hours), r(g.normal), r(g.ot), r(g.workerDays), g.workers, g.days, g.first, g.last, r(g.pct * 100),
      ...(money ? [Math.round(g.cost), Math.round(g.otPremium)] : [])]); // prettier-ignore
  const groupColsX = ["Hours", "Normal", "OT", "Worker-days", "People", "Days", "First day", "Last day", "Share %", ...(money ? ["Cost (Rs, standard rates)", "OT premium (Rs)"] : [])];
  const days = daily(data, slices, filter);
  const { top, rest } = topTrades(days, 20);
  const ps = people(data, entries);
  const q = quality(data, entries);
  return [
    { name: "Summary", note, columns: ["Figure", "Value"], rows: [
      ["Hours worked", r(k.hours)], ["Normal hours", r(k.normal)], ["Overtime hours", r(k.ot)], ["OT share %", r(k.otPct * 100)],
      ["Worker-days", r(k.workerDays)], ["People", k.people], ["Days with work", k.workDays], ["Average people a day", r(k.avgHeadcount)],
      ["Peak headcount", k.peak?.count ?? 0], ["Peak day", k.peak?.day ?? null], ["Unallocated hours (ZIDLE)", r(k.idle)], ["Activity codes used", k.codes],
      ...(money ? [["Labour cost (Rs, standard rates)", Math.round(k.cost)], ["OT premium (Rs)", Math.round(k.otPremium)], ["Unallocated cost (Rs)", Math.round(k.idleCost)],
        ["Cost per worker-day (Rs)", Math.round(k.costPerWorkerDay)], ["Rates known for % of hours", r(k.coverage * 100)]] : []),
    ] }, // prettier-ignore
    { name: "Activities", note, columns: ["Activity", "Description", "Place", ...groupColsX], rows: groupRows(byCode(slices), true) },
    { name: "Places", note, columns: ["Place", ...groupColsX], rows: groupRows(byPlace(slices)) },
    { name: "Trades", note, columns: ["Trade", ...groupColsX], rows: groupRows(byTrade(slices)) },
    { name: "Supervisors", note, columns: ["Supervisor", ...groupColsX], rows: groupRows(bySupervisor(slices)) },
    { name: "Supervisor by activity", note, columns: ["Supervisor", "Activity", "Hours"],
      rows: bySupervisor(slices).flatMap((g) => g.breakdown.map((b) => [g.key, b.key, r(b.hours)])) },
    { name: "Worker days by supervisor", note, columns: ["Day", "Date", "Worker", "Name", "Trade", "Supervisor", "Hours", "OT", "Activity codes"],
      rows: supervisedDays(data, entries).map((x) => [x.day, x.date, x.name, String(data.workers.get(x.name)?.name ?? ""), x.trade, x.supervisor, r(x.hours), r(x.ot), x.codes.join(", ")]) },
    { name: "Whose worker", note, columns: ["Worker", "Name", "Trade", "Supervisor", "Share of days %", "Days", "All supervisors (days)"],
      rows: workerSupervisors(entries).map((x) => [x.name, String(data.workers.get(x.name)?.name ?? ""), x.trade, x.supervisor, r(x.share * 100), x.days,
        x.all.map((y) => `${y.supervisor} ${y.days}`).join(", ")]) }, // prettier-ignore
    { name: "Supervisor place activity", note, columns: ["Supervisor", "Place", "Activity", "Description", "Hours", "OT", "People", "Days", "First day", "Last day"],
      rows: supervisorWork(slices).map((x) => [x.supervisor, x.place, x.code, d(x.code), r(x.hours), r(x.ot), x.people, x.days, x.first, x.last]) },
    { name: "Activity by trade", note, columns: ["Activity", "Description", "Trade", "Hours"],
      rows: byCode(slices).flatMap((g) => g.breakdown.map((b) => [g.key, d(g.key), b.key, r(b.hours)])) },
    { name: "Daily manpower", note, columns: ["Day", "Date", "Day type", "People", ...top, ...(rest.size ? ["Other"] : []), "Hours", "OT"],
      rows: days.map((d) => [d.day, d.date, d.kind, d.headcount, ...top.map((t) => d.byTrade.get(t) ?? 0),
        ...(rest.size ? [[...d.byTrade].filter(([t]) => rest.has(t)).reduce((s, [, c]) => s + c, 0)] : []), r(d.hours), r(d.ot)]) }, // prettier-ignore
    { name: "Workers", note, columns: ["Worker", "Calling names", "Name", "Trade", "Employee code", "Days", "Hours", "OT", "Out after 22:00", "Past midnight",
        "Saturdays", "Sundays", "Holidays", "Longest run", "Current run", "Days away", "First day", "Last day"],
      rows: ps.map((p) => [p.names[0] ?? p.person, p.names.join(", "), p.name, p.trade, p.employeeCode, p.days, r(p.hours), r(p.ot), p.late, p.overnight,
        p.saturdays, p.sundays, p.holidays, p.longestRun, p.currentRun, p.daysOff, p.first, p.last]) }, // prettier-ignore
    { name: "Checks", note, columns: ["Level", "Check", "Entries", "For example"], rows: q.issues.map((i) => [i.severity, i.title, i.count, i.example]) },
    { name: "No employee code", note, columns: ["Worker", "Employee code", "Days"], rows: q.noEmployeeCode.map((x) => [x.name, x.status, x.days]) },
    { name: "Unallocated (ZIDLE)", note, columns: ["Day", "Worker", "Unallocated hours"], rows: q.idle.map((x) => [Number(x.sheet), x.name, r(x.hours)]) },
    { name: "Unknown codes", note, columns: ["Code", "Entries", "Days"], rows: q.unknownCodes.map((x) => [x.code, x.uses, x.sheets.join(", ")]) },
    { name: "Rare codes", note, columns: ["Code", "Entries", "Workers", "Days"], rows: q.rareCodes.map((x) => [x.code, x.uses, x.names.join(", "), x.sheets.join(", ")]) },
    { name: "Long days", note, columns: ["Day", "Worker", "Times", "Worked"], rows: q.longDays.map((x) => [Number(x.sheet), x.name, formatShift(x.shift[0], x.shift[1]), r(x.worked)]) },
  ];
}
