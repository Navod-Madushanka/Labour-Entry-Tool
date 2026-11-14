import { useEffect, useMemo, useState } from "react";
import { api, type Master, type Owned, type Review, type Supervisor } from "../api";
import type { Month } from "../history";
import { fingerprint, ManpowerRecord, recordColumns } from "./ManpowerSheet";
import { CardHelp } from "./CardHelp";
import { EmptyState } from "./EmptyState";

type ReviewState = "todo" | "ok" | "problem" | "changed";
const REVIEW_LABEL: Record<ReviewState, string> = {
  todo: "Not checked yet",
  ok: "✓ Matches the paper",
  problem: "⚠ Doesn't match",
  changed: "↻ Changed since checked",
};
type CheckFilter = "" | "check" | "problem" | "ok"; // "check": not checked yet, or changed since


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
  const [open, setOpen] = useState<string[] | null>(null); // sheets opened; null: the default (all, when 3 or fewer)
  const [error, setError] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");
  const [reviewFilter, setReviewFilter] = useState<CheckFilter>("");
  const [noteFor, setNoteFor] = useState<string | null>(null); // the sheet whose "what is different" box is open
  const [noteText, setNoteText] = useState("");
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
      (!reviewFilter || (reviewFilter === "check" ? ["todo", "changed"].includes(state(g).state) : state(g).state === reviewFilter)) &&
      matches(g),
  );
  const workerHits = q ? shown.flatMap((g) => g.owned.filter((o) => hit(g, o)).map((o) => ({ g, o }))) : [];

  const review = async (g: Group, status: Review["status"], note: string | null = null) => {
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
  const defaultOpen = shown.length <= 3 ? shown.map((g) => g.key) : [];
  const visible = open ?? defaultOpen;

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
      setOpen((o) => o && o.map((k) => (k === g.key ? `${g.sheet}|${to}` : k)));
      api.supervisors().then(setNames).catch(fail);
    } catch (e) {
      fail(e);
    }
  };

  const tally = { check: 0, problem: 0, ok: 0 };
  for (const g of groups) {
    const st = state(g).state;
    if (st === "ok") tally.ok++;
    else if (st === "problem") tally.problem++;
    else tally.check++;
  }
  const filtered = !!(q || who || sheet || reviewFilter);
  const clearFilters = () => {
    setQuery("");
    setWho("");
    setSheet("");
    setReviewFilter("");
  };
  const toggle = (key: string) =>
    setOpen((o) => {
      const now = o ?? defaultOpen;
      return now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
    });
  const saveNote = async (g: Group) => {
    if (!noteText.trim()) return;
    await review(g, "problem", noteText.trim());
    setNoteFor(null);
  };

  return (
    <section className="supervisors">
      <div className="section-head">
        <h2>Supervisors' sheets</h2>
      </div>
      <p className="sup-lead">Check each supervisor's day in the tool against their paper manpower sheet.</p>
      <CardHelp id="supervisors">
        <ol className="sup-steps">
          <li>
            <b>Push</b> entries from the Entry page: the tool asks whose paper sheet they came from.
          </li>
          <li>
            <b>Open</b> a sheet below: that supervisor's workers for that day, laid out like their paper.
          </li>
          <li>
            <b>Compare</b> it with the paper and answer <i>Does this match?</i>: <b>✓ Yes</b>, or <b>⚠ No</b> with a
            note of what is different.
          </li>
        </ol>
        <p>
          A cell marked <b>≠ Excel</b> was changed in Excel after the push. A sheet that changes after you checked it
          shows <b>↻ Changed since checked</b>: check it again. Undoing a push gives the entries back to the supervisor
          before it. Picked the wrong supervisor at push? Use <b>Move to</b> under the sheet.
        </p>
      </CardHelp>
      {error && <p className="error-text">{error}</p>}

      {owned && groups.length > 0 && (
        <div className="sup-tiles" role="group" aria-label="Show sheets by check">
          {(
            [
              ["check", "To check", tally.check, "Not checked yet, or changed since"],
              ["problem", "Doesn't match", tally.problem, "Marked as different from the paper"],
              ["ok", "Matches the paper", tally.ok, "Checked: the same as the paper"],
              ["", "All sheets", groups.length, "Every supervisor sheet"],
            ] as const
          ).map(([k, label, n, hint]) => (
            <button
              key={k || "all"}
              className={`sup-tile tile-${k || "all"}${reviewFilter === k ? " on" : ""}`}
              aria-pressed={reviewFilter === k}
              title={hint}
              onClick={() => setReviewFilter(k)}
            >
              <span className="sup-tile-n">{n}</span>
              <span className="sup-tile-label">{label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="sup-filters row">
        <label className="field sup-search">
          Find
          <input
            type="search"
            aria-label="Search sheets"
            placeholder="A worker, name, code, supervisor, sheet no. or date"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="field">
          Supervisor
          <select aria-label="Supervisor" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {(() => {
              // the last three used on top, then everyone A–Z
              const recent = names.filter((s) => s.last_used).slice(0, 3);
              const rest = names.filter((s) => !recent.includes(s)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
              const option = (s: Supervisor) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({counts.get(s.name) ?? 0} {counts.get(s.name) === 1 ? "sheet" : "sheets"})
                </option>
              );
              return (
                <>
                  {recent.length > 0 && <optgroup label="Recent">{recent.map(option)}</optgroup>}
                  <optgroup label="All supervisors (A–Z)">{rest.map(option)}</optgroup>
                </>
              );
            })()}
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
        {filtered && (
          <button className="link sup-clear" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {owned && groups.length > 0 && (
        <p className="small muted sup-summary" role="status">
          {filtered ? `Showing ${shown.length} of ${groups.length} sheets` : `${groups.length} ${groups.length === 1 ? "sheet" : "sheets"}`} ·{" "}
          {tally.check + tally.problem ? (
            <span className="warn-text">
              {tally.check} to check{tally.problem ? `, ${tally.problem} not matching` : ""}
            </span>
          ) : (
            <span className="ok-text">all checked ✓</span>
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
        <EmptyState
          title="No supervisor sheets yet"
          steps={[
            "Enter a supervisor's workers on the Entry page.",
            "Press Push: the tool asks whose paper sheet it is. Pick or type the supervisor.",
            "Come back here to check that sheet against the paper.",
          ]}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="sup-index">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Day</th>
                  <th>Supervisor</th>
                  <th className="num">Workers</th>
                  <th title="Workers changed in Excel after the push">Changed in Excel</th>
                  <th>Pushed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => {
                  const changed = recordColumns(g.owned, month[g.sheet]).filter((c) => c.note).length;
                  const isOpen = visible.includes(g.key);
                  return (
                    <tr
                      key={g.key}
                      className={`sup-row-link${isOpen ? " on" : ""}`}
                      onClick={(e) => !(e.target as HTMLElement).closest("button") && toggle(g.key)}
                    >
                      <td>
                        <ReviewBadge {...state(g)} compact />
                      </td>
                      <td>
                        Sheet {g.sheet} <span className="muted">{dayText(month[g.sheet]?.header.date)}</span>
                      </td>
                      <td>
                        <b>{g.supervisor}</b>
                      </td>
                      <td className="num">{g.owned.length}</td>
                      <td>
                        {changed ? (
                          <span className="warn-text" title="Changed in Excel after the push (≠ Excel on the sheet)">
                            {changed} {changed === 1 ? "worker" : "workers"}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="muted small">
                        {when(g.last)} by {g.users.join(", ")}
                      </td>
                      <td>
                        <button
                          className="link sup-open"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Open"} sheet ${g.sheet} of ${g.supervisor}`}
                          onClick={() => toggle(g.key)}
                        >
                          {isOpen ? "Hide ▴" : "Open ▾"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length === 0 && (
            <p className="muted">
              No sheet matches.{" "}
              <button className="link" onClick={clearFilters}>
                Clear filters
              </button>
            </p>
          )}
          {unowned.length > 0 && (
            <p className="sup-unowned small">
              <b>
                {unowned.length} {unowned.length === 1 ? "entry" : "entries"} on sheet {sheet} {unowned.length === 1 ? "has" : "have"} no
                supervisor
              </b>{" "}
              <span className="muted">
                (pushed before the tool asked, or typed straight into Excel):{" "}
                {unowned
                  .slice(0, 12)
                  .map((v) => v.entry.calling_name)
                  .join(", ")}
                {unowned.length > 12 ? " …" : ""}
              </span>
            </p>
          )}

          <div className="manpower-pages">
            {shown
              .filter((g) => visible.includes(g.key))
              .map((g) => {
                const st = state(g);
                return (
                  <div key={g.key} className="mp-day" data-sheet={g.sheet} data-supervisor={g.supervisor}>
                    <div className={`sup-check st-${st.state}`}>
                      <div className="sup-check-q">
                        <b>
                          Does this match {g.supervisor}'s paper sheet for {dayText(month[g.sheet]?.header.date) || `sheet ${g.sheet}`}?
                        </b>
                        <ReviewBadge {...st} />
                      </div>
                      {noteFor === g.key ? (
                        <div className="sup-note">
                          <input
                            aria-label={`What is different on sheet ${g.sheet} of ${g.supervisor}`}
                            placeholder="What is different? e.g. AAA-02 out 18:00 on the paper"
                            value={noteText}
                            autoFocus
                            maxLength={500}
                            onChange={(e) => setNoteText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveNote(g);
                              if (e.key === "Escape") setNoteFor(null);
                            }}
                          />
                          <button className="small primary" disabled={!noteText.trim()} onClick={() => saveNote(g)}>
                            Save note
                          </button>
                          <button className="link small" onClick={() => setNoteFor(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="sup-check-actions">
                          <button className="small sup-yes" onClick={() => review(g, "ok")} disabled={st.state === "ok"}>
                            ✓ Yes, it matches
                          </button>
                          <button
                            className="small sup-no"
                            onClick={() => {
                              setNoteFor(g.key);
                              setNoteText(st.review?.note ?? "");
                            }}
                          >
                            ⚠ No, something is different…
                          </button>
                          {st.review && (
                            <button className="link small" onClick={() => review(g, "cleared")}>
                              Undo my answer
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <ManpowerRecord
                      sheet={g.sheet}
                      day={month[g.sheet]}
                      supervisor={g.supervisor}
                      columns={recordColumns(g.owned, month[g.sheet])}
                      places={master.places}
                      descriptions={master.descriptions}
                      activities={master.check_activities}
                      highlight={q ? (c) => g.owned.some((o) => o.calling_name === c.name && hit(g, o)) : undefined}
                      footer={
                        <span className="sup-move">
                          {g.owned.length} {g.owned.length === 1 ? "worker" : "workers"} · pushed {when(g.last)} by {g.users.join(", ")} ·
                          Wrong supervisor? Move to{" "}
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
                      }
                    />
                  </div>
                );
              })}
          </div>
        </>
      )}
      <datalist id="sup-names">
        {names.map((s) => (
          <option key={s.name} value={s.name} />
        ))}
      </datalist>

      <details className="sup-list">
        <summary>Manage supervisor names ({names.length})</summary>
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

function ReviewBadge({ state, review, compact = false }: { state: ReviewState; review?: Review; compact?: boolean }) {
  const title = review
    ? `${review.status === "ok" ? "Matched the paper" : `Doesn't match: ${review.note ?? ""}`} · ${review.user}, ${when(review.created_at)}` +
      (state === "changed" ? " · the sheet changed after this check: check it again" : "")
    : "Not compared with the paper yet";
  return (
    <span className={`sup-badge st-${state}`} title={title}>
      {REVIEW_LABEL[state]}
      {!compact && review && state === "problem" && review.note ? `: ${review.note}` : ""}
      {!compact && review && state !== "todo" && (
        <span className="sup-badge-by">
          {" "}
          · {review.user}, {when(review.created_at)}
        </span>
      )}
    </span>
  );
}
