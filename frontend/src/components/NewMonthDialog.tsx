import { useEffect, useRef, useState } from "react";
import { api, type NewMonthPreview, type NewMonthResult, type SetupState } from "../api";

/** Start the next month from the open workbook: a folder named after the month, a copy of the
 * workbook under the name the user chooses, only the entries cleared, the new dates set. */
export function NewMonthDialog({ onCancel, onDone }: { onCancel: () => void; onDone: (s: SetupState) => void }) {
  const [pre, setPre] = useState<NewMonthPreview | null>(null);
  const [month, setMonth] = useState("");
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [edited, setEdited] = useState({ folder: false, name: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<NewMonthResult | null>(null);
  const first = useRef(true);

  const preview = (m?: string, f?: string, n?: string) =>
    api
      .newMonthPreview({ month: m || undefined, folder: f || undefined, name: n || undefined })
      .then((p) => {
        setPre(p);
        setMonth(p.month);
        if (!f) setFolder(p.folder ?? "");
        if (!n) setName(p.name ?? "");
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    preview();
  }, []);
  // a new month suggests a new folder and name (unless typed by hand)
  useEffect(() => {
    if (first.current || !month) {
      first.current = false;
      return;
    }
    preview(month, edited.folder ? folder : undefined, edited.name ? name : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await api.newMonth({ month, folder, name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const saveFirst = async () => {
    try {
      await api.save();
      await preview(month, folder, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}>
      <div className="modal new-month" role="dialog" aria-label="Start the next month">
        <div className="section-head">
          <h2>Start the next month</h2>
          {!busy && !done && (
            <button className="link" onClick={onCancel}>
              Close
            </button>
          )}
        </div>
        {done ? (
          <>
            <p className="ok-text">
              ✓ <b>{done.path}</b> is ready.
            </p>
            <ul className="small">
              <li>{done.entries_cleared.toLocaleString()} entries cleared on {done.sheets} day sheets; dates and day types set for the new month.</li>
              <li>Labour Detail kept: {done.workers} workers, the activity codes and every formula.</li>
              <li>The old month's file is not changed.</li>
            </ul>
            <p className="muted small">Next: the tool checks the new workbook (dates, day types). Add this month's holidays there if there are any.</p>
            <div className="actions">
              <button className="primary" onClick={() => onDone(done.state)}>
                Work on the new month
              </button>
            </div>
          </>
        ) : !pre ? (
          <p className="muted">{error ?? "Looking at the workbook…"}</p>
        ) : (
          <>
            <p className="muted small">
              Makes a folder for the month, copies <b>{pre.source}</b> into it under the name below, and clears only the
              entries: In/Out, activity codes and hours, additional hours and remarks on every day sheet. Labour Detail
              (workers, employee codes, activity list), formulas, summary and time card sheets stay. Each day sheet gets the
              new month's date and day type. The old file is not changed.
            </p>
            <div className="nm-fields">
              <label>
                Month
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} disabled={busy} />
              </label>
              <label className="wide">
                Folder <span className="muted small">{pre.folder_exists ? "(already there: the file goes into it)" : "(made new)"}</span>
                <input
                  value={folder}
                  onChange={(e) => {
                    setFolder(e.target.value);
                    setEdited((x) => ({ ...x, folder: true }));
                  }}
                  onBlur={() => preview(month, folder, name)}
                  disabled={busy}
                  spellCheck={false}
                />
              </label>
              <label className="wide">
                File name
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setEdited((x) => ({ ...x, name: true }));
                  }}
                  onBlur={() => preview(month, folder, name)}
                  disabled={busy}
                  spellCheck={false}
                />
              </label>
            </div>
            <ul className="small nm-summary">
              <li>From: {pre.source_path ?? pre.source}</li>
              <li>
                Keeps: {pre.workers} workers and {pre.activity_codes} activity codes in Labour Detail
              </li>
            </ul>
            {pre.problem && <p className="error-text">{pre.problem}</p>}
            {pre.file_exists && <p className="error-text">A file with this name is already in that folder. Choose another name.</p>}
            {pre.unsaved && !pre.problem && (
              <div className="banner WARN">
                <p>This workbook has changes not saved in Excel. Save it first, so the new month starts from the saved file.</p>
                <div className="actions">
                  <button onClick={saveFirst}>Save Excel file now</button>
                </div>
              </div>
            )}
            {error && <p className="error-text">{error}</p>}
            <div className="actions">
              <button className="primary" onClick={create} disabled={busy || Boolean(pre.problem) || pre.file_exists || pre.unsaved || !name.trim() || !folder.trim()}>
                {busy ? <><span className="spinner" aria-hidden /> Making {pre.month_label}… (copying, clearing, saving)</> : `Create ${pre.month_label}`}
              </button>
              {!busy && (
                <button className="link" onClick={onCancel}>
                  Cancel
                </button>
              )}
            </div>
            {busy && <p className="muted small">With Excel this can take a minute on a slow PC. Leave Excel alone until it is done.</p>}
          </>
        )}
      </div>
    </div>
  );
}
