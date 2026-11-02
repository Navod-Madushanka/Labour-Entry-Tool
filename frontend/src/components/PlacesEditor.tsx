import { useEffect, useState } from "react";
import { api, type PlacesView } from "../api";
import { PlacesCard } from "./PlacesCard";

/** Codes & registration: the place names of the code endings, to change at any time (the start
 * page asks them once when a project's workbook is first opened). */
export function PlacesEditor({ onChanged }: { onChanged: () => void }) {
  const [view, setView] = useState<PlacesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // a fresh card after each save (its boxes start from the saved names)
  const load = () =>
    api
      .setupPlaces()
      .then((v) => {
        setView(v);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    load();
  }, []);
  if (error)
    return (
      <section className="card places-card">
        <h2>Places in the activity codes</h2>
        <p className="error-text">{error}</p>
        <button className="link" onClick={load}>
          Try again
        </button>
      </section>
    );
  if (!view)
    return (
      <section className="card places-card">
        <h2>Places in the activity codes</h2>
        <p className="muted small">Loading…</p>
      </section>
    );
  return (
    <PlacesCard
      key={version}
      view={view}
      busy={busy}
      edit
      saved={saved}
      onSave={async (names) => {
        setBusy(true);
        setSaved(null);
        try {
          await api.saveSetupPlaces(names);
          await load();
          setVersion((x) => x + 1);
          setSaved("Saved. The entry screen shows the new names.");
          onChanged();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
