import { useEffect, useMemo, useState } from "react";
import { api, type Master, type MedicalPlan, type MedicalRequest, type MedicalResult } from "../api";
import { fmtHours, formatClock, parseClock } from "../time";
import { IssueList } from "./IssueList";

interface Props {
  master: Master;
  sheet: string;
  user: string;
  initialWorker: string | null;
  onDone: (sheets: string[]) => void; // written: reload these sheets, master and batches
  onClose: () => void;
}

const isBase = (name: string) => /^[A-Z]{2,3}[A-Z]{0,2}-\d{2,3}$/.test(name);

/** Medical leave: '<base> M' line (added to Labour Detail if new) with N days, Sundays skipped. */
export function MedicalDialog({ master, sheet, user, initialWorker, onDone, onClose }: Props) {
  const [base, setBase] = useState(initialWorker && isBase(initialWorker) ? initialWorker : "");
  const [start, setStart] = useState(sheet);
  const [days, setDays] = useState("10");
  const [timeIn, setTimeIn] = useState("07:00");
  const [timeOut, setTimeOut] = useState("16:00");
  const [activity, setActivity] = useState("00-00-10-00");
  const [skipHolidays, setSkipHolidays] = useState(false);
  const [acks, setAcks] = useState<Record<string, string[]>>({});
  const [plan, setPlan] = useState<MedicalPlan | null>(null);
  const [result, setResult] = useState<MedicalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bases = useMemo(() => master.workers.filter((w) => isBase(w.calling_name)), [master.workers]);
  const req: MedicalRequest | null = useMemo(() => {
    const tin = parseClock(timeIn);
    const tout = parseClock(timeOut);
    const n = Number(days);
    if (!bases.some((w) => w.calling_name === base) || tin === null || tout === null || !(n >= 1 && n <= 31)) return null;
    return { base, start, days: n, time_in: tin, time_out: tout <= tin ? tout + 24 : tout, activity: activity.trim(),
             remark: null, skip_holidays: skipHolidays, acknowledged: acks };
  }, [base, start, days, timeIn, timeOut, activity, skipHolidays, acks, bases]);

  useEffect(() => {
    if (!req) {
      setPlan(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      api.medicalPreview(req).then((p) => !stale && (setPlan(p), setError(null))).catch((e) => !stale && setError(e.message));
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(req)]);

  const ready = plan && !plan.problems.length && plan.plans.length > 0 && plan.plans.every((p) => p.ok);
  const toggle = (s: string, rule: string) =>
    setAcks((a) => {
      const now = a[s] ?? [];
      return { ...a, [s]: now.includes(rule) ? now.filter((r) => r !== rule) : [...now, rule] };
    });

  const write = async () => {
    if (!req || !plan) return;
    const what = plan.new_row
      ? `Add ${plan.name} to Labour Detail row ${plan.row} (copied from ${plan.base}), then write ${plan.plans.length} days?`
      : `Write ${plan.plans.length} days for ${plan.name}?`;
    if (!window.confirm(`${what}\n\nA backup is made first; each part can be undone.`)) return;
    setBusy(true);
    try {
      const res = await api.medical(req, user);
      setResult(res);
      if (res.status === "written" || res.row?.status === "written") onDone(plan.plans.map((p) => p.input.sheet));
      if (res.status !== "written" && res.plan) setPlan(res.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Medical leave">
        <div className="section-head">
          <h2>Medical leave</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted small">
          The worker gets a medical line <code>&lt;calling name&gt; M</code> (added to Labour Detail if it is new) with one
          entry per working day. Sundays are skipped.
        </p>
        <div className="row">
          <div className="field">
            <label htmlFor="med-worker">Worker</label>
            <input id="med-worker" list="med-workers" value={base} placeholder="INC-08" autoFocus
                   onChange={(e) => setBase(e.target.value.toUpperCase().trim())} />
            <datalist id="med-workers">
              {bases.map((w) => (
                <option key={w.row} value={w.calling_name} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="med-start">First day</label>
            <select id="med-start" value={start} onChange={(e) => setStart(e.target.value)}>
              {master.sheets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="med-days">Days</label>
            <input id="med-days" inputMode="numeric" size={4} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="med-in">In</label>
            <input id="med-in" size={6} value={timeIn} onChange={(e) => setTimeIn(e.target.value)}
                   onBlur={() => setTimeIn((t) => formatClock(parseClock(t)) || t)} />
          </div>
          <div className="field">
            <label htmlFor="med-out">Out</label>
            <input id="med-out" size={6} value={timeOut} onChange={(e) => setTimeOut(e.target.value)}
                   onBlur={() => setTimeOut((t) => formatClock(parseClock(t)) || t)} />
          </div>
          <div className="field">
            <label htmlFor="med-activity">Activity</label>
            <input id="med-activity" list="activity-codes" size={14} value={activity} onChange={(e) => setActivity(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={skipHolidays} onChange={(e) => setSkipHolidays(e.target.checked)} /> Skip holidays too
          </label>
        </div>

        {error && <p className="error-text">{error}</p>}
        {!req && <p className="muted">Pick a worker (a base calling name like INC-08) and check the times.</p>}
        {plan && (
          <div className="medical-plan">
            {plan.problems.map((p) => (
              <p key={p} className="error-text">
                {p}
              </p>
            ))}
            {plan.name && !plan.problems.length && (
              <p>
                <b>{plan.name}</b>{" "}
                {plan.new_row ? (
                  <span className="badge warn small">new: Labour Detail row {plan.row}</span>
                ) : (
                  <span className="badge small">exists: Labour Detail row {plan.row}</span>
                )}
              </p>
            )}
            {[...plan.notes, ...plan.skipped.map((s) => `Skipped ${s}`)].map((n) => (
              <div key={n} className="small muted">
                {n}
              </div>
            ))}
            {plan.plans.length > 0 && (
              <div className="table-wrap">
                <table className="plain">
                  <thead>
                    <tr>
                      <th>Sheet</th>
                      <th>In–Out</th>
                      <th>Activity · hours</th>
                      <th>Eff.</th>
                      <th>OT</th>
                      <th>Checks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.plans.map((p) => (
                      <tr key={p.input.sheet} className={p.ok ? "row-ok" : p.blocking.length ? "row-block" : "row-warn"}>
                        <td>{p.input.sheet}</td>
                        <td>
                          {formatClock(p.input.time_in)}–{formatClock(p.input.time_out)}
                        </td>
                        <td className="small">
                          {p.input.activities[0]?.code} · {fmtHours(p.input.activities[0]?.hours)}
                        </td>
                        <td>{fmtHours(p.preview?.effective)}</td>
                        <td>{p.preview && p.preview.ot_raw !== null && p.preview.ot_raw > 0 ? fmtHours(p.preview.ot_raw) : "—"}</td>
                        <td>
                          <IssueList issues={p.issues} acknowledged={acks[p.input.sheet] ?? []}
                                     onToggle={(rule) => toggle(p.input.sheet, rule)} compact />
                          {p.ok && <span className="ok-text small">ready</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {result && (
          <div className={`result ${result.status === "written" ? "ok" : "bad"}`} role="status">
            <strong>
              {result.status === "written"
                ? `Done: ${result.row ? `${result.plan.name} added (batch ${result.row.batch_id}), ` : ""}${result.entries?.readback.length} days written (batch ${result.entries?.batch_id}).`
                : result.status === "rejected"
                  ? "Not written: confirm or fix the checks above."
                  : `Failed: ${result.error}`}
            </strong>
          </div>
        )}
        <div className="actions">
          <button className="primary" disabled={!ready || busy || result?.status === "written"} onClick={write}>
            {plan?.new_row ? `Add ${plan.name ?? "line"} and write ${plan.plans.length} days` : `Write ${plan?.plans.length ?? 0} days`}
          </button>
          {plan && !ready && plan.plans.some((p) => p.unconfirmed.length) && (
            <span className="warn-text small">Tick the warnings to confirm them.</span>
          )}
        </div>
      </div>
    </div>
  );
}
