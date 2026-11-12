// Fatigue and OT risk (roadmap #7): per person, the worst 7 days (hours and overtime), days in a
// row, short rests between shifts and Sundays/holidays worked, against limits that are settings
// (to be confirmed with HR: the building trade's Wages Board decision or company policy); the
// site's trend; and overtime against output where quantities exist (roadmap #6).
import { useMemo, useState } from "react";
import { api, type Master } from "../api";
import { DEFAULT_LIMITS, fatigue, otAndOutput, overLimitByDay, productivity, type Data, type DayRow, type EntryRow, type Limits, type Norm } from "../analysis";
import { COLORS, DayBars, h } from "./charts";

export function Fatigue({ data, entries, days, master, disrupted, onSaved }: {
  data: Data;
  entries: EntryRow[];
  days: DayRow[];
  master: Master;
  disrupted: Set<number>;
  onSaved: () => void;
}) {
  const limits: Limits = { ...DEFAULT_LIMITS, ...(master.limits ?? {}) };
  const rows = useMemo(() => fatigue(data, entries, limits), [data, entries, limits.week_hours, limits.week_ot, limits.days_in_row, limits.rest_hours]); // eslint-disable-line react-hooks/exhaustive-deps
  const trend = useMemo(() => overLimitByDay(data, entries, limits), [data, entries, limits.week_hours]); // eslint-disable-line react-hooks/exhaustive-deps
  const prod = useMemo(() => productivity(data, master.quantities ?? {}, master.units ?? {}, (master.norms ?? {}) as Record<string, Norm>, disrupted), [data, master, disrupted]);
  const link = useMemo(() => otAndOutput(data, prod), [data, prod]);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const count = (f: string) => rows.filter((r) => r.flags.includes(f)).length;
  const shown = rows.filter((r) => (all || r.flags.length) && (!query || `${r.name} ${r.trade}`.toLowerCase().includes(query.toLowerCase())));
  return (
    <>
      <p className="muted small">
        Limits: {limits.week_hours} h worked or {limits.week_ot} h overtime in any 7 days, {limits.days_in_row} days in a row, {limits.rest_hours} h rest between
        shifts. These are settings, not the law: confirm them with HR (the building trade's Wages Board decision or company policy).{" "}
        <button className="link small" onClick={() => setEditing((e) => !e)}>Change limits…</button>
      </p>
      {editing && <LimitsEditor limits={limits} onSaved={() => { setEditing(false); onSaved(); }} />}
      <div className="kpis">
        <Tile n={count("7-day hours")} label={`over ${limits.week_hours} h in 7 days`} />
        <Tile n={count("7-day OT")} label={`over ${limits.week_ot} h OT in 7 days`} />
        <Tile n={count("days in a row")} label={`over ${limits.days_in_row} days in a row`} />
        <Tile n={count("short rest")} label={`with under ${limits.rest_hours} h rest`} />
        <Tile n={rows.reduce((s, r) => s + r.sundays, 0)} label="Sunday and holiday worker-days" />
      </div>
      <div className="card">
        <h3>People over the 7-day hours limit, by day</h3>
        <DayBars days={days} series={[{ key: "n", label: "People", color: COLORS[5] }]} value={(d) => trend.get(d.day) ?? 0} unit="people" />
      </div>
      <div className="card fatigue-evidence">
        <h3>Why it matters for output</h3>
        <p className="small">
          In the Construction Industry Institute's study of scheduled overtime (SD-98), five- and six-day weeks of 50–60 hours lost about
          12–14% of labour efficiency once they ran for several weeks. Long weeks are a productivity risk, not only a compliance one.
        </p>
        {link ? (
          <p className="small">
            <b>On this site</b> ({link.weeks} measured code-weeks): weeks with more overtime (over {Math.round(link.split * 100)}% of hours) had a productivity
            index of <b>{link.highOt.toFixed(2)}</b>, the others <b>{link.lowOt.toFixed(2)}</b>.
          </p>
        ) : (
          <p className="muted small">Add weekly quantities on Productivity to compare this site's long-overtime weeks with its output.</p>
        )}
      </div>
      <div className="card">
        <div className="card-head">
          <h3>By person{all ? "" : " (over a limit)"}</h3>
          <span className="row" style={{ marginTop: 0 }}>
            <input aria-label="Search people" placeholder="Search a worker or trade…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="check small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> everyone</label>
          </span>
        </div>
        {shown.length ? (
          <div className="table-wrap" style={{ maxHeight: 520 }}>
            <table className="data fatigue-table">
              <thead>
                <tr>
                  <th>Worker</th><th>Trade</th><th className="num">Days</th>
                  <th className="num">Most h in 7 days</th><th className="num">Most OT in 7 days</th>
                  <th className="num">Days in a row</th><th className="num">Short rests</th><th className="num">Sun / hol</th><th>Over</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 200).map((r) => (
                  <tr key={r.person}>
                    <td>{r.name}</td><td>{r.trade}</td><td className="num">{r.days}</td>
                    <td className={`num${r.maxWeek > limits.week_hours ? " warn-text" : ""}`}>{h(r.maxWeek)}</td>
                    <td className={`num${r.maxWeekOt > limits.week_ot ? " warn-text" : ""}`}>{h(r.maxWeekOt)}</td>
                    <td className={`num${r.longestRun > limits.days_in_row ? " warn-text" : ""}`}>{r.longestRun}</td>
                    <td className={`num${r.shortRests ? " warn-text" : ""}`} title={r.minRest === null ? undefined : `shortest rest ${h(r.minRest)} h`}>{r.shortRests || ""}</td>
                    <td className="num">{r.sundays || ""}</td>
                    <td>{r.flags.map((f) => <span key={f} className="badge warn small">{f}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">{rows.length ? "Nobody is over a limit." : "No entries yet."}</p>
        )}
      </div>
    </>
  );
}

function Tile({ n, label }: { n: number; label: string }) {
  return (
    <div className={`kpi${n ? " kpi-warn" : ""}`}>
      <div className="kpi-value">{n}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function LimitsEditor({ limits, onSaved }: { limits: Limits; onSaved: () => void }) {
  const [v, setV] = useState({ week_hours: String(limits.week_hours), week_ot: String(limits.week_ot), days_in_row: String(limits.days_in_row), rest_hours: String(limits.rest_hours) });
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.saveLimits({ week_hours: Number(v.week_hours), week_ot: Number(v.week_ot), days_in_row: Math.round(Number(v.days_in_row)), rest_hours: Number(v.rest_hours) });
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const field = (k: keyof typeof v, label: string, unit: string) => (
    <label className="rates-row" key={k}>
      <span>{label}</span>
      <input aria-label={label} inputMode="decimal" value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />
      <span className="muted small">{unit}</span>
    </label>
  );
  return (
    <div className="card limits-card">
      <h3>Fatigue and overtime limits</h3>
      <div className="rates-mult" style={{ maxWidth: 460 }}>
        {field("week_hours", "Worked hours in any 7 days", "h")}
        {field("week_ot", "Overtime hours in any 7 days", "h")}
        {field("days_in_row", "Days in a row without a day off", "days")}
        {field("rest_hours", "Rest between shifts at least", "h")}
      </div>
      <div className="actions">
        <button className="primary" onClick={save}>Save limits</button>
        {msg && <span className="error-text small">{msg}</span>}
      </div>
    </div>
  );
}
