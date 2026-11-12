// The BP Bill sheet and a supplier's claim against the day sheets (roadmap #8). The BP Bill's
// layout is found by the tool (shown, and correctable); the claim's columns by their headings.
import { useRef, useState } from "react";
import { api, type BillCheck, type ClaimCheck } from "../api";

const h = (n: number | null) => (n === null || n === undefined ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const letters = (c: number | null) => {
  if (!c) return "";
  let s = "";
  for (let n = c; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colNum = (s: string) => {
  const t = s.trim().toUpperCase();
  if (!t) return undefined;
  if (/^\d+$/.test(t)) return Number(t);
  return /^[A-Z]{1,3}$/.test(t) ? [...t].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) : NaN;
};

export function BillCompare() {
  return (
    <>
      <BpBillCard />
      <ClaimCard />
    </>
  );
}

function BpBillCard() {
  const [res, setRes] = useState<BillCheck | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copy, setCopy] = useState<File | null>(null);
  const [fix, setFix] = useState({ header_row: "", name_col: "", first_day_col: "", total_days_col: "", mode: "" });
  const file = useRef<HTMLInputElement>(null);
  const run = async (f: File | null) => {
    setBusy(true);
    setMsg(null);
    try {
      setRes(f ? await api.bpBillCheckFile(f) : await api.bpBillCheck());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const saveFix = async (clear = false) => {
    const body: Record<string, number | string> = {};
    if (!clear) {
      for (const k of ["name_col", "first_day_col", "total_days_col"] as const) {
        const n = colNum(fix[k]);
        if (n !== undefined) {
          if (Number.isNaN(n)) return setMsg(`"${fix[k]}" is not a column (A, B, … or 1, 2, …)`);
          body[k] = n;
        }
      }
      if (fix.header_row.trim()) body.header_row = Number(fix.header_row);
      if (fix.mode) body.mode = fix.mode;
    }
    await api.saveBpLayout(body);
    await run(copy);
  };
  const lay = res?.layout;
  return (
    <div className="card bp-card">
      <h3>Against the workbook's BP Bill sheet</h3>
      <p className="muted small">
        The BP Bill sheet is read from the saved workbook (Excel is not used) and compared worker by worker and day by day with the
        day sheets. Its layout is found by the tool: the header row with "Calling Name", the day columns 1–31, the totals; what it
        found is shown below and can be corrected.
      </p>
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="primary" disabled={busy} onClick={() => { setCopy(null); run(null); }}>Check the saved workbook</button>
        <button disabled={busy} onClick={() => file.current?.click()}>Use a copy of the workbook…</button>
        <input ref={file} type="file" accept=".xlsb,.xlsx" hidden aria-label="Workbook copy with the BP Bill" onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (f) { setCopy(f); run(f); }
        }} />
        {busy && <span className="muted small">Reading…</span>}
      </div>
      {msg && <p className="error-text small">{msg}</p>}
      {res && lay && (
        <>
          <p className="small">
            <b>{res.source}</b>, sheet <b>{lay.sheet}</b>: {res.layout_text}. {res.workers} worker{res.workers === 1 ? "" : "s"} on the BP Bill.
          </p>
          {lay.notes.map((n) => <p key={n} className="muted small">• {n}</p>)}
          <details className="howto">
            <summary>Correct the layout</summary>
            <div className="bp-fix">
              <label>Header row <input aria-label="Header row" placeholder={String(lay.header_row ?? "")} value={fix.header_row} onChange={(e) => setFix({ ...fix, header_row: e.target.value })} /></label>
              <label>Calling names in column <input aria-label="Calling name column" placeholder={letters(lay.name_col)} value={fix.name_col} onChange={(e) => setFix({ ...fix, name_col: e.target.value })} /></label>
              <label>Day 1 in column <input aria-label="Day 1 column" placeholder={letters(lay.day_cols["1"] ?? null)} value={fix.first_day_col} onChange={(e) => setFix({ ...fix, first_day_col: e.target.value })} /></label>
              <label>Total days in column <input aria-label="Total days column" placeholder={letters(lay.total_days_col)} value={fix.total_days_col} onChange={(e) => setFix({ ...fix, total_days_col: e.target.value })} /></label>
              <label>Day cells hold
                <select aria-label="Day cells hold" value={fix.mode} onChange={(e) => setFix({ ...fix, mode: e.target.value })}>
                  <option value="">as found ({lay.mode === "hours" ? "hours" : "day counts"})</option>
                  <option value="hours">hours</option>
                  <option value="days">day counts (1, 0.5)</option>
                </select>
              </label>
            </div>
            <div className="actions">
              <button className="small primary" onClick={() => saveFix()}>Save and check again</button>
              <button className="small link" onClick={() => saveFix(true)}>Back to finding it</button>
            </div>
          </details>
          {res.differences.length ? (
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table className="data">
                <thead><tr><th>Worker</th><th className="num">Day</th><th className="num">BP Bill</th><th className="num">Day sheets</th><th>Difference</th></tr></thead>
                <tbody>
                  {res.differences.map((d, i) => (
                    <tr key={i}><td>{d.name}</td><td className="num">{d.day ?? "total"}</td><td className="num">{h(d.bill)}</td><td className="num">{h(d.sheets)}</td><td>{d.note}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ok-text small">The BP Bill agrees with the day sheets for every worker and day.</p>
          )}
        </>
      )}
    </div>
  );
}

function ClaimCard() {
  const [rows, setRows] = useState<ClaimCheck[] | null>(null);
  const [source, setSource] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [only, setOnly] = useState(true);
  const file = useRef<HTMLInputElement>(null);
  const template = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["Business partner,Calling name,Days billed,Hours billed\n"], { type: "text/csv" }));
    a.download = "Supplier claim template.csv";
    a.click();
  };
  const shown = (rows ?? []).filter((r) => !only || r.note !== "matches");
  return (
    <div className="card bp-card">
      <h3>Against the supplier's claim</h3>
      <p className="muted small">
        The supplier's bill as a file, one row per worker: <b>Business partner, Calling name, Days billed, Hours billed</b> (hours
        optional; columns are found by their headings). Each worker is checked against the days at 6+ effective hours on the day
        sheets; workers of that partner on the sheets but not on the claim are listed too.
      </p>
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="primary" onClick={() => file.current?.click()}>Check a claim (.xlsx or .csv)…</button>
        <button className="link small" onClick={template}>Blank template</button>
        <input ref={file} type="file" accept=".xlsx,.csv" hidden aria-label="Supplier claim" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setMsg(null);
          try {
            const r = await api.bpClaim(f);
            setRows(r.rows);
            setSource(r.source);
          } catch (err) {
            setMsg(err instanceof Error ? err.message : String(err));
          }
        }} />
        {rows && <label className="check small"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> only what differs</label>}
      </div>
      {msg && <p className="error-text small">{msg}</p>}
      {rows && (
        <>
          <p className="small"><b>{source}</b>: {rows.length} worker{rows.length === 1 ? "" : "s"}, {rows.filter((r) => r.note !== "matches").length} to check.</p>
          {shown.length ? (
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table className="data">
                <thead><tr><th>Partner</th><th>Worker</th><th className="num">Days billed</th><th className="num">Days 6+ h on sheets</th><th className="num">Hours billed</th><th className="num">Hours on sheets</th><th>Check</th></tr></thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={i}><td>{r.bp || "—"}</td><td>{r.name}</td><td className="num">{h(r.billed_days)}</td><td className="num">{r.sheet_days}</td><td className="num">{h(r.billed_hours)}</td><td className="num">{h(r.sheet_hours)}</td>
                      <td className={r.note === "matches" ? "ok-text" : "warn-text"}>{r.note}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="ok-text small">The claim matches the day sheets.</p>}
        </>
      )}
    </div>
  );
}
