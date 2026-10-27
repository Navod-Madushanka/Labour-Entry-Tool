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
          On sheet {day.header.sheet} <span className="muted">({day.entries.length})</span>
        </h2>
        <input type="search" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter entries" />
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Worker</th>
                <th>In–Out</th>
                <th>Activities</th>
                <th>Eff.</th>
                <th>OT</th>
                <th>ZIDLE</th>
                <th>Checks</th>
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
                    <td>{c ? (c.zidle ? fmtHours(c.zidle) : "—") : ""}</td>
                    <td>
                      <IssueList issues={v.issues} compact />
                    </td>
                    <td className="row-actions">
                      <button className="link" onClick={() => onEdit(v)}>
                        Edit
                      </button>
                      <button className="link" onClick={() => onClear(v)}>
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
        <p className="muted">{day.entries.length ? "No entries match." : "Nothing entered on this sheet yet."}</p>
      )}
    </section>
  );
}
