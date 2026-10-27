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
        <p className="muted">Entries you add appear here. They are written to Excel together.</p>
      </section>
    );
  const blocked = items.filter((i) => !i.plan || i.plan.blocking.length).length;
  const unconfirmed = items.filter((i) => i.plan && !i.plan.blocking.length && i.plan.unconfirmed.length).length;
  const ready = !busy && !blocked && !unconfirmed;
  const pending = new Map<string, { count: number; example: string }>(); // warning -> entries
  for (const it of items)
    for (const i of it.plan?.unconfirmed ?? []) {
      const p = pending.get(i.rule) ?? { count: 0, example: i.message };
      pending.set(i.rule, { ...p, count: p.count + 1 });
    }
  return (
    <section className="queue">
      <h2>
        Queue <span className="muted">({items.length})</span>
      </h2>
      {pending.size > 0 && (
        <div className="bulk small">
          <span className="muted">Confirm a warning for every entry that has it:</span>
          {[...pending].map(([rule, p]) => (
            <button key={rule} className="small" title={`e.g. ${p.example}`} onClick={() => onAckAll(rule)}>
              {rule} × {p.count}
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
              <th>Eff.</th>
              <th>OT</th>
              <th>ZIDLE</th>
              <th>Checks</th>
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
                    {input.overwrite && <span className="badge small">overwrite</span>}
                  </td>
                  <td>{isClear(input) ? <em>clear block</em> : formatShift(input.time_in, input.time_out)}</td>
                  <td className="small">
                    {input.activities.map((a, n) => (
                      <div key={n}>
                        {a.code} {a.hours !== null && <>· {fmtHours(a.hours)}</>}
                      </div>
                    ))}
                    {input.additional !== null && <div>add {fmtHours(input.additional)}</div>}
                  </td>
                  <td>{fmtHours(p?.effective)}</td>
                  <td>{p && p.ot_raw !== null && p.ot_raw > 0 ? fmtHours(p.ot_raw) : "—"}</td>
                  <td>{p ? (p.zidle ? fmtHours(p.zidle) : "—") : ""}</td>
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
                            Overwrite existing
                          </button>
                        )}
                        {plan.ok && <span className="ok-text small">ready</span>}
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
        <button className="primary" disabled={!ready} onClick={() => onCommit(false)}>
          Write {items.length} {items.length === 1 ? "entry" : "entries"} to Excel
        </button>
        <button disabled={busy} onClick={() => onCommit(true)}>
          Check again
        </button>
        <button className="link" disabled={busy} onClick={onClear}>
          Empty queue
        </button>
        {blocked > 0 && <span className="error-text">{blocked} with errors (red) cannot be written.</span>}
        {unconfirmed > 0 && <span className="warn-text">{unconfirmed} need warnings confirmed (tick them).</span>}
      </div>
    </section>
  );
}

export function CommitResultView({ result, onClose }: { result: CommitResult; onClose: () => void }) {
  const bad = result.readback.filter((r) => !r.ok);
  const title = {
    written: `Written: ${result.readback.length} entries in ${result.seconds}s (batch ${result.batch_id})`,
    unchanged: "Nothing to write: Excel already holds these values.",
    rejected: "Not written: some entries have problems (see the queue).",
    dry_run: "Checked: all entries can be written.",
    failed: `Failed: ${result.error}`,
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
            ? `${bad.length} read-back mismatches: Excel shows something other than the preview.`
            : "Excel's recalculated values match the preview for every entry."}
          {result.backup && <span className="muted"> Backup: {result.backup}</span>}
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
