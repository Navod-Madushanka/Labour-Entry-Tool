import type { CommitResult, EntryInput, EntryPlan } from "../api";
import { fmtHours, formatShift } from "../time";
import { IssueList } from "./IssueList";

export interface QueueItem {
  id: number;
  input: EntryInput;
  plan: EntryPlan | null;
}

interface Props {
  items: QueueItem[];
  busy: boolean;
  onAck: (id: number, rule: string) => void;
  onAckAll: (rule: string) => void;
  onOverwrite: (id: number) => void;
  onEdit: (id: number) => void;
  onRemove: (id: number) => void;
  onCommit: (dryRun: boolean) => void;
  onClear: () => void;
}

const isClear = (i: EntryInput) =>
  i.time_in === null && i.time_out === null && !i.activities.length && i.additional === null && !i.remark;

export function Queue({ items, busy, onAck, onAckAll, onOverwrite, onEdit, onRemove, onCommit, onClear }: Props) {
  if (!items.length)
    return (
      <section className="queue empty">
        <h2>Queue</h2>
        <p className="muted">Workers you add appear here and on the manpower sheet above.</p>
      </section>
    );
  const blocked = items.filter((i) => !i.plan || i.plan.blocking.length).length;
  const unconfirmed = items.filter((i) => i.plan && !i.plan.blocking.length && i.plan.unconfirmed.length).length;
  const pending = new Map<string, { count: number; example: string; title: string }>(); // warning -> entries
  for (const it of items)
    for (const i of it.plan?.unconfirmed ?? []) {
      const p = pending.get(i.rule) ?? { count: 0, example: i.plain.what, title: i.plain.title };
      pending.set(i.rule, { ...p, count: p.count + 1 });
    }
  return (
    <section className="queue">
      <h2>
        Waiting to go to Excel <span className="muted">({items.length})</span>
      </h2>
      {pending.size > 0 && (
        <div className="bulk small">
          <span className="muted">Mark a warning as correct for every worker that has it:</span>
          {[...pending].map(([rule, p]) => (
            <button key={rule} className="small" title={p.example} onClick={() => onAckAll(rule)}>
              ✓ {p.title} ({p.count})
            </button>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sheet</th>
              <th>Worker</th>
              <th>In–Out</th>
              <th>Activities</th>
              <th>Worked</th>
              <th>Overtime</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map(({ id, input, plan }) => {
              const p = plan?.preview;
              const e08 = plan?.blocking.some((i) => i.rule === "E08");
              return (
                <tr key={id} className={!plan ? "" : plan.blocking.length ? "row-block" : plan.unconfirmed.length ? "row-warn" : "row-ok"}>
                  <td>{input.sheet}</td>
                  <td>
                    <b>{input.calling_name}</b>
                    {input.overwrite && <span className="badge small">replaces Excel</span>}
                  </td>
                  <td>{isClear(input) ? <em>clear the day</em> : formatShift(input.time_in, input.time_out)}</td>
                  <td className="small">
                    {input.activities.map((a, n) => (
                      <div key={n}>
                        {a.code} {a.hours !== null && <>· {fmtHours(a.hours)}</>}
                      </div>
                    ))}
                    {input.additional !== null && <div>additional {fmtHours(input.additional)}</div>}
                  </td>
                  <td>{fmtHours(p?.effective)}</td>
                  <td>{p && p.ot_raw !== null && p.ot_raw > 0 ? fmtHours(p.ot_raw) : "—"}</td>
                  <td>
                    {!plan ? (
                      <span className="muted small">checking…</span>
                    ) : (
                      <>
                        <IssueList
                          issues={plan.issues}
                          acknowledged={input.acknowledged}
                          onToggle={(rule) => onAck(id, rule)}
                          compact
                        />
                        {e08 && (
                          <button className="small" onClick={() => onOverwrite(id)}>
                            Replace what's in Excel
                          </button>
                        )}
                        {plan.ok && <span className="pill ok">✓ Ready</span>}
                      </>
                    )}
                  </td>
                  <td className="row-actions">
                    <button className="link" onClick={() => onEdit(id)}>
                      Edit
                    </button>
                    <button className="link" onClick={() => onRemove(id)} aria-label={`Remove ${input.calling_name}`}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button disabled={busy} onClick={() => onCommit(true)} title="Check every worker again against Excel">
          Check again
        </button>
        <button className="link" disabled={busy} onClick={() => window.confirm(`Remove all ${items.length} workers from this list? Nothing is written.`) && onClear()}>
          Remove all
        </button>
        {blocked > 0 && <span className="error-text">{blocked} worker{blocked === 1 ? " has" : "s have"} a problem to fix (red).</span>}
        {unconfirmed > 0 && <span className="warn-text">{unconfirmed} need “It's correct” ticked (yellow).</span>}
      </div>
    </section>
  );
}

export function CommitResultView({ result, onClose }: { result: CommitResult; onClose: () => void }) {
  const bad = result.readback.filter((r) => !r.ok);
  const title = {
    written: `✓ ${result.readback.length} worker${result.readback.length === 1 ? "" : "s"} written to Excel`,
    unchanged: "Nothing to write: Excel already has these values.",
    rejected: "Nothing was written: some workers still have a problem (see the list below).",
    dry_run: "Checked: everything can be written.",
    failed: `Nothing was written: ${result.error}`,
  }[result.status];
  return (
    <section className={`result ${result.status === "written" && !bad.length ? "ok" : result.status === "failed" || bad.length ? "bad" : ""}`} role="status">
      <div className="result-head">
        <strong>{title}</strong>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
      {result.status === "written" && (
        <p className="small">
          {bad.length
            ? `For ${bad.length} worker(s) Excel shows different hours than expected. Please check them in Excel.`
            : "Excel worked out the same hours as shown here. Remember to save the Excel file (Save button, top right)."}
          {result.backup && <span className="muted"> A backup copy was saved first.</span>}
        </p>
      )}
      {bad.length > 0 && (
        <ul className="issues">
          {bad.map((r) => (
            <li key={r.calling_name} className="issue BLOCK">
              <b>{r.calling_name}</b> {r.mismatches.join("; ")}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
