import { useEffect, useState } from "react";
import { api, type RatesView } from "../api";

/** The QS's standard daily rates per trade for this workbook's labour source, and the overtime
 * multipliers. Costing rates, not pay: every rupee figure says "at standard rates". Kept on this
 * PC; Excel is not changed. */
export function RatesEditor({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [view, setView] = useState<RatesView | null>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [mult, setMult] = useState({ ot: "1.5", sunday: "1.5", holiday: "2", day_hours: "8" });
  const [useWorkers, setUseWorkers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = (v: RatesView) => {
    setView(v);
    setRates(Object.fromEntries([...new Set([...v.known, ...Object.keys(v.trades)])].map((t) => [t, v.trades[t] ? String(v.trades[t]) : ""])));
    setMult({ ot: String(v.ot), sunday: String(v.sunday), holiday: String(v.holiday), day_hours: String(v.day_hours) });
    setUseWorkers(v.use_worker_rates);
  };
  useEffect(() => {
    api.rates().then(show, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const num = (s: string) => Number(s.replace(/[,\s]/g, "").replace(/^rs\.?/i, ""));
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const trades = Object.fromEntries(Object.entries(rates).filter(([, v]) => v.trim() && num(v) > 0).map(([t, v]) => [t, num(v)]));
      const v = await api.saveRates({
        trades, use_worker_rates: useWorkers,
        ot: num(mult.ot), sunday: num(mult.sunday), holiday: num(mult.holiday), day_hours: num(mult.day_hours),
      }); // prettier-ignore
      show(v);
      setSaved("Saved. Every view in rupees uses these rates now.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const dayHours = num(mult.day_hours) || 8;
  const [extra, setExtra] = useState("");

  return (
    <div className="card rates-card">
      <div className="card-head">
        <h3>Standard rates{view ? ` · ${view.source.toUpperCase()}` : ""}</h3>
        <button className="link small" onClick={onClose}>Close</button>
      </div>
      <p className="muted small">
        A standard daily rate per trade for this labour source, as the QS prices labour: <b>costing rates, not pay</b>. Every rupee figure
        says "at standard rates" and none is shown per person. Kept on this PC; Excel is not changed.
        {view?.other_sources.length ? ` Other labour sources with rates: ${view.other_sources.join(", ")}.` : ""}
      </p>
      {error && <p className="error-text">{error}</p>}
      {!view ? (
        <p className="muted small">Loading…</p>
      ) : (
        <>
          <div className="rates-grid">
            <table className="trade-table rates-table">
              <thead>
                <tr>
                  <th>Trade</th>
                  <th>Daily rate (Rs)</th>
                  <th>Per hour</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(rates).map((t) => (
                  <tr key={t}>
                    <td>{t}</td>
                    <td>
                      <input aria-label={`Daily rate for ${t}`} inputMode="decimal" value={rates[t]} placeholder="—" onChange={(e) => setRates((r) => ({ ...r, [t]: e.target.value }))} />
                    </td>
                    <td className="muted small">{num(rates[t]) > 0 ? `Rs ${(num(rates[t]) / dayHours).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ""}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <input aria-label="Another trade" placeholder="+ trade" value={extra} onChange={(e) => setExtra(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && extra.trim()) { setRates((r) => ({ ...r, [extra.trim()]: "" })); setExtra(""); } }} />
                  </td>
                  <td colSpan={2} className="muted small">Enter adds the trade</td>
                </tr>
              </tbody>
            </table>
            <div className="rates-mult">
              <b className="small">Multipliers</b>
              {([
                ["ot", "Overtime (normal day, Saturday)"],
                ["sunday", "Sunday (every hour)"],
                ["holiday", "Public holiday (every hour)"],
                ["day_hours", "Hours in a standard day"],
              ] as const).map(([k, label]) => (
                <label key={k} className="rates-row">
                  <span>{label}</span>
                  <input aria-label={label} inputMode="decimal" value={mult[k]} onChange={(e) => setMult((m) => ({ ...m, [k]: e.target.value }))} />
                  <span className="muted small">{k === "day_hours" ? "h" : "×"}</span>
                </label>
              ))}
              <p className="muted small">Defaults: 1.5× overtime, 2× public holidays, an 8-hour day. Confirm them with HR (Wages Board or contract).</p>
              <label className="check small">
                <input type="checkbox" checked={useWorkers} onChange={(e) => setUseWorkers(e.target.checked)} /> Use Labour Detail's Daily Rate where it
                is filled ({view.worker_rates} worker{view.worker_rates === 1 ? "" : "s"})
              </label>
            </div>
          </div>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={save}>Save rates</button>
            {saved && <span className="ok-text small">✓ {saved}</span>}
          </div>
        </>
      )}
    </div>
  );
}
