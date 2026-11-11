import { useEffect, useRef, useState } from "react";
import { api, type Supervisor } from "../api";

/** Asked at each push: whose manpower sheet (paper) these entries are from. Pick a supervisor used
 * before, or type a new name. The answer is kept with the push, to find the sheet again later. */
export function SupervisorDialog({
  count,
  days,
  busy,
  onPush,
  onCancel,
}: {
  count: number;
  days: string; // "sheet 26 (Thu 26 Nov)"
  busy: boolean;
  onPush: (supervisor: string) => void;
  onCancel: () => void;
}) {
  const [list, setList] = useState<Supervisor[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .supervisors()
      .then(setList)
      .catch((e) => {
        setList([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    box.current?.focus();
  }, []);

  const typed = name.replace(/\s+/g, " ").trim();
  const known = list?.find((s) => s.name.toLowerCase() === typed.toLowerCase());
  const chosen = known?.name ?? typed; // "kamal" when "Kamal" is known: the known spelling
  // Recent: the last three used, on top; then everyone else A–Z, a row per first letter. Typing a
  // name that is not on the list yet narrows the buttons to the ones containing it.
  const filtering = Boolean(typed) && !known;
  const shown = (list ?? []).filter((s) => !filtering || s.name.toLowerCase().includes(typed.toLowerCase()));
  const recent = (list ?? []).filter((s) => s.last_used).slice(0, 3).filter((s) => shown.includes(s)); // the server lists them latest first
  const letters: [string, Supervisor[]][] = [];
  for (const s of shown.filter((x) => !recent.includes(x)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))) {
    const letter = /[a-z]/i.test(s.name[0]) ? s.name[0].toUpperCase() : "#";
    const row = letters[letters.length - 1];
    if (row && row[0] === letter) row[1].push(s);
    else letters.push([letter, [s]]);
  }
  const chip = (s: Supervisor) => (
    <button
      key={s.name}
      role="radio"
      aria-checked={chosen === s.name}
      className={`chip${chosen === s.name ? " on" : ""}`}
      onClick={() => setName(s.name)}
      onDoubleClick={() => onPush(s.name)}
      disabled={busy}
    >
      {s.name}
    </button>
  );
  const push = () => {
    if (chosen && !busy) onPush(chosen);
  };

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}>
      <div className="modal supervisor-dialog" role="dialog" aria-label="Whose manpower sheet is this?">
        <div className="section-head">
          <h2>Whose manpower sheet is this?</h2>
          <button className="link" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
        <p className="muted small">
          Pushing {count} {count === 1 ? "entry" : "entries"} for {days}. They are kept under the supervisor you choose,
          so this sheet can be found again on the Supervisors page and compared with the paper.
        </p>
        {list && list.length > 0 && (
          <div className="sup-choices" role="radiogroup" aria-label="Supervisors">
            {recent.length > 0 && (
              <div className="sup-row" role="group" aria-label="Recent supervisors">
                <span className="sup-row-label">Recent</span>
                <span className="sup-row-chips">{recent.map(chip)}</span>
              </div>
            )}
            {letters.map(([letter, names]) => (
              <div key={letter} className="sup-row" role="group" aria-label={`Supervisors ${letter}`}>
                <span className="sup-row-label">{letter}</span>
                <span className="sup-row-chips">{names.map(chip)}</span>
              </div>
            ))}
            {filtering && !recent.length && !letters.length && <p className="muted small">No supervisor on the list matches "{typed}".</p>}
          </div>
        )}
        <label className="field">
          {list?.length ? "Or type the name" : "Supervisor's name"}
          <input
            ref={box}
            aria-label="Supervisor"
            value={name}
            maxLength={80}
            disabled={busy}
            placeholder="e.g. Kamal"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && push()}
          />
        </label>
        {typed && !known && list && <p className="muted small">New supervisor: {typed} is added to the list.</p>}
        {error && <p className="error-text small">{error}</p>}
        <div className="actions">
          <button className="primary" disabled={!chosen || busy} onClick={push}>
            {busy
              ? "Writing…"
              : chosen
                ? `Push ${count} ${count === 1 ? "entry" : "entries"} for ${chosen}`
                : "Choose the supervisor"}
          </button>
        </div>
      </div>
    </div>
  );
}
