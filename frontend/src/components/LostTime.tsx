// Lost time (roadmap #5): unallocated hours by the reason given for each supervisor sheet, by the
// party responsible, and disrupted days against clean ones. Reasons and day tags are given at push
// and can be added or changed here. The foreman-delay survey, built into a step the clerk does.
import { useMemo, useState } from "react";
import { api, type Cause, type Lost } from "../api";
import { lostTime, NO_CODE, NO_REASON, NO_SUPERVISOR, type Data, type Slice } from "../analysis";
import { h } from "./charts";

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function LostTime({ data, slices, items, causes, user, onSaved }: {
  data: Data;
  slices: Slice[];
  items: Lost[];
  causes: Cause[];
  user: string;
  onSaved: (items: Lost[]) => void;
}) {
  const s = useMemo(() => lostTime(data, slices, items, causes), [data, slices, items, causes]);
  const label = new Map(causes.map((c) => [c.id, c.label]));
  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <div className="kpi-value">{h(s.unallocated)}</div>
          <div className="kpi-label">unallocated hours (ZIDLE)</div>
          <div className="kpi-def">Worked hours not booked to an activity code.</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{s.unallocated ? pct(s.explained / s.unallocated) : "—"}</div>
          <div className="kpi-label">with a reason</div>
          <div className="kpi-def">On supervisor sheets whose lost time was explained at push or here.</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{s.disrupted.length}</div>
          <div className="kpi-label">disrupted days</div>
          <div className="kpi-def">Days tagged with rain, a power cut, waiting for concrete…</div>
        </div>
      </div>
      <div className="two-col">
        <div className="card">
          <h3>Unallocated hours by cause</h3>
          {s.byCause.length ? (
            <table className="data">
              <thead><tr><th>Cause</th><th>Responsible</th><th className="num">Hours</th><th className="num">Sheets</th></tr></thead>
              <tbody>
                {s.byCause.map((c) => (
                  <tr key={c.cause} className={c.cause === NO_REASON ? "muted" : undefined}>
                    <td>{c.label}</td><td>{c.cause === NO_REASON ? "—" : c.party}</td><td className="num">{h(c.hours)}</td><td className="num">{c.sheets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted small">No unallocated hours.</p>}
          <p className="muted small">A sheet given two causes shares its hours between them.</p>
        </div>
        <div className="card">
          <h3>By who is responsible</h3>
          {s.byParty.length ? (
            <table className="data">
              <thead><tr><th>Party</th><th className="num">Hours</th></tr></thead>
              <tbody>{s.byParty.map((p) => <tr key={p.party}><td>{p.party}</td><td className="num">{h(p.hours)}</td></tr>)}</tbody>
            </table>
          ) : <p className="muted small">Nothing yet.</p>}
          <p className="muted small">Hours lost to the client or consultant (drawings, instructions) are the ones a claim rests on; keep the notes specific.</p>
        </div>
      </div>
      <div className="card">
        <h3>Disrupted days compared with clean days</h3>
        {s.compare.length ? (
          <>
            <table className="data">
              <thead><tr><th /><th className="num">Days</th><th className="num">Headcount a day</th><th className="num">Hours per person-day</th><th className="num">Unallocated</th><th className="num">OT share</th></tr></thead>
              <tbody>
                {s.compare.map((r) => (
                  <tr key={r.label}><th>{r.label}</th><td className="num">{r.days}</td><td className="num">{h(r.headcount)}</td><td className="num">{h(r.hoursPerPerson)}</td><td className="num">{pct(r.idleShare)}</td><td className="num">{pct(r.otShare)}</td></tr>
                ))}
              </tbody>
            </table>
            <ul className="small disrupted-list">
              {s.disrupted.map((d) => (
                <li key={d.sheet}><b>Day {d.day}</b>: {d.causes.map((c) => label.get(c) ?? c).join(", ")}{d.note ? ` — ${d.note}` : ""}</li>
              ))}
            </ul>
            <p className="muted small">With quantities (roadmap #6), output on disrupted and clean days is the "measured mile" comparison used to prove lost productivity.</p>
          </>
        ) : <p className="muted small">No day is tagged as disrupted yet. Tag days at push (Lost time) or below.</p>}
      </div>
      <Editors data={data} items={items} causes={causes} user={user} onSaved={onSaved} />
    </>
  );
}

/** Sheets with unallocated hours and no reason yet; and tagging a day. */
function Editors({ data, items, causes, user, onSaved }: { data: Data; items: Lost[]; causes: Cause[]; user: string; onSaved: (items: Lost[]) => void }) {
  const given = new Map(items.map((i) => [`${i.sheet}|${i.supervisor ?? ""}`, i]));
  const open = useMemo(() => {
    const by = new Map<string, { sheet: string; day: number; supervisor: string; hours: number }>();
    for (const s of data.slices) {
      if (s.code !== NO_CODE || s.supervisor === NO_SUPERVISOR) continue;
      const k = `${s.sheet}|${s.supervisor}`;
      const r = by.get(k) ?? { sheet: s.sheet, day: s.day, supervisor: s.supervisor, hours: 0 };
      r.hours += s.hours;
      by.set(k, r);
    }
    return [...by.values()].filter((r) => r.hours >= 0.25).sort((a, b) => a.day - b.day || b.hours - a.hours);
  }, [data]);
  const [msg, setMsg] = useState<string | null>(null);
  const [day, setDay] = useState(data.days[0]?.sheet ?? "");
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const save = async (body: { sheet: string; supervisor?: string | null; causes: string[]; note?: string | null }, done: string) => {
    try {
      const v = await api.setLostTime({ user: user || "unknown", ...body });
      onSaved(v.items);
      setMsg(done);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const current = given.get(`${day}|`);
  return (
    <div className="two-col">
      <div className="card">
        <h3>Reasons for each supervisor sheet</h3>
        <p className="muted small">Supervisor sheets with unallocated hours. Pick a reason (it can be changed any time); sheets pushed without a supervisor are not listed.</p>
        {open.length ? (
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table className="data">
              <thead><tr><th>Day</th><th>Supervisor</th><th className="num">Unallocated</th><th>Reason</th></tr></thead>
              <tbody>
                {open.map((r) => {
                  const cur = given.get(`${r.sheet}|${r.supervisor}`)?.causes[0] ?? "";
                  return (
                    <tr key={`${r.sheet}|${r.supervisor}`}>
                      <td>{r.day}</td>
                      <td>{r.supervisor}</td>
                      <td className="num">{h(r.hours)} h</td>
                      <td>
                        <select aria-label={`Reason for ${r.supervisor}, day ${r.day}`} value={cur}
                          onChange={(e) => save({ sheet: r.sheet, supervisor: r.supervisor, causes: e.target.value ? [e.target.value] : [] }, `Saved: day ${r.day}, ${r.supervisor}.`)}>
                          <option value="">— no reason —</option>
                          {causes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted small">No supervisor sheet has unallocated hours.</p>}
      </div>
      <div className="card">
        <h3>Tag a disrupted day</h3>
        <label className="small">
          Day{" "}
          <select aria-label="Day to tag" value={day} onChange={(e) => { setDay(e.target.value); setTags(given.get(`${e.target.value}|`)?.causes ?? []); setNote(given.get(`${e.target.value}|`)?.note ?? ""); }}>
            {data.days.map((d) => <option key={d.sheet} value={d.sheet}>Day {d.day}{given.get(`${d.sheet}|`) ? " ●" : ""}</option>)}
          </select>
        </label>
        <div className="lost-chips" style={{ margin: "8px 0" }}>
          {causes.filter((c) => c.id !== "other").map((c) => (
            <button key={c.id} type="button" className={`chip${tags.includes(c.id) ? " on" : ""}`} aria-pressed={tags.includes(c.id)}
              onClick={() => setTags((t) => (t.includes(c.id) ? t.filter((x) => x !== c.id) : [...t, c.id]))}>{c.label}</button>
          ))}
        </div>
        <input aria-label="Day note" placeholder="Note (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} style={{ width: "100%" }} />
        <div className="actions">
          <button className="primary" onClick={() => save({ sheet: day, causes: tags, note: note.trim() || null }, tags.length ? `Day ${day} tagged.` : `Day ${day} cleared.`)}>
            {tags.length ? "Save the day's tags" : current ? "Clear the day's tags" : "Save"}
          </button>
          {msg && <span className="small ok-text">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
