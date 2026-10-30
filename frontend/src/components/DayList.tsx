import { useState } from "react";
import type { DayView, EntryView } from "../api";
import { fmtHours, formatShift } from "../time";
import { IssueList } from "./IssueList";

interface Props {
  day: DayView | undefined;
  recent: Map<string, { rank: number; at: string }>; // pushed with the tool: newest first, with the time
  onEdit: (v: EntryView) => void;
  onClear: (v: EntryView) => void;
}

/** Everything already on the sheet, with edit (overwrite) and clear. */
export function DayList({ day, recent, onEdit, onClear }: Props) {
  const [q, setQ] = useState("");
  if (!day) return null;
  const query = q.trim().toLowerCase();
  const rank = (v: EntryView) => (v.entry.calling_name ? recent.get(v.entry.calling_name)?.rank ?? -1 : -1);
  const rows = day.entries
    .filter((v) => !query || JSON.stringify(v.entry).toLowerCase().includes(query))
    // The latest pushed first; rows the tool has no time for (typed in Excel) after, in sheet order.
    .sort((a, b) => rank(b) - rank(a) || a.entry.block - b.entry.block);
  return (
    <section className="daylist">
      <div className="section-head">
        <h2>
          Already in Excel for this day <span className="muted">({day.entries.length}, latest first)</span>
        </h2>
        <input type="search" placeholder="Find a worker" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter entries" />
      </div>
      {rows.length ? (
        <div className="table-wrap daylist-scroll">
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
                      {v.entry.calling_name && recent.get(v.entry.calling_name) && (
                        <div className="muted small" title="Pushed with the tool at this time">
                          added {new Date(recent.get(v.entry.calling_name)!.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
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
