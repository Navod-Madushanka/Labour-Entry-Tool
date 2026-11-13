import { useEffect, useMemo, useState } from "react";
import { api, type DescriptionsView } from "../api";
import { CardHelp } from "./CardHelp";

/** Codes & registration: what each activity code is, in words. Every code starts with its
 * MasterFormat title (03-11 Concrete Forming); the office types its own where that is not right.
 * Kept per project with the place names; Excel is not changed. */
export function DescriptionsEditor({ onChanged }: { onChanged: () => void }) {
  const [view, setView] = useState<DescriptionsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = () =>
    api
      .descriptions()
      .then((v) => {
        setView(v);
        setEdits({});
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    if (!view) return [];
    const q = query.trim().toLowerCase();
    return view.codes
      .filter((r) => all || r.lines > 0 || r.custom || q)
      .filter((r) => !q || [r.code, r.standard ?? "", r.custom ?? "", edits[r.code] ?? ""].some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => b.lines - a.lines || a.code.localeCompare(b.code));
  }, [view, query, all, edits]);

  const changed = view ? view.codes.filter((r) => r.code in edits && (edits[r.code].trim() || null) !== (r.custom ?? null)) : [];

  const save = async () => {
    setBusy(true);
    setSaved(null);
    try {
      await api.saveDescriptions(Object.fromEntries(changed.map((r) => [r.code, edits[r.code].trim()])));
      await load();
      setSaved(`Saved ${changed.length} description${changed.length === 1 ? "" : "s"}. Every screen shows them now.`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card desc-card">
      <h2>
        What each activity code is {view && <span className="h-count">{view.codes.filter((r) => r.custom).length} described by you</span>}
      </h2>
      <CardHelp id="descriptions">
        Shown beside the codes in the entry screen, on the manpower sheet's Description column, in Analysis and in the Excel
        export. Each code starts with its standard MasterFormat title (03-11 Concrete Forming, 03-20 Concrete Reinforcing, …).
        Type your own where it should read differently; empty a box to go back to the standard title.
        {view?.project ? (
          <>
            {" "}
            Kept for every workbook of project <b>{view.project.toUpperCase()}</b>.
          </>
        ) : null}{" "}
        Excel is not changed.
      </CardHelp>
      {error && <p className="error-text">{error}</p>}
      {!view ? (
        <p className="muted small">Loading…</p>
      ) : (
        <>
          <div className="row desc-tools">
            <span className="search-box">
              <span aria-hidden="true">⌕</span>
              <input type="search" aria-label="Search codes" placeholder="Search a code or a word…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </span>
            <label className={`chip-toggle${all ? " on" : ""}`}>
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Also codes not used this month
              <span className="seg-n">{view.codes.filter((r) => !r.lines).length}</span>
            </label>
            <span className="muted small desc-count">
              Showing <b>{rows.length}</b> of {view.codes.length}
            </span>
          </div>
          <div className="table-wrap desc-wrap">
            <table className="places desc-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Standard title</th>
                  <th className="num">Used this month</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} className={r.custom ? "custom" : undefined}>
                    <td>
                      <code>{r.code}</code>
                    </td>
                    <td>
                      <input
                        aria-label={`Description of ${r.code}`}
                        value={edits[r.code] ?? r.custom ?? ""}
                        placeholder={r.standard ?? "Description"}
                        maxLength={80}
                        onChange={(e) => {
                          setSaved(null);
                          setEdits((x) => ({ ...x, [r.code]: e.target.value }));
                        }}
                      />
                    </td>
                    <td className="std">{r.standard ?? "—"}</td>
                    <td className="small usage">{r.lines ? <><b className="num">{r.lines.toLocaleString()}</b> lines</> : <span className="muted">not yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="muted small">No codes match.</p>}
          </div>
          <div className="actions">
            <button className="primary" disabled={busy || !changed.length} onClick={save}>
              Save {changed.length || ""} description{changed.length === 1 ? "" : "s"}
            </button>
            {saved && <span className="ok-text small">✓ {saved}</span>}
          </div>
        </>
      )}
    </section>
  );
}
