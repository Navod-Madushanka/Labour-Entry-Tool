import { useMemo, useState } from "react";
import { api, type Master } from "../api";
import { placeName, placeSuffix } from "../codes";

const CHARS = /^[A-Z0-9][A-Z0-9-]*$/;
const SHAPE = /^\d\d-\d\d-\d\d-\d\d(-[A-Z0-9]+)*$/; // the usual form; others are allowed (ZOTHE)

interface Result {
  status: "written" | "rejected" | "failed";
  added: Record<string, string>;
  problems: string[];
  mismatches: string[];
  error: string | null;
}

/** New activity codes into the Labour Detail activity list, without going to Excel. Checked here
 * as they are typed, then again on a fresh read; backed up, logged and undoable like every write. */
export function ActivityAdder({ master, user, onChanged }: { master: Master; user: string; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const have = useMemo(() => new Set(master.activities.map((a) => a.toUpperCase())), [master.activities]);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return text
      .split(/[\s,;]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean)
      .map((code) => {
        const dup = seen.has(code);
        seen.add(code);
        const problem = !CHARS.test(code) || code.length > 40
          ? "letters, digits and dashes only"
          : have.has(code)
            ? "already in the list"
            : dup
              ? "typed twice"
              : null;
        const suffix = placeSuffix(code);
        const note = problem
          ? null
          : !SHAPE.test(code)
            ? "not the usual NN-NN-NN-NN form: check it"
            : suffix && !master.places[suffix]
              ? `new place ending -${suffix} (name it under Place names on the start page)`
              : placeName(code, master.places);
        return { code, problem, note };
      });
  }, [text, have, master.places]);
  const ok = rows.filter((r) => !r.problem);

  const add = async () => {
    if (!ok.length) return;
    const list = ok.map((r) => r.code).join("\n");
    if (!window.confirm(`Add ${ok.length} activity code${ok.length === 1 ? "" : "s"} to the list in Labour Detail (column L)?\n\n${list}\n\nA backup is made first; you can undo the batch.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res: Result = await api.addActivities(ok.map((r) => r.code), user);
      setResult(res);
      if (res.status === "written") {
        setText("");
        onChanged();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="activity-adder">
      <div className="section-head">
        <h2>
          Activity codes <span className="muted">({master.activities.length} in the list)</span>
        </h2>
      </div>
      <p className="muted small">
        Add new codes to the activity list in Labour Detail without opening Excel. Each goes into the next empty cell of
        column L and can be used in entries straight away.
      </p>
      <div className="field">
        <label htmlFor="new-codes">New codes (one per line, or separated by commas)</label>
        <textarea id="new-codes" rows={3} value={text} disabled={busy} placeholder="e.g. 03-31-05-35-P" onChange={(e) => { setText(e.target.value); setResult(null); }} />
      </div>
      {rows.length > 0 && (
        <ul className="new-codes">
          {rows.map((r, i) => (
            <li key={`${r.code}-${i}`} className={r.problem ? "bad" : ""}>
              <code>{r.code}</code>{" "}
              {r.problem ? <span className="error-text small">{r.problem}</span> : r.note ? <span className="muted small">{r.note}</span> : <span className="ok-text small">✓</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button className="primary" disabled={busy || !ok.length || !user} onClick={add}>
          {busy ? "Adding…" : `Add ${ok.length || ""} code${ok.length === 1 ? "" : "s"} to Labour Detail`}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {result && (
        <div className={`banner ${result.status === "written" ? "OK" : "BLOCK"}`} role="status">
          {result.status === "written" ? (
            <p>
              ✓ Added {Object.entries(result.added).map(([cell, code]) => `${code} (${cell})`).join(", ")}. Not saved in Excel yet:
              press <b>Save Excel file</b> when you are done.
              {result.mismatches.length > 0 && <span className="warn-text"> Check: {result.mismatches.join("; ")}</span>}
            </p>
          ) : (
            <p>{result.error ?? result.problems.join(" ")}</p>
          )}
        </div>
      )}
    </section>
  );
}
