import { useState, type ReactNode } from "react";
import type { PlacesView } from "../api";
import { CardHelp } from "./CardHelp";

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
  const [more, setMore] = useState(false);
  const [onlyEmpty, setOnlyEmpty] = useState(false); // Codes & registration: just the endings with no name
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
  const listed = view.places.filter((p) => more || MAIN(p) || p.name);
  const hidden = view.places.length - listed.length;
  // grouped by the saved names (rows do not jump while a name is typed): to name first, then named
  const toName = listed.filter((p) => !p.name), named = listed.filter((p) => p.name);
  const groups: [string, typeof listed][] = edit ? (onlyEmpty ? [["Need a name", toName]] : [["Need a name", toName], ["Named", named]]) : [["", listed]];
  const usage = (p: PlacesView["places"][number]) => (
    <>
      {p.used ? <b className="num">{p.used.toLocaleString()}</b> : <span className="muted">not yet</span>}
      {p.used ? " lines" : ""}
      <span className="muted"> · {p.codes ? `${p.codes} code${p.codes === 1 ? "" : "s"}` : "no code yet"}</span>
    </>
  );
  const intro: ReactNode = (
    <>
      The end of a code tells where the work was done, e.g. <b>{view.places[0]?.example}</b>. Name the places
      {view.project ? (
        <>
          {" "}
          of project <b>{view.project.toUpperCase()}</b>
        </>
      ) : null}{" "}
      once and the entry screen shows them next to the codes.{" "}
    </>
  );

  return (
    <section className="card places-card">
      <h2>
        Places in the activity codes {edit && <span className="h-count">{view.places.filter((p) => p.name).length} named</span>}
      </h2>
      {edit ? (
        <>
          <CardHelp id="places">
            {intro}Change a name, empty a box to remove it, or add an ending that new codes will use. The names are kept for every workbook of the
            project.
          </CardHelp>
          <div className="places-filter">
            <span className="seg" role="group" aria-label="Which endings">
              <button className={!onlyEmpty ? "active" : ""} aria-pressed={!onlyEmpty} onClick={() => setOnlyEmpty(false)}>
                All <span className="seg-n">{listed.length}</span>
              </button>
              <button className={onlyEmpty ? "active" : ""} aria-pressed={onlyEmpty} onClick={() => setOnlyEmpty(true)}>
                Need a name <span className={`seg-n${toName.length ? " warn" : ""}`}>{toName.length}</span>
              </button>
            </span>
            <span className="muted small">{more ? "every ending in the code list" : "used this month, or named"}</span>
          </div>
        </>
      ) : (
        <p className="muted">
          {intro}Leave a box empty if you don't know it. This is asked only once; you can change the names any time on the Codes &amp; registration
          tab.
        </p>
      )}
      <table className="places">
        <thead>
          <tr>
            <th>Ends with</th>
            <th>Place</th>
            <th className="num">Used this month</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([title, rows]) => [
            title && rows.length > 0 && (
              <tr key={`g-${title}`} className={`group-head${title === "Need a name" ? " todo" : ""}`}>
                <th colSpan={3}>
                  {title} <span className="muted">({rows.length})</span>
                </th>
              </tr>
            ),
            ...rows.map((p) => {
              const empty = !(names[p.suffix] ?? "").trim();
              return (
                <tr key={p.suffix} className={`${view.new.includes(p.suffix) ? "new " : ""}${empty ? "empty" : "filled"}`}>
                  <td>
                    <code>-{p.suffix}</code>
                  </td>
                  <td>
                    <input
                      className={empty ? "needs-name" : undefined}
                      aria-label={`Place for -${p.suffix}`}
                      value={names[p.suffix] ?? ""}
                      placeholder={edit ? "Name this place…" : "Place name"}
                      maxLength={60}
                      onChange={(e) => setNames((n) => ({ ...n, [p.suffix]: e.target.value }))}
                    />
                  </td>
                  <td className="small usage">{usage(p)}</td>
                </tr>
              );
            }),
          ])}
          {edit && onlyEmpty && !toName.length && (
            <tr>
              <td colSpan={3} className="ok-text small">
                ✓ Every ending shown has a name.
              </td>
            </tr>
          )}
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
      {hidden > 0 ? (
        <button className="link small quiet" onClick={() => setMore(true)}>
          Show {hidden} more (in one code each, not used this month)
        </button>
      ) : (
        more && (
          <button className="link small quiet" onClick={() => setMore(false)}>
            Show only the ones used this month, or named
          </button>
        )
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
