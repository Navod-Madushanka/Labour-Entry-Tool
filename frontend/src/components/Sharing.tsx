// Sharing with the PM and QS (roadmap #10): the evening report written to a (shared) folder, and
// the same report read-only at /viewer for colleagues on the office network when that is on.
import { useEffect, useState } from "react";
import { api, type ReportSettings, type ReportState } from "../api";

const pick = (s: ReportSettings): ReportSettings => ({ folder: s.folder, time: s.time, enabled: s.enabled, rupees: s.rupees, lan: s.lan });

export function Sharing() {
  const [state, setState] = useState<ReportState | null>(null);
  const [form, setForm] = useState<ReportSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.reportSettings().then((s) => { setState(s); setForm(pick(s)); }, (e) => setMsg(String(e.message ?? e)));
  }, []);
  if (!form || !state) return <p className="muted">{msg ?? "Loading…"}</p>;
  const set = (patch: Partial<ReportSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const run = async (fn: () => Promise<ReportState>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const s = await fn();
      setState(s);
      setMsg(done);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const changed = JSON.stringify(pick(form)) !== JSON.stringify(pick(state));
  return (
    <>
      <div className="card share-card">
        <h3>Evening report for the PM and QS</h3>
        <p className="muted small">
          One page with the month's and the latest week's figures: hours, overtime, headcount by day and trade, top activities,
          business partners' billable days, disrupted days. No worker names and no figures per person. It is written as an HTML file
          (opens in any browser, prints to PDF) to the folder below every evening, read from the saved workbook (Excel is not used).
        </p>
        <label className="field">
          Folder (a shared folder the PM and QS can open)
          <input aria-label="Report folder" placeholder="e.g. \\\\server\\Projects\\KMTT\\Labour reports" value={form.folder} onChange={(e) => set({ folder: e.target.value })} />
        </label>
        <div className="row share-row">
          <label className="check"><input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Write it every evening at</label>
          <input aria-label="Report time" className="share-time" value={form.time} onChange={(e) => set({ time: e.target.value })} />
          <span className="muted small">(while the tool is running on this PC)</span>
        </div>
        <label className="check"><input type="checkbox" checked={form.rupees} onChange={(e) => set({ rupees: e.target.checked })} /> Include labour cost at standard rates</label>
        <p className="muted small">Off by default: rates are for the QS. Turn on only if everyone who opens the folder may see them.</p>
        <div className="actions">
          <button className="primary" disabled={busy || !changed} onClick={() => run(() => api.saveReportSettings(form), "Saved.")}>Save</button>
          <button disabled={busy || changed || !state.folder} title={changed ? "Save first" : undefined} onClick={() => run(api.writeReport, "Written.")}>Write it now</button>
          <a className="small" href="/viewer" target="_blank" rel="noreferrer">Preview the report ↗</a>
          {msg && <span className="small ok-text">{msg}</span>}
        </div>
        <p className="small">
          {state.last_at ? <>Last written {new Date(state.last_at).toLocaleString()}: <code>{state.last_file}</code></> : <span className="muted">Not written yet.</span>}
          {state.last_error && <span className="error-text"> · Last problem: {state.last_error}</span>}
        </p>
      </div>
      <div className="card share-card">
        <h3>Open it from their own PCs (office network)</h3>
        <label className="check"><input type="checkbox" checked={form.lan} onChange={(e) => set({ lan: e.target.checked })} /> Let colleagues open the read-only report from their PCs</label>
        <p className="muted small">
          They open <code>{state.viewer_url ?? "http://<this PC>:8000/viewer"}</code> in a browser and see the same report, live. Other PCs get that
          page only: no entry screen, no Excel, no writing. It takes effect the next time the tool starts, and IT may need to allow port 8000
          in Windows Firewall on this PC. Until then, the folder above is the way to share.
        </p>
        <p className="small">
          {state.lan_active ? <span className="ok-text">On: colleagues can open the report now.</span> : state.lan ? <span className="warn-text">Saved: restart the tool to switch it on.</span> : <span className="muted">Off.</span>}
        </p>
        <div className="actions"><button className="primary" disabled={busy || !changed} onClick={() => run(() => api.saveReportSettings(form), "Saved.")}>Save</button></div>
      </div>
    </>
  );
}
