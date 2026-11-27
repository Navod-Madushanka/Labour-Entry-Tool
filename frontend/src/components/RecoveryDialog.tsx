// Recover from the tool's own change log (backend/app/recovery.py): entries the tool pushed that
// are not in the open workbook any more (a crash before a save, Excel's recovered copy, an older
// file) are listed and go back onto the manpower sheet, to check and push again. Entries changed
// in Excel since are shown, never touched. Nothing is written here.
import { useEffect, useState } from "react";
import { api, type EntryInput, type RecoveryResult, type SnapshotsView } from "../api";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function RecoveryDialog({ waiting, onRestore, onClose }: {
  waiting: Set<string>; // "sheet|calling name" already waiting on the manpower sheet
  onRestore: (inputs: EntryInput[]) => void;
  onClose: () => void;
}) {
  const [res, setRes] = useState<RecoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  useEffect(() => {
    api
      .recovery()
      .then((r) => {
        setRes(r);
        setPicked(new Set(r.lost.map((_, i) => i).filter((i) => !waiting.has(`${r.lost[i].sheet}|${r.lost[i].calling_name}`))));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lost = res?.lost ?? [];
  const n = picked.size;
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal wide recovery-dialog" role="dialog" aria-label="Recover pushed entries">
        <div className="section-head">
          <h2>Recover pushed entries</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted small">
          Everything the tool pushed is in its change log on this PC. This compares it with the workbook open now: entries that are
          not in it any more (a crash before a save, Excel's recovered copy, an older file) can go back onto the manpower sheet, to check
          and push again. Entries changed in Excel since are only shown. Nothing is written until you push.
        </p>
        {error && <p className="error-text">{error}</p>}
        {!res && !error && (
          <p className="muted" role="status">
            <span className="spinner" aria-hidden /> Reading the day sheets the tool has written to…
          </p>
        )}
        {res && (
          <>
            <div className="recovery-sum" role="status">
              <span className="ok">
                <b>{res.present}</b> present
              </span>
              <span className={lost.length ? "bad" : "ok"}>
                <b>{lost.length}</b> lost
              </span>
              <span className="muted">
                <b>{res.changed.length}</b> changed in Excel since
              </span>
              <span className="muted small">
                of {res.entries} worker-days from {res.pushes} push{res.pushes === 1 ? "" : "es"} to {res.workbook}
              </span>
            </div>
            {res.other_names.length > 0 && (
              <p className="small">
                Includes pushes made while this workbook was open as <b>{res.other_names.join(", ")}</b>.
              </p>
            )}
            {lost.length === 0 ? (
              <p className="ok-text">✓ Everything the tool pushed is in this workbook.</p>
            ) : (
              <div className="table-wrap recovery-table">
                <table className="data">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="All"
                          checked={n === lost.length}
                          onChange={(e) => setPicked(new Set(e.target.checked ? lost.map((_, i) => i) : []))}
                        />
                      </th>
                      <th>Sheet</th>
                      <th>Worker</th>
                      <th>As pushed</th>
                      <th>Pushed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lost.map((l, i) => {
                      const already = waiting.has(`${l.sheet}|${l.calling_name}`);
                      return (
                        <tr key={`${l.sheet}|${l.calling_name}`} className={already ? "muted" : ""}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Recover ${l.calling_name} on sheet ${l.sheet}`}
                              checked={picked.has(i)}
                              onChange={(e) =>
                                setPicked((p) => {
                                  const q = new Set(p);
                                  if (e.target.checked) q.add(i);
                                  else q.delete(i);
                                  return q;
                                })
                              }
                            />
                          </td>
                          <td>{l.sheet}</td>
                          <td>
                            <b>{l.calling_name}</b>
                            {already && <span className="small"> · already waiting</span>}
                          </td>
                          <td className="small">{l.what}</td>
                          <td className="small muted">
                            {when(l.pushed_at)} · {l.user}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {res.changed.length > 0 && (
              <details className="small">
                <summary>{res.changed.length} changed in Excel since (left as they are)</summary>
                <ul>
                  {res.changed.map((c) => (
                    <li key={`${c.sheet}|${c.calling_name}`}>
                      Sheet {c.sheet} · <b>{c.calling_name}</b>: {c.why} (pushed {when(c.pushed_at)})
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <Snapshots />
            <div className="actions">
              <button
                className="primary"
                disabled={!n}
                onClick={() => {
                  onRestore(lost.filter((_, i) => picked.has(i)).map((l) => l.input));
                  onClose();
                }}
              >
                Put {n} {n === 1 ? "entry" : "entries"} back on the manpower sheet
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Whole copies of the workbook, kept by the tool every few minutes when it changed: for what
 * the change log cannot know (typed straight into Excel). Opened as a separate workbook. */
function Snapshots() {
  const [v, setV] = useState<SnapshotsView | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<SnapshotsView | unknown>, after?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await f();
      if (r && typeof r === "object" && "items" in r) setV(r as SnapshotsView);
      if (after) setMsg(after);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    api.snapshots().then(setV, (e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, []);
  if (!v) return msg ? <p className="error-text small">{msg}</p> : null;
  return (
    <details className="snapshots" open>
      <summary>
        Whole copies of the workbook <span className="muted small">({v.items.length})</span>
      </summary>
      <p className="muted small">
        Also for what the change log cannot know (typed straight into Excel): every {v.every_min} minutes, when the workbook changed, the
        tool keeps a whole copy (the newest 12, plus one a day for two weeks). A copy opens as a separate workbook: copy what you need
        from it; the workbook in use is not touched. Kept in <code>{v.folder}</code>.
      </p>
      <label className="check small">
        <input type="checkbox" checked={v.on} disabled={busy} onChange={(e) => run(() => api.snapshotsSwitch(e.target.checked))} /> Keep a
        copy every {v.every_min} minutes when the workbook changed
      </label>
      {v.note && <p className="warn-text small">{v.note}</p>}
      {v.items.length ? (
        <div className="table-wrap snapshot-list">
          <table className="data">
            <tbody>
              {v.items.map((s) => (
                <tr key={s.file}>
                  <td>{when(s.at)}</td>
                  <td className="muted small">{s.size_mb} MB</td>
                  <td>
                    <button className="small" disabled={busy} onClick={() => run(() => api.snapshotOpen(s.file), `Opened ${s.file} in Excel.`)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">No copies yet.</p>
      )}
      <div className="row">
        <button className="small" disabled={busy} onClick={() => run(() => api.snapshotTake(), "A copy was made.")}>
          Make a copy now
        </button>
        <button className="link small" disabled={busy} onClick={() => run(() => api.snapshotOpen(), "Opened the folder.")}>
          Show folder
        </button>
      </div>
      {msg && <p className="small muted">{msg}</p>}
    </details>
  );
}
