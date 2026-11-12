// Productivity and unit cost (roadmap #6): hours and rupees per unit of work done, by week, against
// a norm (the BOQ build-up, the BSR, or the site's own median), and the measured mile: clean weeks
// against weeks with disrupted days. Needs ~10 minutes a week: the quantity done for 5-10 codes.
import { Fragment, useMemo, useState, type ClipboardEvent } from "react";
import { api, type Master } from "../api";
import { byCode, periods, productivity, NO_CODE, type Data, type Norm, type ProdRow } from "../analysis";
import { h } from "./charts";

type Desc = (code: string) => string | null;
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;
const fix = (n: number | null, d = 2) => (n === null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: d }));
const tone = (i: number | null) => (i === null ? "" : i >= 1 ? "ok-text" : i >= 0.9 ? "" : i >= 0.75 ? "warn-text" : "error-text");

export function Productivity({ data, master, desc, disrupted, money, onSaved }: {
  data: Data;
  master: Master;
  desc: Desc;
  disrupted: Set<number>;
  money: boolean;
  onSaved: () => void;
}) {
  const rows = useMemo(
    () => productivity(data, master.quantities ?? {}, master.units ?? {}, (master.norms ?? {}) as Record<string, Norm>, disrupted),
    [data, master.quantities, master.units, master.norms, disrupted],
  );
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(!rows.length);
  const label = (code: string) => (desc(code) ? `${desc(code)} (${code})` : code);
  const measured = rows.filter((r) => r.qty > 0);
  const lastWeek = (r: ProdRow) => [...r.weeks].reverse().find((w) => w.qty && w.hours);
  const through = measured.length ? Math.max(...measured.flatMap((r) => r.weeks.filter((w) => w.qty && w.hours).map((w) => Number(w.label.split("–")[1])))) : null;
  const miles = rows.filter((r) => r.mile.clean !== null && r.mile.disrupted !== null);
  return (
    <>
      <p className="muted small">
        Labour hours (and rupees) per unit of work done, from the daily sheets and a weekly quantity for each code. The index is earned
        hours (quantity × norm) over actual hours: below 1 is slower than the norm.{through ? ` Quantities to day ${through}.` : ""}
      </p>
      {measured.length > 0 && (
        <div className="card prod-readout">
          {measured.map((r) => {
            const lw = lastWeek(r);
            return (
              <div key={r.code}>
                <b>{desc(r.code) ?? r.code}</b>: {fix(r.hpu)} h per {r.unit || "unit"}
                {r.index !== null && <> · index <b className={tone(r.index)}>{fix(r.index)}</b> this month{lw && lw.index !== null && lw !== r.weeks.find((w) => w.qty && w.hours) ? <> ({fix(lw.index)} in days {lw.label})</> : null}</>}
                {money && r.rspu !== null && <> · {rs(r.rspu)} per {r.unit || "unit"} at standard rates</>}
              </div>
            );
          })}
        </div>
      )}
      {rows.length > 0 && (
        <div className="card">
          <h3>Hours and cost per unit</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Unit</th>
                  <th className="num">Quantity</th>
                  <th className="num">Hours</th>
                  <th className="num">Hours / unit</th>
                  {money && <th className="num">Rs / unit</th>}
                  <th className="num">Norm</th>
                  <th className="num">Index</th>
                  <th className="num" title="Hours on the code in weeks without a quantity: not in the rates">Not measured</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.code}>
                    <tr className="clickable" onClick={() => setOpen(open === r.code ? null : r.code)}>
                      <td><span className="mono">{r.code}</span>{desc(r.code) && <div className="muted small">{desc(r.code)}</div>}</td>
                      <td>{r.unit || "—"}</td>
                      <td className="num">{r.qty ? fix(r.qty, 1) : "—"}</td>
                      <td className="num">{h(r.hours)}</td>
                      <td className="num">{fix(r.hpu)}</td>
                      {money && <td className="num">{r.rspu === null ? "—" : rs(r.rspu)}</td>}
                      <td className="num">{r.norm === null ? "—" : <>{fix(r.norm)} <span className="muted small">{r.normSource}</span></>}</td>
                      <td className={`num ${tone(r.index)}`}><b>{fix(r.index)}</b></td>
                      <td className="num muted">{r.allHours - r.hours > 0.05 ? `${h(r.allHours - r.hours)} h` : ""}</td>
                    </tr>
                    {open === r.code && (
                      <tr className="detail-row">
                        <td colSpan={money ? 9 : 8}>
                          <table className="data prod-weeks">
                            <thead><tr><th>Days</th><th className="num">Quantity</th><th className="num">Hours</th><th className="num">Hours / unit</th>{money && <th className="num">Rs / unit</th>}<th className="num">Index</th><th>Disrupted days</th></tr></thead>
                            <tbody>
                              {r.weeks.filter((w) => w.hours || w.qty).map((w) => (
                                <tr key={w.week}>
                                  <td>{w.label}</td><td className="num">{w.qty === null ? "—" : fix(w.qty, 1)}</td><td className="num">{h(w.hours)}</td><td className="num">{fix(w.hpu)}</td>
                                  {money && <td className="num">{w.rspu === null ? "—" : rs(w.rspu)}</td>}<td className={`num ${tone(w.index)}`}>{fix(w.index)}</td><td>{w.disrupted.join(", ")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Click a row for its weeks. Norm "site median": no norm given, so the code's own weekly median (needs two weeks).</p>
        </div>
      )}
      {miles.length > 0 && (
        <div className="card">
          <h3>Measured mile: clean weeks against disrupted weeks</h3>
          <table className="data">
            <thead><tr><th>Activity</th><th className="num">Clean h / unit</th><th className="num">Disrupted h / unit</th><th className="num">Extra hours in disrupted weeks</th></tr></thead>
            <tbody>
              {miles.map((r) => (
                <tr key={r.code}><td>{label(r.code)}</td><td className="num">{fix(r.mile.clean)}</td><td className="num">{fix(r.mile.disrupted)}</td><td className="num">{r.mile.extraHours === null ? "none" : `${h(r.mile.extraHours)} h`}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Disrupted weeks are those with a day tagged on Lost time while the code had hours. The extra hours are (disrupted rate − clean rate) × the quantity done in disrupted weeks: the measured-mile estimate of lost productivity.</p>
        </div>
      )}
      <QuantityEditor data={data} master={master} desc={desc} open={editing} onToggle={setEditing} onSaved={onSaved} />
    </>
  );
}

/** Weekly quantities per code (paste from Excel works), with each code's unit and norm. */
function QuantityEditor({ data, master, desc, open, onToggle, onSaved }: { data: Data; master: Master; desc: Desc; open: boolean; onToggle: (o: boolean) => void; onSaved: () => void }) {
  const weeks = periods(data).filter((p) => p.key !== "month").map((p) => ({ week: p.key.slice(2), label: `${p.from}–${p.to}` }));
  const q0 = master.quantities ?? {}, u0 = master.units ?? {}, n0 = (master.norms ?? {}) as Record<string, Norm>;
  const [codes, setCodes] = useState<string[]>(() => [...new Set([...Object.keys(q0), ...Object.keys(u0), ...Object.keys(n0)])]);
  const [qty, setQty] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(Object.entries(q0).map(([c, w]) => [c, Object.fromEntries(Object.entries(w).map(([k, v]) => [k, String(v)]))])),
  );
  const [unit, setUnit] = useState<Record<string, string>>(u0);
  const [norm, setNorm] = useState<Record<string, { hours: string; source: string }>>(() =>
    Object.fromEntries(Object.entries(n0).map(([c, n]) => [c, { hours: String(n.hours), source: n.source }])),
  );
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const candidates = byCode(data.slices).filter((g) => g.key !== NO_CODE && !codes.includes(g.key)).slice(0, 40);
  const add = (c: string) => c && !codes.includes(c) && setCodes((x) => [...x, c]);
  const paste = (e: ClipboardEvent<HTMLInputElement>, r0: number, c0: number) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text)) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
    const next = { ...qty };
    let list = [...codes];
    lines.forEach((line, i) => {
      let cells = line.split("\t");
      let code = list[r0 + i];
      if (Number.isNaN(Number(cells[0].replace(/,/g, ""))) && cells[0].trim()) {
        code = cells[0].trim().toUpperCase(); // a row that starts with the code goes to that code
        cells = cells.slice(1);
        if (!list.includes(code)) list = [...list, code];
        cells.forEach((v, j) => { const w = weeks[j]?.week; if (w) next[code] = { ...(next[code] ?? {}), [w]: v.trim() }; });
        return;
      }
      if (!code) return;
      cells.forEach((v, j) => { const w = weeks[c0 + j]?.week; if (w) next[code] = { ...(next[code] ?? {}), [w]: v.trim() }; });
    });
    setCodes(list);
    setQty(next);
  };
  const num = (s: string | undefined) => Number((s ?? "").replace(/,/g, ""));
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.saveQuantities({
        quantities: Object.fromEntries(codes.map((c) => [c, Object.fromEntries(Object.entries(qty[c] ?? {}).filter(([, v]) => num(v) > 0).map(([w, v]) => [w, num(v)]))])),
        units: Object.fromEntries(codes.filter((c) => unit[c]?.trim()).map((c) => [c, unit[c].trim()])),
        norms: Object.fromEntries(codes.filter((c) => num(norm[c]?.hours) > 0).map((c) => [c, { hours: num(norm[c].hours), source: norm[c].source || "BOQ" }])),
      });
      setMsg("Saved. The tables above use these quantities.");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="card qty-editor" open={open} onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}>
      <summary><b>Quantities done (weekly)</b> <span className="muted small">· {codes.length} code{codes.length === 1 ? "" : "s"}</span></summary>
      <p className="muted small">
        Start with 5–10 cost-significant codes (formwork, rebar, concrete, blockwork, plaster). Each week, the quantity done from the
        QS's measurement or the site engineer's estimate. The norm is labour hours per unit from the BOQ build-up or the BSR; leave it
        empty to use the site's own median. Copy a block from Excel and paste it into a quantity box: rows starting with a code go to
        that code. Kept on this PC; Excel is not changed.
      </p>
      <div className="row" style={{ marginTop: 0 }}>
        <select aria-label="Add a code" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add a code (most hours first)…</option>
          {candidates.map((g) => <option key={g.key} value={g.key}>{g.key}{desc(g.key) ? ` · ${desc(g.key)}` : ""} ({h(g.hours)} h)</option>)}
        </select>
        <button className="small" disabled={!pick} onClick={() => { add(pick); setPick(""); }}>Add</button>
      </div>
      {codes.length > 0 && (
        <div className="table-wrap">
          <table className="data qty-grid">
            <thead>
              <tr>
                <th>Code</th><th>Unit</th><th>Norm h / unit</th><th>Source</th>
                {weeks.map((w) => <th key={w.week} className="num">Days {w.label}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {codes.map((c, r) => (
                <tr key={c}>
                  <th><span className="mono">{c}</span>{desc(c) && <div className="muted small">{desc(c)}</div>}</th>
                  <td><input aria-label={`Unit of ${c}`} className="qty-unit" placeholder="m3" value={unit[c] ?? ""} onChange={(e) => setUnit((u) => ({ ...u, [c]: e.target.value }))} /></td>
                  <td><input aria-label={`Norm of ${c}`} inputMode="decimal" placeholder="median" value={norm[c]?.hours ?? ""} onChange={(e) => setNorm((n) => ({ ...n, [c]: { hours: e.target.value, source: n[c]?.source ?? "BOQ" } }))} /></td>
                  <td>
                    <select aria-label={`Norm source of ${c}`} value={norm[c]?.source ?? "BOQ"} onChange={(e) => setNorm((n) => ({ ...n, [c]: { hours: n[c]?.hours ?? "", source: e.target.value } }))}>
                      {["BOQ", "BSR", "Other"].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  {weeks.map((w, j) => (
                    <td key={w.week}>
                      <input aria-label={`Quantity of ${c}, days ${w.label}`} inputMode="decimal" value={qty[c]?.[w.week] ?? ""}
                        onChange={(e) => setQty((q) => ({ ...q, [c]: { ...(q[c] ?? {}), [w.week]: e.target.value } }))} onPaste={(e) => paste(e, r, j)} />
                    </td>
                  ))}
                  <td><button className="link small danger" title="Take this code off" onClick={() => setCodes((x) => x.filter((y) => y !== c))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={save}>Save quantities</button>
        {msg && <span className="small ok-text">{msg}</span>}
      </div>
    </details>
  );
}
