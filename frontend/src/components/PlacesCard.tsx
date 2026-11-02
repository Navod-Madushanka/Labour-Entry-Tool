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
  edit = false,
  saved,
}: {
  view: PlacesView;
  busy: boolean;
  onSave: (names: Record<string, string>) => void;
  onLater?: () => void;
  edit?: boolean; // Codes & registration: change, clear or add names at any time
  saved?: string | null; // "Saved" message after a save there
}) {
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(view.places.map((p) => [p.suffix, p.name])),
  );
  const [more, setMore] = useState(edit);
  const [added, setAdded] = useState<{ suffix: string; name: string }>({ suffix: "", name: "" });
  const addSuffix = added.suffix.trim().toUpperCase().replace(/^-+/, "");
  const addOk = /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(addSuffix) && !view.places.some((p) => p.suffix === addSuffix);
  const changed = view.places.some((p) => (names[p.suffix] ?? "") !== p.name) || (addOk && added.name.trim() !== "");
  const save = () => {
    const out = { ...names };
    if (addOk && added.name.trim()) out[addSuffix] = added.name.trim();
    onSave(out);
    setAdded({ suffix: "", name: "" });
  };
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
        once and the entry screen shows them next to the codes.{" "}
        {edit ? (
          <>
            Change a name, empty a box to remove it, or add an ending that new codes will use. The names are kept for
            every workbook of the project.
          </>
        ) : (
          <>Leave a box empty if you don't know it. This is asked only once; you can change the names any time on the Codes &amp; registration tab.</>
        )}
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
                  placeholder="Place name"
                  maxLength={60}
                  onChange={(e) => setNames((n) => ({ ...n, [p.suffix]: e.target.value }))}
                />
              </td>
              <td className="muted small">
                {p.used ? `${p.used} lines` : "not yet"} · {p.codes ? `${p.codes} code${p.codes === 1 ? "" : "s"}` : "no code in the list yet"}
              </td>
            </tr>
          ))}
          {edit && (
            <tr className="add-place">
              <td>
                <input
                  aria-label="New code ending"
                  placeholder="e.g. -S"
                  value={added.suffix}
                  size={8}
                  maxLength={12}
                  onChange={(e) => setAdded((a) => ({ ...a, suffix: e.target.value }))}
                />
              </td>
              <td>
                <input
                  aria-label="Place for the new ending"
                  placeholder="e.g. Skywalk"
                  value={added.name}
                  maxLength={60}
                  onChange={(e) => setAdded((a) => ({ ...a, name: e.target.value }))}
                />
              </td>
              <td className="muted small">
                {added.suffix && !addOk
                  ? view.places.some((p) => p.suffix === addSuffix)
                    ? "already in the list above"
                    : "letters and numbers, like S or C-8"
                  : "add an ending"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {hidden > 0 && (
        <button className="link" onClick={() => setMore(true)}>
          Show {hidden} more (in one code each, not used this month)
        </button>
      )}
      <div className="actions">
        <button className="primary" disabled={busy || (edit && !changed)} onClick={save}>
          Save place names
        </button>
        {saved && <span className="ok-text small">✓ {saved}</span>}
        {onLater && (
          <button disabled={busy} onClick={onLater}>
            Close
          </button>
        )}
      </div>
    </section>
  );
}
