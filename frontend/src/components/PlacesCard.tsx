import { useState } from "react";
import type { PlacesView } from "../api";

const MAIN = (p: PlacesView["places"][number]) => p.used > 0 || p.codes > 1;

/** Name the place suffixes of the activity codes ("-P" -> Parking area), once per project. Saved
 * for every workbook of the project; only suffixes added to the list later are asked again. */
export function PlacesCard({
  view,
  busy,
  onSave,
  onLater,
}: {
  view: PlacesView;
  busy: boolean;
  onSave: (names: Record<string, string>) => void;
  onLater?: () => void;
}) {
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(view.places.map((p) => [p.suffix, p.name])),
  );
  const [more, setMore] = useState(false);
  const shown = view.places.filter((p) => more || MAIN(p) || p.name);
  const hidden = view.places.length - shown.length;

  return (
    <section className="card places-card">
      <h2>Places in the activity codes</h2>
      <p className="muted">
        The end of a code tells where the work was done, e.g. <b>{view.places[0]?.example}</b>. Name the places
        {view.project ? (
          <>
            {" "}
            of project <b>{view.project.toUpperCase()}</b>
          </>
        ) : null}{" "}
        once and the entry screen shows them next to the codes. Leave a box empty if you don't know it. This is
        asked only once; you can change the names later with <i>Place names</i> above.
      </p>
      <table className="places">
        <thead>
          <tr>
            <th>Ends with</th>
            <th>Place</th>
            <th className="muted small">Used this month</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => (
            <tr key={p.suffix} className={view.new.includes(p.suffix) ? "new" : undefined}>
              <td>
                <code>-{p.suffix}</code>
              </td>
              <td>
                <input
                  aria-label={`Place for -${p.suffix}`}
                  value={names[p.suffix] ?? ""}
                  placeholder={`e.g. ${p.example}`}
                  maxLength={60}
                  onChange={(e) => setNames((n) => ({ ...n, [p.suffix]: e.target.value }))}
                />
              </td>
              <td className="muted small">
                {p.used ? `${p.used} lines` : "not yet"} · {p.codes} code{p.codes === 1 ? "" : "s"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && (
        <button className="link" onClick={() => setMore(true)}>
          Show {hidden} more (in one code each, not used this month)
        </button>
      )}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => onSave(names)}>
          Save place names
        </button>
        {onLater && (
          <button disabled={busy} onClick={onLater}>
            Close
          </button>
        )}
      </div>
    </section>
  );
}
