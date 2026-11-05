import { useEffect, useMemo, useState } from "react";
import { api, type Master, type Owned, type Review, type Supervisor } from "../api";
import type { Month } from "../history";
import { fingerprint, ManpowerRecord, recordColumns } from "./ManpowerSheet";

type ReviewState = "todo" | "ok" | "problem" | "changed";
const REVIEW_LABEL: Record<ReviewState, string> = {
  todo: "Not reviewed",
  ok: "✓ Matches the paper",
  problem: "⚠ Problem",
  changed: "Changed since review",
};


interface Group {
  key: string; // "26|Kamal"
  sheet: string;
  supervisor: string;
  owned: Owned[];
  last: string; // latest push
  users: string[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const dayText = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "";

/** Each day's entries by supervisor (whose manpower sheet they came from, given at push): find a
 * supervisor's sheet again and compare it with the paper. */
export function Supervisors({ master, month, user }: { master: Master; month: Month; user: string }) {
  const [owned, setOwned] = useState<Owned[] | null>(null);
  const [names, setNames] = useState<Supervisor[]>([]);
  const [who, setWho] = useState(""); // "" = everyone
  const [sheet, setSheet] = useState(""); // "" = every day
  const [open, setOpen] = useState<string[]>([]); // groups shown as sheets
  const [error, setError] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");
  const [reviewFilter, setReviewFilter] = useState<"" | ReviewState>("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [renaming, setRenaming] = useState<{
    old: string;
    text: string;
  } | null>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const load = () => {
    api.supervisorSheets().then(setOwned).catch(fail);
    api.supervisors().then(setNames).catch(fail);
    api.supervisorReviews().then(setReviews).catch(fail);
  };
  useEffect(load, []);

  const groups = useMemo(() => {
    const by = new Map<string, Group>();
    for (const o of owned ?? []) {
      const key = `${o.sheet}|${o.supervisor}`;
      const g = by.get(key) ?? {
        key,
        sheet: o.sheet,
        supervisor: o.supervisor,
        owned: [],
        last: o.created_at,
        users: [],
      };
      g.owned.push(o);
      if (o.created_at > g.last) g.last = o.created_at;
      if (!g.users.includes(o.user)) g.users.push(o.user);
      by.set(key, g);
    }
    return [...by.values()].sort(
      (a, b) => Number(b.sheet) - Number(a.sheet) || a.supervisor.localeCompare(b.supervisor),
    );
  }, [owned]);

  // review state of each sheet: its latest review, and whether the sheet changed since
  const reviewOf = useMemo(() => new Map(reviews.map((r) => [`${r.sheet}|${r.supervisor}`, r])), [reviews]);
  const state = (g: Group): { state: ReviewState; review?: Review; fp: string } => {
    const fp = fingerprint(recordColumns(g.owned, month[g.sheet]));
    const r = reviewOf.get(g.key);
    if (!r || r.status === "cleared") return { state: "todo", fp };
    return { state: r.fingerprint === fp ? r.status : "changed", review: r, fp };
  };

  // search: a worker (calling name or name), an activity code, a supervisor, a sheet number or date
  const workerName = useMemo(
    () => new Map(master.workers.map((w) => [w.calling_name, String(w.name ?? "")])),
    [master.workers],
  );
  const q = query.trim().toLowerCase();
  const hit = (g: Group, o: Owned): boolean => {
    if (!q) return false;
    const now = month[g.sheet]?.entries.find((v) => v.entry.calling_name === o.calling_name)?.entry;
    const codes = [...o.entry.activities, ...(now?.activities ?? [])].map((a) => String(a.code ?? "").toLowerCase());
    return (
      o.calling_name.toLowerCase().includes(q) ||
      (workerName.get(o.calling_name) ?? "").toLowerCase().includes(q) ||
      codes.some((c) => c.includes(q))
    );
  };
  const matches = (g: Group): boolean => {
    if (!q) return true;
    const date = month[g.sheet]?.header.date;
    const sheetHit = /^(sheet\s*)?\d+$/.test(q) ? q.replace(/\D/g, "") === g.sheet : false;
    return (
      sheetHit ||
      g.supervisor.toLowerCase().includes(q) ||
      (!!date && (date.includes(q) || dayText(date).toLowerCase().includes(q))) ||
      g.owned.some((o) => hit(g, o))
    );
  };
  const shown = groups.filter(
    (g) =>
      (!who || g.supervisor === who) &&
      (!sheet || g.sheet === sheet) &&
      (!reviewFilter || state(g).state === reviewFilter) &&
      matches(g),
  );
  const workerHits = q ? shown.flatMap((g) => g.owned.filter((o) => hit(g, o)).map((o) => ({ g, o }))) : [];
  const toReview = groups.filter((g) => state(g).state !== "ok").length;

  const review = async (g: Group, status: Review["status"]) => {
    let note: string | null = null;
    if (status === "problem") {
      note = window.prompt(`What does not match on sheet ${g.sheet} of ${g.supervisor}?`, state(g).review?.note ?? "");
      if (!note?.trim()) return;
    }
    try {
      setReviews(
        await api.reviewSheet({
          sheet: g.sheet,
          supervisor: g.supervisor,
          status,
          note,
          fingerprint: state(g).fp,
          user,
        }),
      );
    } catch (e) {
      fail(e);
    }
  };
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const g of groups) c.set(g.supervisor, (c.get(g.supervisor) ?? 0) + 1);
    return c;
  }, [groups]);
  const days = [...new Set(groups.map((g) => g.sheet))].sort((a, b) => Number(a) - Number(b));
  // entries on the chosen day that no supervisor was given for (pushed before, or typed in Excel)
  const unowned = sheet
    ? (month[sheet]?.entries ?? []).filter(
        (v) =>
          v.entry.calling_name &&
          !(owned ?? []).some((o) => o.sheet === sheet && o.calling_name === v.entry.calling_name),
      )
    : [];
  const visible = shown.length <= 3 ? shown.map((g) => g.key) : open;

  const move = async (g: Group) => {
    const to = (moveTo[g.key] ?? "").replace(/\s+/g, " ").trim();
    if (!to || to === g.supervisor) return;
    if (!window.confirm(`Give sheet ${g.sheet} of ${g.supervisor} (${g.owned.length} workers) to ${to}?`)) return;
    try {
      setOwned(
        await api.reassignSheets(
          g.owned.map((o) => o.id),
          to,
        ),
      );
      setOpen((o) => o.map((k) => (k === g.key ? `${g.sheet}|${to}` : k)));
      api.supervisors().then(setNames).catch(fail);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <section className="supervisors">
      <div className="section-head">
        <h2>Supervisors' manpower sheets</h2>
      </div>
      <p className="muted">
        At each push the tool asks whose manpower sheet it is. Here each day's entries are shown by supervisor, laid out
        like the paper, with what is in Excel now (≠ Excel: changed in Excel after the push). Undoing a push gives the
        entries back to the supervisor before it.
      </p>
      {error && <p className="error-text">{error}</p>}

      <div className="sup-filters row">
        <label className="field">
          Supervisor
          <select aria-label="Supervisor" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {names.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({counts.get(s.name) ?? 0} {counts.get(s.name) === 1 ? "sheet" : "sheets"})
              </option>
            ))}
            {[...counts.keys()]
              .filter((n) => !names.some((s) => s.name === n))
              .map((n) => (
                <option key={n} value={n}>
                  {n} ({counts.get(n)}, off the list)
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Review
          <select
            aria-label="Review"
            value={reviewFilter}
            onChange={(e) => setReviewFilter(e.target.value as "" | ReviewState)}
          >
            <option value="">All sheets</option>
            {(Object.keys(REVIEW_LABEL) as ReviewState[]).map((k) => (
              <option key={k} value={k}>
                {REVIEW_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field sup-search">
          Search
          <input
            type="search"
            aria-label="Search sheets"
            placeholder="worker, name, code, supervisor, sheet no. or date"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="field">
          Day
          <select aria-label="Day" value={sheet} onChange={(e) => setSheet(e.target.value)}>
            <option value="">Every day</option>
            {days.map((s) => (
              <option key={s} value={s}>
                Sheet {s}
                {month[s]?.header.date ? ` · ${dayText(month[s].header.date)}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {owned && groups.length > 0 && (
        <p className="small sup-summary">
          {groups.length} {groups.length === 1 ? "sheet" : "sheets"} ·{" "}
          {toReview ? <span className="warn-text">{toReview} to review</span> : "all reviewed"}
          {(q || who || sheet || reviewFilter) && (
            <>
              {" "}
              · showing {shown.length}{" "}
              <button
                className="link small"
                onClick={() => {
                  setQuery("");
                  setWho("");
                  setSheet("");
                  setReviewFilter("");
                }}
              >
                Clear
              </button>
            </>
          )}
        </p>
      )}
      {workerHits.length > 0 && (
        <p className="small sup-hits" role="status">
          Found:{" "}
          {workerHits.slice(0, 20).map(({ g, o }, i) => (
            <span key={o.id}>
              {i > 0 && ", "}
              <b>{o.calling_name}</b> on sheet {g.sheet} ({g.supervisor})
            </span>
          ))}
          {workerHits.length > 20 ? ` … and ${workerHits.length - 20} more` : ""}
        </p>
      )}
      {owned === null ? (
        <p className="muted">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="muted">
          No sheets yet. Push entries from the Entry page: the tool asks whose manpower sheet they are.
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="sup-index">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Supervisor</th>
                  <th>Workers</th>
                  <th>Changed in Excel</th>
                  <th>Review</th>
                  <th>Pushed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => {
                  const changed = recordColumns(g.owned, month[g.sheet]).filter((c) => c.note).length;
                  const isOpen = visible.includes(g.key);
                  return (
                    <tr key={g.key} className={isOpen ? "on" : undefined}>
                      <td>
                        Sheet {g.sheet} <span className="muted">{dayText(month[g.sheet]?.header.date)}</span>
                      </td>
                      <td>
                        <b>{g.supervisor}</b>
                      </td>
                      <td>{g.owned.length}</td>
                      <td>
                        {changed ? <span className="warn-text">{changed}</span> : <span className="muted">—</span>}
                      </td>
                      <td>
                        <ReviewBadge {...state(g)} />
                      </td>
                      <td className="muted small">
                        {when(g.last)} by {g.users.join(", ")}
                      </td>
                      <td>
                        {shown.length > 3 && (
                          <button
                            className="link"
                            onClick={() => setOpen((o) => (isOpen ? o.filter((k) => k !== g.key) : [...o, g.key]))}
                          >
                            {isOpen ? "Hide" : "Show sheet"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length === 0 && <p className="muted">No sheet matches.</p>}
          {unowned.length > 0 && (
            <p className="muted small">
              {unowned.length} more {unowned.length === 1 ? "entry" : "entries"} on sheet {sheet}{" "}
              {unowned.length === 1 ? "has" : "have"} no supervisor (pushed before supervisors were asked, or typed in
              Excel):{" "}
              {unowned
                .slice(0, 12)
                .map((v) => v.entry.calling_name)
                .join(", ")}
              {unowned.length > 12 ? " …" : ""}
            </p>
          )}

          <div className="manpower-pages">
            {shown
              .filter((g) => visible.includes(g.key))
              .map((g) => (
                <div key={g.key} className="mp-day" data-sheet={g.sheet} data-supervisor={g.supervisor}>
                  <ManpowerRecord
                    sheet={g.sheet}
                    day={month[g.sheet]}
                    supervisor={g.supervisor}
                    columns={recordColumns(g.owned, month[g.sheet])}
                    places={master.places}
                    activities={master.check_activities}
                    highlight={q ? (c) => g.owned.some((o) => o.calling_name === c.name && hit(g, o)) : undefined}
                    footer={
                      <>
                        <div className="sup-review">
                          <ReviewBadge {...state(g)} />
                          <button className="small" onClick={() => review(g, "ok")} disabled={state(g).state === "ok"}>
                            ✓ Matches the paper
                          </button>
                          <button className="small" onClick={() => review(g, "problem")}>
                            ⚠ Problem…
                          </button>
                          {state(g).review && (
                            <button className="link small" onClick={() => review(g, "cleared")}>
                              Take back the review
                            </button>
                          )}
                        </div>
                        <span className="sup-move">
                          {g.owned.length} {g.owned.length === 1 ? "worker" : "workers"} · pushed {when(g.last)} by{" "}
                          {g.users.join(", ")} · Wrong supervisor? Give this sheet to{" "}
                          <input
                            list="sup-names"
                            aria-label={`New supervisor for sheet ${g.sheet} of ${g.supervisor}`}
                            value={moveTo[g.key] ?? ""}
                            placeholder="name"
                            onChange={(e) =>
                              setMoveTo((m) => ({
                                ...m,
                                [g.key]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => e.key === "Enter" && move(g)}
                          />{" "}
                          <button className="small" disabled={!(moveTo[g.key] ?? "").trim()} onClick={() => move(g)}>
                            Move
                          </button>
                        </span>
                      </>
                    }
                  />
                </div>
              ))}
          </div>
        </>
      )}
      <datalist id="sup-names">
        {names.map((s) => (
          <option key={s.name} value={s.name} />
        ))}
      </datalist>

      <details className="sup-list">
        <summary>Supervisor list ({names.length})</summary>
        <p className="muted small">
          The names offered at push: the ones used most recently first. Removing a name only takes it off this list; its
          sheets keep it. Renaming changes it on every sheet too.
        </p>
        <ul>
          {names.map((s) => (
            <li key={s.name}>
              {renaming?.old === s.name ? (
                <>
                  <input
                    aria-label={`New name for ${s.name}`}
                    value={renaming.text}
                    autoFocus
                    onChange={(e) => setRenaming({ old: s.name, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setRenaming(null);
                      if (e.key === "Enter" && renaming.text.trim())
                        api
                          .renameSupervisor(s.name, renaming.text)
                          .then((l) => {
                            setNames(l);
                            setRenaming(null);
                            if (who === s.name) setWho(renaming.text.replace(/\s+/g, " ").trim());
                            api.supervisorSheets().then(setOwned).catch(fail);
                          })
                          .catch(fail);
                    }}
                  />{" "}
                  <span className="muted small">Enter to save, Esc to cancel</span>
                </>
              ) : (
                <>
                  <b>{s.name}</b>{" "}
                  <span className="muted small">{s.last_used ? `last used ${when(s.last_used)}` : "not used yet"}</span>{" "}
                  <button className="link small" onClick={() => setRenaming({ old: s.name, text: s.name })}>
                    Rename
                  </button>{" "}
                  <button
                    className="link small danger"
                    onClick={() =>
                      window.confirm(`Take ${s.name} off the list? Their sheets keep the name.`) &&
                      api.removeSupervisor(s.name).then(setNames).catch(fail)
                    }
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="row">
          <input
            aria-label="Add a supervisor"
            placeholder="Add a supervisor"
            value={newName}
            maxLength={80}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim())
                api
                  .addSupervisor(newName)
                  .then((l) => {
                    setNames(l);
                    setNewName("");
                  })
                  .catch(fail);
            }}
          />
          <button
            className="small"
            disabled={!newName.trim()}
            onClick={() =>
              api
                .addSupervisor(newName)
                .then((l) => {
                  setNames(l);
                  setNewName("");
                })
                .catch(fail)
            }
          >
            Add
          </button>
        </div>
      </details>
    </section>
  );
}

function ReviewBadge({ state, review }: { state: ReviewState; review?: Review }) {
  const title = review
    ? `${review.status === "ok" ? "Matched the paper" : `Problem: ${review.note ?? ""}`} · ${review.user}, ${when(review.created_at)}` +
      (state === "changed" ? " · the sheet changed after this review: check it again" : "")
    : "Not compared with the paper yet";
  const cls = state === "ok" ? "ok-text" : state === "todo" ? "muted" : "warn-text";
  return (
    <span className={`sup-badge ${cls}`} title={title}>
      {REVIEW_LABEL[state]}
      {review && state === "problem" && review.note ? `: ${review.note}` : ""}
      {review && state !== "todo" && (
        <span className="muted small">
          {" "}
          · {review.user}, {when(review.created_at)}
        </span>
      )}
    </span>
  );
}
