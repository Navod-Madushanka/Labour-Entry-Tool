import { useEffect, useMemo, useState } from "react";
import { api, type DayBuild, type EntryInput } from "../api";
import { effectiveHours, fmtHours, formatClock, parseClock } from "../time";

interface CrewState {
  id: number;
  timeIn: string;
  timeOut: string;
  acts: { code: string; hours: number | null }[]; // null hours = all effective hours
  members: { name: string; from: string; ticked: boolean }[];
}

interface Props {
  sheet: string;
  onQueue: (entries: EntryInput[]) => void;
  onClose: () => void;
}

let nextId = 1;

/** Start a sheet from the previous days: crews of identical entries, edited once for all. */
export function DayBuilder({ sheet, onQueue, onClose }: Props) {
  const [build, setBuild] = useState<DayBuild | null>(null);
  const [crews, setCrews] = useState<CrewState[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dayBuild(sheet)
      .then((b) => {
        setBuild(b);
        setCrews(
          b.crews.map((c) => ({
            id: nextId++,
            timeIn: formatClock(c.time_in),
            timeOut: formatClock(c.time_out),
            acts: c.activities.map((a) => ({ ...a })),
            members: c.members.map((m) => ({ name: m.calling_name, from: m.from_sheet, ticked: m.ticked })),
          })),
        );
      })
      .catch((e) => setError(e.message));
  }, [sheet]);

  const update = (id: number, patch: Partial<CrewState>) =>
    setCrews((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const shift = (c: CrewState): [number, number] | null => {
    const tin = parseClock(c.timeIn);
    const tout = parseClock(c.timeOut);
    if (tin === null || tout === null) return null;
    return [tin, tout <= tin ? tout + 24 : tout];
  };

  const entries = useMemo(() => {
    const out: EntryInput[] = [];
    for (const c of crews) {
      const s = shift(c);
      if (!s) continue;
      const eff = effectiveHours(s[0], s[1]);
      for (const m of c.members.filter((m) => m.ticked)) {
        out.push({
          sheet,
          calling_name: m.name,
          time_in: s[0],
          time_out: s[1],
          activities: c.acts.filter((a) => a.code.trim()).map((a) => ({ code: a.code.trim(), hours: a.hours ?? eff })),
          additional: null,
          remark: null,
          overwrite: false,
          acknowledged: [],
        });
      }
    }
    return out;
  }, [crews, sheet]);

  const bad = crews.filter((c) => c.members.some((m) => m.ticked) && !shift(c)).length;

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal wide builder" role="dialog" aria-label="Start day from previous days">
        <div className="section-head">
          <h2>Start sheet {sheet} from previous days</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
        {!build && !error && <p className="muted">Building crews…</p>}
        {build && (
          <>
            <p className="small muted">
              Each worker's last entry (up to {build.window} days back), grouped into crews that did the same. Untick who is
              absent, change a crew's times or activity once for all its members, and split off anyone who did something
              else. Workers from yesterday and the day before start ticked.
              {build.already_entered > 0 && ` ${build.already_entered} already entered on this sheet are left out.`}
            </p>
            {build.sunday_shift && (
              <p className="notice small">
                Sunday: crews use the usual Sunday shift {formatClock(build.sunday_shift[0])}–
                {formatClock(build.sunday_shift[1])}, and last Sunday's workers are ticked.
              </p>
            )}
            {!crews.length && <p className="muted">No entries on the previous days to start from.</p>}
            <div className="crews">
              {crews.map((c) => {
                const s = shift(c);
                const ticked = c.members.filter((m) => m.ticked).length;
                return (
                  <div key={c.id} className="crew">
                    <div className="crew-head">
                      <input aria-label="Crew In" size={5} value={c.timeIn}
                             onChange={(e) => update(c.id, { timeIn: e.target.value })} />
                      –
                      <input aria-label="Crew Out" size={5} value={c.timeOut}
                             onChange={(e) => update(c.id, { timeOut: e.target.value })} />
                      {c.acts.map((a, i) => (
                        <input key={i} aria-label="Crew activity" list="activity-codes" size={16} value={a.code}
                               onChange={(e) => update(c.id, { acts: c.acts.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)) })} />
                      ))}
                      <span className="muted small">
                        {s ? `${fmtHours(effectiveHours(s[0], s[1]))} h` : <span className="error-text">bad time</span>} ·{" "}
                        {ticked}/{c.members.length}
                      </span>
                      <button className="link small" onClick={() => update(c.id, { members: c.members.map((m) => ({ ...m, ticked: ticked < c.members.length })) })}>
                        {ticked < c.members.length ? "tick all" : "untick all"}
                      </button>
                    </div>
                    <div className="chips">
                      {c.members.map((m) => (
                        <span key={m.name} className={`member${m.ticked ? "" : " off"}`}>
                          <label title={`from sheet ${m.from}`}>
                            <input type="checkbox" checked={m.ticked}
                                   onChange={() => update(c.id, { members: c.members.map((x) => (x.name === m.name ? { ...x, ticked: !x.ticked } : x)) })} />{" "}
                            {m.name}
                          </label>
                          <button className="link small" title="Did something else today: give him his own line"
                                  aria-label={`Split ${m.name}`}
                                  onClick={() =>
                                    setCrews((cs) => {
                                      const at = cs.findIndex((x) => x.id === c.id);
                                      const rest = { ...c, members: c.members.filter((x) => x.name !== m.name) };
                                      const own = { ...c, id: nextId++, acts: c.acts.map((a) => ({ ...a })), members: [{ ...m, ticked: true }] };
                                      return [...cs.slice(0, at), rest, own, ...cs.slice(at + 1)].filter((x) => x.members.length);
                                    })
                                  }>
                            ⤴
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="actions">
              <button className="primary" disabled={!entries.length || bad > 0} onClick={() => onQueue(entries)}>
                Add {entries.length} entries to the queue
              </button>
              <span className="muted small">
                They are checked like any entry; nothing is written until you press Write in the queue.
              </span>
              {bad > 0 && <span className="error-text small">{bad} crew(s) have a time that is not HH:MM.</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
