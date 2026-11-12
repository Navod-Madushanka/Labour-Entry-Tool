// Month history (roadmap #9): months kept in history.db on this PC (read from the saved .xlsb
// with pyxlsb, so Excel is not used). Trends month by month, the site's own productivity norms
// from past quantities, and runs that carry across the month end (used by Fatigue & OT risk).
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type HistoryQuantity, type HistoryRow, type Master, type MonthInfo } from "../api";
import { historyNorms, monthTrends, NO_CODE } from "../analysis";
import { COLORS, h } from "./charts";

type Desc = (code: string) => string | null;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });

export function History({ master, desc, onSaved }: { master: Master; desc: Desc; onSaved: () => void }) {
  const [months, setMonths] = useState<MonthInfo[] | null>(null);
  const [data, setData] = useState<{ rows: HistoryRow[]; quantities: HistoryQuantity[] }>({ rows: [], quantities: [] });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<string>("");
  const file = useRef<HTMLInputElement>(null);

  const load = async () => {
    const ms = await api.historyMonths();
    const rows = ms.length ? await api.historyRows(ms.map((m) => m.id)) : { rows: [], quantities: [] };
    setMonths(ms); // both together: a month listed before its rows would read 0 hours
    setData(rows);
  };
  useEffect(() => {
    load().catch((e) => setMsg(String(e.message ?? e)));
  }, []);

  const kinds = [...new Set((months ?? []).map((m) => m.kind))];
  const kind = (months ?? []).find((m) => m.source === master.workbook)?.kind; // this workbook's kind
  const pick = show || (kind && kinds.includes(kind) ? kind : kinds[0] ?? "");
  const mine = (months ?? []).filter((m) => m.kind === pick);
  const trends = useMemo(() => monthTrends(mine, data.rows), [mine, data.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const norms = useMemo(() => historyNorms(data.rows.filter((r) => mine.some((m) => m.id === r.month_id)), data.quantities), [data, mine]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      const done = await fn();
      await load();
      setMsg(done);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const setNorm = (code: string, hours: number) =>
    act(async () => {
      await api.saveQuantities({ quantities: master.quantities ?? {}, units: master.units ?? {}, norms: { ...(master.norms ?? {}), [code]: { hours: Math.round(hours * 1000) / 1000, source: "Site history" } } });
      onSaved();
      return `${code}: norm set to ${hours.toFixed(2)} h per unit (site history).`;
    });

  const trades = [...new Set(trends.flatMap((t) => [...t.trades.keys()]))].sort();
  const codeTotals = new Map<string, number>();
  for (const t of trends) for (const [c, v] of t.codes) if (c !== NO_CODE) codeTotals.set(c, (codeTotals.get(c) ?? 0) + v);
  const topCodes = [...codeTotals].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c);
  const rows: [string, (t: (typeof trends)[number]) => string][] = [
    ["Hours worked", (t) => h(t.hours)],
    ["Overtime hours", (t) => h(t.ot)],
    ["OT share", (t) => pct(t.otShare)],
    ["Worker-days", (t) => h(t.workerDays)],
    ["People", (t) => String(t.people)],
    ["Headcount a day (average)", (t) => h(t.avgHeadcount)],
    ["Peak headcount", (t) => String(t.peak)],
    ["Unallocated hours (ZIDLE)", (t) => `${h(t.idle)} (${pct(t.idleShare)})`],
  ];
  return (
    <>
      <div className="card history-card">
        <div className="card-head">
          <h3>Months kept on this PC</h3>
          <span className="row" style={{ marginTop: 0 }}>
            <button className="primary" disabled={busy} onClick={() => act(async () => { const r = await api.saveHistory(); return `Saved ${monthLabel(r.month.month)} (${r.month.entries} worker-days).${r.note ? ` ${r.note}` : ""}`; })}>
              Save this month to history
            </button>
            <button disabled={busy} onClick={() => file.current?.click()}>Add a past month (.xlsb)…</button>
            <input ref={file} type="file" accept=".xlsb" hidden aria-label="Past month workbook" onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) act(async () => { const r = await api.importHistory(f); return `Added ${monthLabel(r.month.month)} from ${f.name} (${r.month.entries} worker-days).`; });
            }} />
          </span>
        </div>
        <p className="muted small">
          Each month's entries (calling names, times, hours, codes; no names or ID numbers) kept in <code>history.db</code> in the tool's data folder.
          A month is read from the saved workbook file, so save it in Excel first; saving a month again replaces it. Excel is not changed.
        </p>
        {msg && <p className="small ok-text">{msg}</p>}
        {months && months.length > 0 ? (
          <table className="data">
            <thead><tr><th>Month</th><th>Workbook kind</th><th className="num">Worker-days</th><th className="num">People</th><th className="num">Hours</th><th>From</th><th>Saved</th><th /></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.id}>
                  <td><b>{monthLabel(m.month)}</b></td><td>{m.kind}</td><td className="num">{m.entries}</td><td className="num">{m.workers}</td><td className="num">{h(m.hours)}</td>
                  <td className="small">{m.source}</td><td className="small muted">{new Date(m.saved_at).toLocaleString()}</td>
                  <td><button className="link small danger" disabled={busy} onClick={() => window.confirm(`Take ${monthLabel(m.month)} (${m.kind}) out of the history?`) && act(async () => { await api.deleteHistory(m.id); return "Taken out."; })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : months ? (
          <p className="muted">No months yet. Save this month, and add last months' workbooks to see trends.</p>
        ) : (
          <p className="muted small">Loading…</p>
        )}
      </div>

      {trends.length > 0 && (
        <>
          {kinds.length > 1 && (
            <label className="small">
              Workbook kind{" "}
              <select value={pick} onChange={(e) => setShow(e.target.value)}>{kinds.map((k) => <option key={k}>{k}</option>)}</select>
            </label>
          )}
          <div className="card">
            <h3>Month by month</h3>
            <MonthBars trends={trends} />
            <div className="table-wrap">
              <table className="data compare">
                <thead><tr><th />{trends.map((t) => <th key={t.id} className="num">{monthLabel(t.month)}</th>)}</tr></thead>
                <tbody>
                  {rows.map(([label, get]) => <tr key={label}><th>{label}</th>{trends.map((t) => <td key={t.id} className="num">{get(t)}</td>)}</tr>)}
                  <tr className="group-row"><th colSpan={trends.length + 1}>Hours by trade</th></tr>
                  {trades.map((tr) => <tr key={tr}><th>{tr}</th>{trends.map((t) => <td key={t.id} className="num">{t.trades.get(tr) ? h(t.trades.get(tr)!) : "—"}</td>)}</tr>)}
                  <tr className="group-row"><th colSpan={trends.length + 1}>Hours by activity (12 largest)</th></tr>
                  {topCodes.map((c) => <tr key={c}><th>{c}{desc(c) && <span className="muted small"> · {desc(c)}</span>}</th>{trends.map((t) => <td key={t.id} className="num">{t.codes.get(c) ? h(t.codes.get(c)!) : "—"}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <h3>The site's own productivity norms</h3>
            {norms.length ? (
              <table className="data">
                <thead><tr><th>Activity</th><th>Unit</th><th className="num">Weeks measured</th><th className="num">Hours per unit (median)</th><th className="num">Range</th><th>Norm now</th><th /></tr></thead>
                <tbody>
                  {norms.map((n) => {
                    const now = master.norms?.[n.code];
                    return (
                      <tr key={n.code}>
                        <td><span className="mono">{n.code}</span>{desc(n.code) && <div className="muted small">{desc(n.code)}</div>}</td>
                        <td>{n.unit ?? "—"}</td><td className="num">{n.weeks}</td><td className="num"><b>{n.median.toFixed(2)}</b></td>
                        <td className="num muted">{Math.min(...n.values).toFixed(2)}–{Math.max(...n.values).toFixed(2)}</td>
                        <td>{now ? `${now.hours} (${now.source})` : "—"}</td>
                        <td><button className="small" disabled={busy || n.weeks < 2} title={n.weeks < 2 ? "Needs two measured weeks" : undefined} onClick={() => setNorm(n.code, n.median)}>Use as norm</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="muted small">No stored month has quantities yet. Months saved after quantities are entered on Productivity keep them.</p>
            )}
            <p className="muted small">After two or three months the site's own median is a fairer norm than the BSR: the same crews, the same site.</p>
          </div>
        </>
      )}
    </>
  );
}

/** Hours per month (bars) with the average headcount (line). */
function MonthBars({ trends }: { trends: ReturnType<typeof monthTrends> }) {
  const w = 70, gap = 18, left = 50, height = 190, bottom = 26, top = 12;
  const width = left + trends.length * (w + gap) + 50;
  const maxH = Math.max(1, ...trends.map((t) => t.hours)), maxP = Math.max(1, ...trends.map((t) => t.avgHeadcount));
  const y = (v: number, max: number) => height - bottom - (v / max) * (height - bottom - top);
  const pts = trends.map((t, i) => `${left + i * (w + gap) + w / 2},${y(t.avgHeadcount, maxP)}`).join(" ");
  return (
    <div className="chart">
      <div className="legend"><span><i style={{ background: COLORS[0] }} />Hours worked</span><span><i style={{ background: COLORS[1] }} />Headcount a day (average)</span></div>
      <div className="table-wrap">
        <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Hours and headcount by month">
          {trends.map((t, i) => {
            const x = left + i * (w + gap);
            return (
              <g key={t.id}>
                <rect x={x} y={y(t.hours, maxH)} width={w} height={height - bottom - y(t.hours, maxH)} fill={COLORS[0]} opacity="0.85"><title>{`${monthLabel(t.month)}: ${h(t.hours)} h`}</title></rect>
                <text x={x + w / 2} y={y(t.hours, maxH) - 4} textAnchor="middle" fontSize="10.5" fill="var(--muted)">{h(t.hours)}</text>
                <text x={x + w / 2} y={height - bottom + 15} textAnchor="middle" fontSize="11" fill="var(--text)">{monthLabel(t.month)}</text>
              </g>
            );
          })}
          <polyline points={pts} fill="none" stroke={COLORS[1]} strokeWidth="2.5" />
          {trends.map((t, i) => <circle key={t.id} cx={left + i * (w + gap) + w / 2} cy={y(t.avgHeadcount, maxP)} r="3.5" fill={COLORS[1]}><title>{`${h(t.avgHeadcount)} a day`}</title></circle>)}
        </svg>
      </div>
    </div>
  );
}
