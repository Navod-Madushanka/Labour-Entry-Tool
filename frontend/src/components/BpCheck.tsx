// BP bill check (roadmap #8): before the QS certifies a labour supplier's bill, the worker-days the
// BP Bill counts (a day at 6+ effective hours, the workbook's own rule), with what to check first:
// double bookings, missing employee codes, long runs, entries changed after supervisor review.
import { useMemo, useState } from "react";
import { api, type Master } from "../api";
import { bpBill, DEFAULT_LIMITS, NO_BP, type Data, type EntryRow } from "../analysis";
import { h } from "./charts";

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;

export function BpCheck({ data, entries, master, money, changedAfterReview }: {
  data: Data;
  entries: EntryRow[];
  master: Master;
  money: boolean;
  changedAfterReview: Set<string>;
}) {
  const groups = useMemo(
    () => bpBill(data, entries, { daysInRow: master.limits?.days_in_row ?? DEFAULT_LIMITS.days_in_row, changedAfterReview }),
    [data, entries, master.limits, changedAfterReview],
  );
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const label = (bp: string) => (bp === NO_BP ? `${master.workbook.replace(/\.(xlsb|xlsx|json)$/i, "")} (no business partner in Labour Detail)` : bp);

  const exportIt = async () => {
    setMsg(null);
    try {
      const note = `${master.workbook} · ${master.month} · a day counts at 6+ effective hours (the BP Bill rule)${money ? " · cost at standard rates" : ""}`;
      const cols = ["Worker", "Trade", "Days", "Billable days", "Under 6 h", "Hours", "OT", "Sundays / holidays", ...(money ? ["Cost (Rs)"] : []), "Check"];
      const blob = await api.exportAnalysis(`BP bill check ${master.month}`, [
        { name: "Summary", note, columns: ["Business partner", "Workers", "Billable worker-days", "Worker-days", "Hours", "OT", "Sundays / holidays", ...(money ? ["Cost (Rs)"] : []), "Workers to check"],
          rows: groups.map((g) => [label(g.bp), g.workers.length, g.billable, g.days, Math.round(g.hours * 100) / 100, Math.round(g.ot * 100) / 100, g.sundays, ...(money ? [Math.round(g.cost)] : []), g.flagged]) },
        ...groups.map((g) => ({
          name: label(g.bp).slice(0, 31), note, columns: cols,
          rows: g.workers.map((w) => [w.name, w.trade, w.days, w.billable, w.short, Math.round(w.hours * 100) / 100, Math.round(w.ot * 100) / 100, w.sundays, ...(money ? [Math.round(w.cost)] : []), w.flags.join(", ")]),
        })),
      ]); // prettier-ignore
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `BP bill check ${master.month}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  if (!groups.length) return <p className="muted">No entries yet.</p>;
  return (
    <>
      <div className="card-head">
        <p className="muted small" style={{ margin: 0 }}>
          Before a labour supplier's bill is certified: the worker-days the BP Bill counts (a day at 6 or more effective hours, the
          workbook's own rule), worked out from the day sheets, and the workers to check first. The business partner is Labour Detail's
          column F.
        </p>
        <span className="row" style={{ marginTop: 0 }}>
          <label className="check small"><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> only workers to check</label>
          <button onClick={exportIt}>Export for the QS</button>
        </span>
      </div>
      {msg && <p className="error-text">{msg}</p>}
      {groups.map((g) => {
        const shown = onlyFlagged ? g.workers.filter((w) => w.flags.length) : g.workers;
        return (
          <div key={g.bp} className="card bp-card">
            <div className="card-head">
              <h3>{label(g.bp)}</h3>
              {g.flagged ? <span className="badge warn">{g.flagged} worker{g.flagged === 1 ? "" : "s"} to check</span> : <span className="badge ok">nothing to check</span>}
            </div>
            <div className="bp-figures">
              <span><b>{g.workers.length}</b> workers</span>
              <span><b>{g.billable}</b> billable worker-days</span>
              <span className="muted">of {g.days} with entries</span>
              <span><b>{h(g.hours)}</b> h</span>
              <span><b>{h(g.ot)}</b> h OT</span>
              <span><b>{g.sundays}</b> Sunday / holiday days</span>
              {money && <span><b>{rs(g.cost)}</b> at standard rates</span>}
            </div>
            {shown.length ? (
              <div className="table-wrap" style={{ maxHeight: 420 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Worker</th><th>Trade</th><th className="num">Days</th><th className="num">Billable</th><th className="num" title="Days under 6 effective hours: the BP Bill does not count them">Under 6 h</th>
                      <th className="num">Hours</th><th className="num">OT</th><th className="num">Sun / hol</th>{money && <th className="num">Cost</th>}<th>Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((w) => (
                      <tr key={w.name}>
                        <td>{w.name}</td><td>{w.trade}</td><td className="num">{w.days}</td><td className="num"><b>{w.billable}</b></td><td className="num">{w.short || ""}</td>
                        <td className="num">{h(w.hours)}</td><td className="num">{h(w.ot)}</td><td className="num">{w.sundays || ""}</td>{money && <td className="num">{rs(w.cost)}</td>}
                        <td>{w.flags.map((f) => <span key={f} className="badge warn small">{f}</span>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">No worker of this business partner has anything to check.</p>
            )}
          </div>
        );
      })}
      <p className="muted small">
        Checks: <b>double booking</b> — the same person booked twice with overlapping times (W03); <b>no employee code</b> — the ERP upload
        lines go out blank; <b>long run</b> — more days in a row than the fatigue limit; <b>changed after review</b> — the supervisor's sheet was
        checked against the paper, then changed. Comparing these figures with the workbook's own BP Bill sheet needs that sheet's layout
        (which columns hold the calling name and the day counts).
      </p>
    </>
  );
}
