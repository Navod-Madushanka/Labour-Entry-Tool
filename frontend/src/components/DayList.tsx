import { useState } from "react";
import type { DayView, EntryView } from "../api";
import { fmtHours, formatShift } from "../time";
import { IssueList } from "./IssueList";

interface Props {
  day: DayView | undefined;
  onEdit: (v: EntryView) => void;
  onClear: (v: EntryView) => void;
}

/** Everything already on the sheet, with edit (overwrite) and clear. */
export function DayList({ day, onEdit, onClear }: Props) {
  const [q, setQ] = useState("");
  if (!day) return null;
  const query = q.trim().toLowerCase();
  const rows = day.entries.filter(
    (v) => !query || JSON.stringify(v.entry).toLowerCase().includes(query),
  );
  return (
    <section className="daylist">
      <div className="section-head">
        <h2>
          Already in Excel for this day <span className="muted">({day.entries.length})</span>
        </h2>
        <input type="search" placeholder="Find a worker" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter entries" />
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Worker</th>
                <th>In–Out</th>
                <th>Activities</th>
                <th>Worked</th>
                <th>Overtime</th>
                <th>Check</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const c = v.computed;
                return (
                  <tr key={v.entry.block}>
                    <td>
                      <b>{v.entry.calling_name}</b>
                    </td>
                    <td>{formatShift(v.entry.time_in, v.entry.time_out)}</td>
                    <td className="small">
                      {v.entry.activities
                        .filter((a) => a.code !== null || a.hours !== null)
                        .map((a, n) => (
                          <div key={n}>
                            {String(a.code ?? "?")} · {typeof a.hours === "number" ? fmtHours(a.hours) : String(a.hours ?? "")}
                          </div>
                        ))}
                    </td>
                    <td>{fmtHours(c?.effective)}</td>
                    <td>{c && c.ot_raw !== null && c.ot_raw > 0 ? fmtHours(c.ot_raw) : "—"}</td>
                    <td>
                      {v.issues.length ? <IssueList issues={v.issues} compact /> : <span className="pill ok">✓</span>}
                    </td>
                    <td className="row-actions">
                      <button className="link" onClick={() => onEdit(v)}>
                        Edit
                      </button>
                      <button className="link" onClick={() => window.confirm(`Clear ${v.entry.calling_name}'s times and hours for this day? It goes to the list above first; nothing changes until you push.`) && onClear(v)}>
                        Clear
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{day.entries.length ? "No worker matches." : "Nobody is entered for this day yet."}</p>
      )}
    </section>
  );
}
