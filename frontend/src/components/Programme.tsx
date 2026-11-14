// The as-built programme: drawn from the daily sheets with no new data (roadmap #2).
// A bar per activity from its first to last day, shaded by the crew each day; the manpower
// histogram by trade against the PM's planned line; cumulative hours (S-curves); and a flowline
// once the PM puts the places in order.
import { useContext, useMemo, useState, type ClipboardEvent } from "react";
import { api, type Master } from "../api";
import { ALL, flowline, NO_CODE, planned, programme, sCurves, weekOf, workPart, type DayRow, type Slice } from "../analysis";
import { CardHelp } from "./CardHelp";
import { store } from "../store";
import { COLORS, DayBars, DisruptedCtx, SaveImage, h } from "./charts";
import { date as fmtDate } from "../fmt";

type Desc = (code: string) => string | null;

interface Props {
  slices: Slice[];
  days: DayRow[];
  master: Master;
  trade?: string; // the trade filter, for the planned line
  desc: Desc;
  onPick: (code: string) => void;
  onSaved: () => void; // place order or plan saved: read the master again
}

/** One colour per activity (the work part of a code, e.g. 03-11-00-00), shared by the S-curves and
 * the flowline: the six with most hours get their own, the rest the grey of "Other". */
function activityColors(slices: Slice[]): (code: string) => string {
  const hours = new Map<string, number>();
  for (const s of slices) if (s.code !== NO_CODE) hours.set(workPart(s.code), (hours.get(workPart(s.code)) ?? 0) + s.hours);
  const rank = new Map([...hours].sort((a, b) => b[1] - a[1]).map(([k], i) => [k, i]));
  return (code: string) => { const i = rank.get(workPart(code)); return i !== undefined && i < 6 ? COLORS[i] : COLORS[6]; };
}

export function Programme({ slices, days, master, trade, desc, onPick, onSaved, compact = false }: Props & { compact?: boolean }) {
  // the Gantt and the manpower histogram lead; the S-curves and the flowline open on demand
  const [more, setMore] = useState(() => ({ s: store.get("labour.prog.scurves") === "1", f: store.get("labour.prog.flowline") === "1" }));
  const toggle = (k: "s" | "f") => setMore((m) => { const next = { ...m, [k]: !m[k] }; store.set(k === "s" ? "labour.prog.scurves" : "labour.prog.flowline", next[k] ? "1" : "0"); return next; });
  const colorOf = useMemo(() => activityColors(slices), [slices]);
  return (
    <>
      <p className="muted small prog-intro">Drawn straight from the daily sheets: nobody entered a programme. Every chart saves as a picture for the progress meeting.</p>
      <Gantt slices={slices} days={days} desc={desc} onPick={onPick} compact={compact} />
      <Histogram days={days} master={master} trade={trade} onSaved={onSaved} />
      <section className="prog-more">
        <div className="prog-more-head">
          <div>
            <h3>Deeper analysis</h3>
            <span className="muted small">Progress curves, and how the work moves through the places</span>
          </div>
          <span className="prog-toggles" role="group" aria-label="Deeper analysis charts">
            <button className={`toggle-btn${more.s ? " on" : ""}`} aria-pressed={more.s} onClick={() => toggle("s")}>{more.s ? "✓ " : "+ "}S-curves</button>
            <button className={`toggle-btn${more.f ? " on" : ""}`} aria-pressed={more.f} onClick={() => toggle("f")}>{more.f ? "✓ " : "+ "}Flowline</button>
          </span>
        </div>
        {more.s && <SCurves slices={slices} days={days} desc={desc} colorOf={colorOf} />}
        {more.f && <Flowline slices={slices} days={days} master={master} desc={desc} onSaved={onSaved} colorOf={colorOf} />}
      </section>
    </>
  );
}

// ------------------------------------------------------------------------------- Gantt

const shortDate = (iso: string | null | undefined) => (iso ? fmtDate(new Date(`${iso}T00:00:00`), { day: "numeric", month: "short" }) : "");

function Gantt({ slices, days, desc, onPick, compact }: { slices: Slice[]; days: DayRow[]; desc: Desc; onPick: (code: string) => void; compact: boolean }) {
  const [top, setTop] = useState(20);
  const all = useMemo(() => programme(slices), [slices]);
  const keep = new Set([...all].sort((a, b) => b.hours - a.hours).slice(0, top).map((b) => b.key));
  const bars = all.filter((b) => keep.has(b.key));
  if (!bars.length) return <div className="card"><h3>As-built programme</h3><p className="muted">No activity codes in these entries.</p></div>;
  const peak = Math.max(1, ...bars.map((b) => b.peak));
  const cw = 22, rh = compact ? 18 : 28, left = compact ? 170 : 300, right = 120, head = 34;
  const dateOf = new Map(days.map((d) => [d.day, d.date]));
  const width = left + days.length * cw + right;
  const height = head + bars.length * rh + 8;
  const col = new Map(days.map((d, i) => [d.day, i]));
  const x = (day: number) => left + (col.get(day) ?? 0) * cw;
  return (
    <div className="card">
      <div className="card-head">
        <h3>As-built programme</h3>
        <span className="row" style={{ marginTop: 0 }}>
          <label className="small">
            Show{" "}
            <select value={top} onChange={(e) => setTop(Number(e.target.value))}>
              {[10, 20, 40, 1000].map((n) => <option key={n} value={n}>{n === 1000 ? "all" : n}</option>)}
            </select>{" "}
            activities with most hours
          </label>
          <SaveImage name="As-built programme" />
        </span>
      </div>
      <CardHelp id="gantt">
        Each bar runs from the first to the last day the activity had hours; darker days had a bigger crew (up to {peak} people). Gaps are
        days without work on it. Hover a row for its dates and hours; click it to filter every view by that activity.
      </CardHelp>
      <div className="table-wrap">
        <svg className="chart-svg gantt" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="As-built programme">
          {days.map((d, i) => {
            const off = d.kind === "Sunday" || d.kind === "Holiday";
            return (
              <g key={d.sheet}>
                {off && <rect x={left + i * cw} y={head - 4} width={cw} height={height - head} fill="var(--sun-bg)" opacity="0.22" />}
                <text x={left + i * cw + cw / 2} y={head - 12} textAnchor="middle" fontSize="11" fill={off ? "var(--sun)" : d.kind === "Saturday" ? "var(--sat)" : "var(--muted)"}>
                  {d.day}
                </text>
              </g>
            );
          })}
          {bars.map((b, r) => {
            const y = head + r * rh;
            const d = desc(b.key);
            return (
              <g key={b.key} className="gantt-row" onClick={() => onPick(b.key)} style={{ cursor: "pointer" }} tabIndex={0} role="button"
                aria-label={`Filter by ${b.key}`} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(b.key); } }}>
                <title>{`${b.key}${d ? ` — ${d}` : ""}${b.place && b.place !== "No place" ? ` · ${b.place}` : ""}\n${shortDate(dateOf.get(b.first)) || `day ${b.first}`} – ${shortDate(dateOf.get(b.last)) || `day ${b.last}`} (days ${b.first}–${b.last}), ${b.activeDays} with work\n${h(b.hours)} h · peak ${b.peak} people\nClick to filter every view by this activity`}</title>
                {r % 2 === 1 && <rect x={0} y={y} width={width} height={rh} fill="var(--row)" opacity="0.45" />}
                <rect className="gantt-hover" x={0} y={y} width={width} height={rh} fill="var(--primary-bg)" opacity="0" />
                <line x1={0} x2={width} y1={y + rh} y2={y + rh} stroke="var(--line)" />
                <text x={6} y={compact ? y + 13 : y + 12} fontSize={compact ? 11 : 12} fontWeight="600" fill="var(--text)" fontFamily="ui-monospace, Consolas, monospace">{b.key}</text>
                {!compact && <text x={6} y={y + 24} fontSize="10.5" fill="var(--muted)">{(d ?? b.place).slice(0, 44)}{(d ?? b.place).length > 44 ? "…" : ""}</text>}
                <rect className="gantt-bar" x={x(b.first) + 1} y={y + 4} width={x(b.last) - x(b.first) + cw - 2} height={rh - 8} rx="3" fill="var(--row)" stroke="var(--line)" />
                {[...b.people].map(([day, n]) => (
                  <rect key={day} x={x(day) + 2} y={y + 5} width={cw - 4} height={rh - 10} rx="2" fill="var(--c1)" opacity={0.25 + 0.75 * (n / peak)}>
                    <title>{`${b.key}, day ${day}: ${n} people`}</title>
                  </rect>
                ))}
                <text x={left + days.length * cw + 52} y={y + rh / 2 + 4} fontSize="11.5" fontWeight="600" textAnchor="end" fill="var(--text)" style={{ fontVariantNumeric: "tabular-nums" }}>{h(b.hours)} h</text>
                <text x={left + days.length * cw + 60} y={y + rh / 2 + 4} fontSize="10" fill="var(--muted)" opacity="0.8">peak {b.peak}</text>
                <text className="gantt-pick" x={left - 8} y={compact ? y + 13 : y + 12} fontSize="10" textAnchor="end" fill="var(--primary)" opacity="0">filter ⏵</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- manpower histogram

function Histogram({ days, master, trade, onSaved }: { days: DayRow[]; master: Master; trade?: string; onSaved: () => void }) {
  const disrupted = useContext(DisruptedCtx);
  const plan = master.plan ?? {};
  const sums = new Map<string, number>();
  for (const d of days) for (const [t, c] of d.byTrade) sums.set(t, (sums.get(t) ?? 0) + c);
  const order = [...sums].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const top = order.slice(0, 6), rest = new Set(order.slice(6));
  const series = [
    ...top.map((t, i) => ({ key: t, label: t, color: COLORS[i] })),
    ...(rest.size ? [{ key: "__other", label: "Other trades", color: COLORS[6] }] : []),
  ];
  const value = (d: DayRow, key: string) =>
    key === "__other" ? [...d.byTrade].filter(([t]) => rest.has(t)).reduce((s, [, c]) => s + c, 0) : d.byTrade.get(key) ?? 0;
  const hasPlan = Object.keys(plan).length > 0 && (!trade || plan[trade]);
  return (
    <div className="card">
      <div className="card-head">
        <h3>Manpower histogram by trade</h3>
        <SaveImage name="Manpower histogram" />
      </div>
      <p className="muted small chart-sub">
        People on site each day, stacked by trade.
        {hasPlan ? ` The dashed line is the planned headcount${trade ? ` for ${trade}` : ""} from the look-ahead.` : " Add the planned headcount below to draw the plan line."}
      </p>
      <DayBars
        days={days}
        series={series}
        value={value}
        unit="people"
        disrupted={disrupted}
        line={hasPlan ? { label: `Planned${trade ? ` (${trade})` : ""}`, color: "var(--text)", value: (d) => (d.headcount || d.kind !== "Sunday" ? planned(plan, d.date, trade) : undefined) } : undefined}
      />
      <PlanEditor days={days} trades={order} plan={plan} onSaved={onSaved} />
    </div>
  );
}

/** The PM's look-ahead: planned people a day per trade per week; type or paste from Excel. */
function PlanEditor({ days, trades, plan, onSaved }: { days: DayRow[]; trades: string[]; plan: Record<string, Record<string, number>>; onSaved: () => void }) {
  const weeks = [...new Set(days.filter((d) => d.date).map((d) => weekOf(d.date!)))].sort();
  const rows = [...new Set([...trades, ...Object.keys(plan)])];
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(rows.map((t) => [t, Object.fromEntries(weeks.map((w) => [w, plan[t]?.[w] !== undefined ? String(plan[t][w]) : ""]))])),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (t: string, w: string, v: string) => setGrid((g) => ({ ...g, [t]: { ...(g[t] ?? {}), [w]: v } }));
  const paste = (e: ClipboardEvent<HTMLInputElement>, r0: number, c0: number) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text)) return; // one value: the box takes it as usual
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
    setGrid((g) => {
      const next = { ...g };
      lines.forEach((line, i) => {
        let cells = line.split("\t");
        let t = rows[r0 + i];
        const named = rows.find((x) => x.toLowerCase() === cells[0].trim().toLowerCase());
        if (named || Number.isNaN(Number(cells[0]))) {
          t = named ?? t; // a row that starts with the trade's name goes to that trade
          cells = cells.slice(1);
        }
        if (!t) return;
        const row = { ...(next[t] ?? {}) };
        cells.forEach((c, j) => {
          const w = weeks[(named ? 0 : c0) + j];
          if (w) row[w] = c.trim();
        });
        next[t] = row;
      });
      return next;
    });
  };
  const save = async () => {
    const out: Record<string, Record<string, number>> = {};
    for (const [t, ws] of Object.entries(grid))
      for (const [w, v] of Object.entries(ws)) {
        const n = Number(v);
        if (v.trim() && Number.isFinite(n) && n > 0) (out[t] ??= {})[w] = n;
      }
    setBusy(true);
    try {
      await api.savePlan(out);
      setMsg("Saved. The plan line is drawn from it.");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const label = (w: string) => `w/c ${fmtDate(new Date(`${w}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" })}`;
  return (
    <details className="howto plan-editor">
      <summary>Planned headcount (from the PM's look-ahead)</summary>
      <p className="muted small">
        People a day per trade, for each week (week commencing Monday). Type them, or copy a block from the look-ahead in Excel
        and paste it into the first box: rows that start with a trade name go to that trade.
      </p>
      <div className="table-wrap">
        <table className="data plan-grid">
          <thead>
            <tr>
              <th>Trade</th>
              {weeks.map((w) => <th key={w} className="num">{label(w)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, r) => (
              <tr key={t}>
                <th>{t}</th>
                {weeks.map((w, c) => (
                  <td key={w}>
                    <input
                      aria-label={`Planned ${t}, ${label(w)}`}
                      inputMode="decimal"
                      value={grid[t]?.[w] ?? ""}
                      onChange={(e) => set(t, w, e.target.value)}
                      onPaste={(e) => paste(e, r, c)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button className="primary" disabled={busy} onClick={save}>Save planned headcount</button>
        {msg && <span className="small ok-text">{msg}</span>}
      </div>
    </details>
  );
}

// ------------------------------------------------------------------------------ S-curves

function SCurves({ slices, days, desc, colorOf }: { slices: Slice[]; days: DayRow[]; desc: Desc; colorOf: (code: string) => string }) {
  const [by, setBy] = useState<"code" | "place">("code");
  const [pctMode, setPct] = useState(false);
  const curves = useMemo(() => sCurves(slices, by === "code" ? (s) => s.code : (s) => s.place, days.map((d) => d.day)), [slices, days, by]);
  if (!curves.length) return null;
  const left = 54, bottom = 30, top = 12, height = 260, cw = 22;
  const width = left + Math.max(days.length, 1) * cw + 12;
  const max = pctMode ? 1 : Math.max(1, ...curves.map((c) => c.total));
  const y = (v: number) => height - bottom - (v / max) * (height - bottom - top);
  const xs = (i: number) => left + i * cw + cw / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const label = (k: string) => (k === ALL ? ALL : by === "code" && desc(k) ? `${k} · ${desc(k)}` : k);
  // by activity: the activity's own colour (as on the flowline); a second code of the same activity
  // (another place) is dashed. By place: the places in order of hours.
  const style = curves.map((c, i) => {
    if (i === 0) return { color: "var(--text)", dash: undefined as string | undefined };
    if (by === "place") return { color: COLORS[(i - 1) % COLORS.length], dash: undefined };
    const color = colorOf(c.key);
    const before = curves.slice(1, i).some((o) => colorOf(o.key) === color);
    return { color, dash: before ? "6 4" : undefined };
  });
  return (
    <div className="card">
      <div className="card-head">
        <h3>Cumulative labour hours (S-curves)</h3>
        <span className="row" style={{ marginTop: 0 }}>
          <span className="seg">
            <button className={by === "code" ? "active" : ""} onClick={() => setBy("code")}>By activity</button>
            <button className={by === "place" ? "active" : ""} onClick={() => setBy("place")}>By place</button>
          </span>
          <span className="seg">
            <button className={!pctMode ? "active" : ""} onClick={() => setPct(false)}>Hours</button>
            <button className={pctMode ? "active" : ""} onClick={() => setPct(true)}>% of its total</button>
          </span>
          <SaveImage name={`S-curves by ${by === "code" ? "activity" : "place"}`} />
        </span>
      </div>
      <CardHelp id="scurves">
        Hours worked so far, day by day: all work (the thick light line) and the {curves.length - 1} {by === "code" ? "activities" : "places"} with most
        hours. A steep stretch is fast progress of labour; a flat one is a pause. By activity, each activity keeps its colour from the flowline;
        the same activity at a second place is dashed.
      </CardHelp>
      <div className="chart">
        <div className="legend">
          {curves.map((c, i) => (
            <span key={c.key} className={i === 0 ? "legend-all" : undefined}>
              {style[i].dash ? <i className="line" style={{ borderColor: style[i].color }} /> : <i style={{ background: style[i].color }} />}
              {label(c.key)} · {h(c.total)} h
            </span>
          ))}
        </div>
        <div className="table-wrap">
          <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Cumulative labour hours">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={width - 4} y1={y(t)} y2={y(t)} stroke="var(--line)" />
                <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{pctMode ? `${Math.round(t * 100)}%` : Math.round(t)}</text>
              </g>
            ))}
            {days.map((d, i) => (
              <text key={d.sheet} x={xs(i)} y={height - bottom + 15} textAnchor="middle" fontSize="11" fill={d.kind === "Sunday" || d.kind === "Holiday" ? "var(--sun)" : "var(--muted)"}>{d.day}</text>
            ))}
            {[...curves].reverse().map((c) => {
              const i = curves.indexOf(c);
              const { color, dash } = style[i];
              const pts = c.points.map((p, j) => `${xs(j)},${y(pctMode ? (c.total ? p.cum / c.total : 0) : p.cum)}`).join(" ");
              return (
                <polyline key={c.key} points={pts} fill="none" stroke={color} strokeWidth={i === 0 ? 3.5 : 2} strokeDasharray={dash} strokeLinejoin="round" opacity={i === 0 ? 0.9 : 1}>
                  <title>{`${label(c.key)}: ${h(c.total)} h`}</title>
                </polyline>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ flowline

function Flowline({ slices, days, master, desc, onSaved, colorOf }: { slices: Slice[]; days: DayRow[]; master: Master; desc: Desc; onSaved: () => void; colorOf: (code: string) => string }) {
  const [shown, setShown] = useState(5); // activities drawn: the ones with most hours
  const [hot, setHot] = useState<string | null>(null); // one activity picked out (hover or click on the legend)
  const [pinned, setPinned] = useState<string | null>(null);
  const focus = pinned ?? hot;
  const saved = master.place_order ?? [];
  const flow = useMemo(() => flowline(slices, saved), [slices, saved]);
  const [order, setOrder] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const levels = order ?? flow.levels;
  const name = (suffix: string) => master.places?.[suffix] || `-${suffix}`;
  const move = (i: number, by: number) => {
    const next = [...levels];
    const [x] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, x);
    setOrder(next);
    setMsg(null);
  };
  const save = async () => {
    try {
      await api.savePlaceOrder(levels);
      setOrder(null);
      setMsg("Saved for this project.");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const acts = flow.activities.slice(0, shown);
  // the work part's description: from any of its codes (the place does not change what it is)
  const actDesc = (a: string) => desc(a) ?? flow.segments.filter((x) => x.activity === a).map((x) => desc(`${a}-${x.suffix}`)).find(Boolean) ?? null;
  const cw = 22, left = 150, bottom = 30, top = 10, lh = Math.max(34, Math.min(60, 240 / Math.max(levels.length, 1)));
  const height = top + levels.length * lh + bottom;
  const width = left + days.length * cw + 12;
  const col = new Map(days.map((d, i) => [d.day, i]));
  const xAt = (day: number, end = false) => left + ((col.get(day) ?? 0) + (end ? 1 : 0)) * cw;
  const yAt = (level: number, upper = false) => top + (levels.length - level - (upper ? 1 : 0)) * lh;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Flowline (activities through the places)</h3>
        <span className="row" style={{ marginTop: 0 }}>
          <label className="small">
            Show{" "}
            <select value={shown} onChange={(e) => setShown(Number(e.target.value))}>
              {[3, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>{" "}
            activities
          </label>
          {levels.length > 1 && <SaveImage name="Flowline" />}
        </span>
      </div>
      <CardHelp id="flowline">
        Time across, places up the side in the order the work moves through them. Each activity is a line climbing from place to place;
        its slope is the speed of work, and lines that cross or touch mean two activities in one place at once. Hover an activity (here or
        in the legend) to pick it out; click it in the legend to keep it picked out. Thicker lines are the activities with most hours.
      </CardHelp>
      {levels.length < 2 ? (
        <p className="muted">The codes in these entries use fewer than two places, so there is no flowline to draw.</p>
      ) : (
        <div className="flow-wrap">
          <div className="flow-order">
            <b className="small">Place order</b>
            <span className="muted small">bottom to top, as the work moves</span>
            <ol>
              {[...levels].map((s, i) => (
                <li key={s}>
                  <span>{name(s)}</span>
                  <button className="link small" aria-label={`Move ${name(s)} down`} disabled={i === 0} onClick={() => move(i, -1)}>▼</button>
                  <button className="link small" aria-label={`Move ${name(s)} up`} disabled={i === levels.length - 1} onClick={() => move(i, 1)}>▲</button>
                </li>
              ))}
            </ol>
            <button className="small" disabled={!order} onClick={save}>Save order</button>
            {msg && <div className="small ok-text">{msg}</div>}
          </div>
          <div className="chart" style={{ minWidth: 0, flex: 1 }}>
            <div className="legend">
              {acts.map((a) => (
                <button
                  key={a}
                  className={`legend-btn${focus === a ? " on" : ""}${focus && focus !== a ? " dim" : ""}`}
                  aria-pressed={pinned === a}
                  onMouseEnter={() => setHot(a)}
                  onMouseLeave={() => setHot(null)}
                  onClick={() => setPinned((p) => (p === a ? null : a))}
                >
                  <i style={{ background: colorOf(a) }} />
                  {a}
                  {actDesc(a) ? ` · ${actDesc(a)}` : ""}
                </button>
              ))}
            </div>
            <div className="table-wrap">
              <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Flowline">
                {levels.map((s, i) => (
                  <g key={s}>
                    {/* a band per place, so the eye reads which floor or zone a line is on */}
                    {i % 2 === 0 && <rect x={0} y={yAt(i, true)} width={width} height={lh} fill="var(--row)" opacity="0.6" />}
                    <line x1={left} x2={width - 4} y1={yAt(i)} y2={yAt(i)} stroke="var(--line)" />
                    <text x={left - 10} y={yAt(i) - lh / 2 + 4} textAnchor="end" fontSize="12" fontWeight="600" fill="var(--text)">{name(s).slice(0, 22)}</text>
                  </g>
                ))}
                <line x1={left} x2={width - 4} y1={yAt(levels.length - 1, true)} y2={yAt(levels.length - 1, true)} stroke="var(--line)" />
                {days.map((d, i) => (
                  <text key={d.sheet} x={left + i * cw + cw / 2} y={height - bottom + 15} textAnchor="middle" fontSize="11" fill={d.kind === "Sunday" || d.kind === "Holiday" ? "var(--sun)" : "var(--muted)"}>{d.day}</text>
                ))}
                {acts.map((a, k) => {
                  const segs = flow.segments.filter((s) => s.activity === a && levels.includes(s.suffix)).sort((p, q) => levels.indexOf(p.suffix) - levels.indexOf(q.suffix));
                  const color = colorOf(a);
                  const weight = k < 2 ? 5 : k < 4 ? 4 : 3; // the activities with most hours drawn heavier
                  const fade = focus && focus !== a ? 0.12 : 1;
                  const pts = segs.flatMap((s) => {
                    const l = levels.indexOf(s.suffix);
                    return [`${xAt(s.first)},${yAt(l) - 3}`, `${xAt(s.last, true)},${yAt(l, true) + 3}`];
                  });
                  return (
                    <g key={a} opacity={fade} onMouseEnter={() => setHot(a)} onMouseLeave={() => setHot(null)} style={{ cursor: "pointer" }}>
                      {segs.length > 1 && <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={focus === a ? 2 : 1.2} strokeDasharray="3 3" opacity="0.7" />}
                      {segs.map((s) => {
                        const l = levels.indexOf(s.suffix);
                        return (
                          <line key={s.suffix} x1={xAt(s.first)} y1={yAt(l) - 3} x2={xAt(s.last, true)} y2={yAt(l, true) + 3} stroke={color} strokeWidth={focus === a ? weight + 1.5 : weight} strokeLinecap="round">
                            <title>{`${a} at ${name(s.suffix)}: days ${s.first}–${s.last}, ${h(s.hours)} h`}</title>
                          </line>
                        );
                      })}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
