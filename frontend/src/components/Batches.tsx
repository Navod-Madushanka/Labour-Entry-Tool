import type { Batch } from "../api";

interface Props {
  quiet?: boolean; // under configuration cards: lighter, so it does not compete with them
  batches: Batch[];
  busy: boolean;
  onUndo: (b: Batch) => void;
}

/** Recent writes from the audit log, each undoable while its cells are unchanged. */
export function Batches({ batches, busy, onUndo, quiet = false }: Props) {
  if (!batches.length) return null;
  return (
    <section className={`batches${quiet ? " quiet" : ""}`}>
      <h2>
        Recent batches <span className="muted">({batches.length})</span>
      </h2>
      <ul className="batches-scroll">
        {batches.map((b) => (
          <li key={b.id} className={b.undone_by ? "undone" : ""}>
            <span>
              <b className="batch-id">#{b.id}</b>{" "}
              <b className="batch-what">
                {b.kind === "undo" ? `undo of #${b.undo_of}` : ["header fix", "employee codes", "new worker"].includes(b.note ?? "") ? b.note : "write"}
              </b>{" "}
              · sheet {b.sheets.join(", ")} · {b.cells} cells{" "}
              <span className="batch-meta">
                · {new Date(b.created_at).toLocaleTimeString()} · {b.user}
              </span>
              {b.calling_names.length > 0 && (
                <span className="muted small">
                  {" "}
                  ({b.calling_names.slice(0, 6).join(", ")}
                  {b.calling_names.length > 6 ? ` +${b.calling_names.length - 6}` : ""})
                </span>
              )}
              {b.status !== "done" && <span className="badge warn small">{b.status}</span>}
              {b.undone_by && <span className="badge small">undone by #{b.undone_by}</span>}
            </span>
            {b.kind === "write" && !b.undone_by && (
              <button disabled={busy} onClick={() => onUndo(b)}>
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
