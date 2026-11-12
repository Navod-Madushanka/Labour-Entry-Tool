import { useEffect, useRef, useState } from "react";
import { api, type Cause, type Supervisor } from "../api";

/** Optional at push: why the sheet has unallocated hours, and what disrupted the day (roadmap #5). */
export interface LostPick {
  causes: string[]; // reason for this sheet's unallocated hours
  note: string;
  dayTags: string[]; // what disrupted the day(s) pushed
}

/** Asked at each push: whose manpower sheet (paper) these entries are from. Pick a supervisor used
 * before, or type a new name. The answer is kept with the push, to find the sheet again later. */
export function SupervisorDialog({
  count,
  days,
  busy,
  idleHours = 0,
  kept = [],
  onPush,
  onCancel,
}: {
  count: number;
  days: string; // "sheet 26 (Thu 26 Nov)"
  busy: boolean;
  idleHours?: number; // unallocated (ZIDLE) hours in the entries pushed
  kept?: { name: string; count: number }[]; // entries already on a supervisor's sheet (corrections), by supervisor
  // supervisor: for the entries without one ("" when every entry keeps its own); keep: corrections stay with theirs
  onPush: (supervisor: string, lost: LostPick, keep: boolean) => void;
  onCancel: () => void;
}) {
  const [list, setList] = useState<Supervisor[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const [causes, setCauses] = useState<Cause[]>([]);
  const [reason, setReason] = useState<string[]>([]);
  const [dayTags, setDayTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [lostOpen, setLostOpen] = useState(false);

  useEffect(() => {
    api
      .supervisors()
      .then(setList)
      .catch((e) => {
        setList([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    api.lostTime().then((v) => setCauses(v.causes), () => undefined);
    box.current?.focus();
  }, []);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const lost = (): LostPick => ({ causes: reason, note: note.trim(), dayTags });

  const typed = name.replace(/\s+/g, " ").trim();
  const known = list?.find((s) => s.name.toLowerCase() === typed.toLowerCase());
  const chosen = known?.name ?? typed; // "kamal" when "Kamal" is known: the known spelling
  // corrections (e.g. an SQL UPDATE on Kamal's entries) stay with their supervisor unless asked
  const keptCount = kept.reduce((s, k) => s + k.count, 0);
  const [moveAll, setMoveAll] = useState(false);
  const keep = keptCount > 0 && !moveAll;
  const allKept = keep && keptCount >= count; // nothing new: no supervisor to choose
  const keptText = kept.map((k) => `${k.name} (${k.count})`).join(", ");
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
      onDoubleClick={() => onPush(s.name, lost(), keep)}
      disabled={busy}
    >
      {s.name}
    </button>
  );
  const push = () => {
    if ((chosen || allKept) && !busy) onPush(allKept ? chosen || "" : chosen, lost(), keep);
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
        {keptCount > 0 && (
          <div className={`sup-kept${moveAll ? " off" : ""}`}>
            <p className="small">
              {keptCount >= count ? `All ${count === 1 ? "this entry is a correction" : `${count} entries are corrections`}` : `${keptCount} of them ${keptCount === 1 ? "is a correction" : "are corrections"}`} to
              {" "}sheets pushed before: {moveAll ? "they go to the supervisor chosen below." : <>they stay with <b>{keptText}</b>.</>}
              {keptCount < count && !moveAll && ` The supervisor you choose gets the other ${count - keptCount}.`}
            </p>
            <label className="check small">
              <input type="checkbox" checked={moveAll} onChange={(e) => setMoveAll(e.target.checked)} disabled={busy} /> Give all {count} to the supervisor chosen below instead
            </label>
          </div>
        )}
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
        {causes.length > 0 && (
          <details className="lost-pick" open={lostOpen} onToggle={(e) => setLostOpen((e.target as HTMLDetailsElement).open)}>
            <summary>
              Lost time (optional){reason.length || dayTags.length ? ` · ${reason.length + dayTags.length} picked` : ""}
              {idleHours > 0 && <span className="badge warn small">{Math.round(idleHours * 10) / 10} h unallocated on this sheet</span>}
            </summary>
            {idleHours > 0 && (
              <div className="lost-row" role="group" aria-label="Reason for the unallocated hours">
                <span className="muted small">Why are {Math.round(idleHours * 10) / 10} h unallocated on this sheet?</span>
                <span className="lost-chips">
                  {causes.map((c) => (
                    <button key={c.id} type="button" className={`chip${reason.includes(c.id) ? " on" : ""}`} aria-pressed={reason.includes(c.id)} onClick={() => setReason((r) => toggle(r, c.id))}>
                      {c.label}
                    </button>
                  ))}
                </span>
              </div>
            )}
            <div className="lost-row" role="group" aria-label="What disrupted the day">
              <span className="muted small">Was the day disrupted? (for the whole site, {days})</span>
              <span className="lost-chips">
                {causes.filter((c) => c.id !== "other").map((c) => (
                  <button key={c.id} type="button" className={`chip${dayTags.includes(c.id) ? " on" : ""}`} aria-pressed={dayTags.includes(c.id)} onClick={() => setDayTags((r) => toggle(r, c.id))}>
                    {c.label}
                  </button>
                ))}
              </span>
            </div>
            <input aria-label="Lost time note" placeholder="Note (optional), e.g. pump broke at 10:00" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            <p className="muted small">Kept with this push as evidence of lost time (who caused it); Excel is not changed.</p>
          </details>
        )}
        {error && <p className="error-text small">{error}</p>}
        <div className="actions">
          <button className="primary" disabled={!(chosen || allKept) || busy} onClick={push}>
            {busy
              ? "Writing…"
              : allKept && !chosen
                ? `Push ${count} ${count === 1 ? "correction" : "corrections"}, keeping ${kept.length === 1 ? kept[0].name : "their supervisors"}`
                : chosen
                  ? keep
                    ? `Push ${count} ${count === 1 ? "entry" : "entries"}: ${count - keptCount > 0 ? `${count - keptCount} for ${chosen}, ` : ""}${keptCount} kept`
                    : `Push ${count} ${count === 1 ? "entry" : "entries"} for ${chosen}`
                  : "Choose the supervisor"}
          </button>
        </div>
      </div>
    </div>
  );
}
