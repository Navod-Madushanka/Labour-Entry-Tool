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
            {list.map((s) => (
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
            ))}
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
