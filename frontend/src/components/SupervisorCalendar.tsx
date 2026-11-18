// Which supervisors' manpower sheets are entered, day by day: one row per supervisor, one column
// per day sheet. A cell counts the supervisor's sheets pushed that day (one push = one manpower
// sheet) against how many they usually hand in, so a supervisor with three sheets a day who has
// only one entered stands out as much as one with none.
import { useMemo } from "react";
import type { Owned } from "../api";
import type { Month } from "../history";

type CellState = "full" | "short" | "missing" | "off" | "later";

interface Cell {
  state: CellState;
  sheets: number; // pushes (manpower sheets) entered
  workers: number;
  usual: number; // the supervisor's usual sheets a day
  review: "ok" | "problem" | "todo" | null;
}

const dayNo = (s: string) => Number(s);

export function SupervisorCalendar({
  owned,
  month,
  sheets,
  reviewState,
  onPick,
}: {
  owned: Owned[];
  month: Month;
  sheets: string[]; // the workbook's day sheets, in order
  reviewState: (sheet: string, supervisor: string) => "ok" | "problem" | "todo" | "changed";
  onPick: (sheet: string, supervisor: string) => void;
}) {
  const view = useMemo(() => {
    const days = sheets.filter((s) => dayNo(s) >= 1);
    // pushes per supervisor and day (a push = one manpower sheet), and the workers on them
    const pushes = new Map<string, Map<string, Set<string>>>(); // supervisor -> sheet -> push ids
    const workers = new Map<string, number>(); // "sup|sheet" -> workers
    for (const o of owned) {
      const bySheet = pushes.get(o.supervisor) ?? new Map<string, Set<string>>();
      const ids = bySheet.get(o.sheet) ?? new Set<string>();
      ids.add(o.batch_id === null ? `t${o.created_at.slice(0, 16)}` : String(o.batch_id));
      bySheet.set(o.sheet, ids);
      pushes.set(o.supervisor, bySheet);
      workers.set(`${o.supervisor}|${o.sheet}`, (workers.get(`${o.supervisor}|${o.sheet}`) ?? 0) + 1);
    }
    const offDay = (s: string) => {
      const t = String(month[s]?.header.day_type ?? "").trim().toLowerCase();
      return t === "sunday" || t === "holiday";
    };
    // the last day anyone has entered: days after it are still to come, not missing
    const entered = (s: string) => (month[s]?.entries.length ?? 0) > 0 || [...pushes.values()].some((m) => m.has(s));
    const lastDay = Math.max(0, ...days.filter(entered).map(dayNo));
    const sups = [...pushes.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const rows = sups.map((sup) => {
      const bySheet = pushes.get(sup)!;
      const counts = [...bySheet.values()].map((x) => x.size);
      // usual: the count seen most often (ties: the larger), so one extra correction push does not move it
      const freq = new Map<number, number>();
      for (const n of counts) freq.set(n, (freq.get(n) ?? 0) + 1);
      const usual = [...freq].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 1;
      const first = Math.min(...[...bySheet.keys()].map(dayNo));
      const cells: Cell[] = days.map((s) => {
        const n = bySheet.get(s)?.size ?? 0;
        const r = n ? reviewState(s, sup) : null;
        const review = r === "changed" ? "todo" : r;
        const base = { sheets: n, workers: workers.get(`${sup}|${s}`) ?? 0, usual, review };
        if (n) return { ...base, state: n < usual ? "short" : "full" };
        if (dayNo(s) > lastDay || dayNo(s) < first) return { ...base, state: "later" };
        if (offDay(s)) return { ...base, state: "off" };
        return { ...base, state: "missing" };
      });
      return { sup, usual, cells, missing: cells.filter((c) => c.state === "missing").length, short: cells.filter((c) => c.state === "short").length };
    });
    const perDay = days.map((_, i) => ({
      done: rows.filter((r) => r.cells[i].state === "full").length,
      expected: rows.filter((r) => ["full", "short", "missing"].includes(r.cells[i].state)).length,
    }));
    return { days, rows, perDay, lastDay, offDay };
  }, [owned, month, sheets, reviewState]);

  if (!view.rows.length) return null;
  const last = view.days.findIndex((s) => dayNo(s) === view.lastDay);
  const lastDone = last >= 0 ? view.perDay[last] : null;
  const missingLast = last >= 0 ? view.rows.filter((r) => r.cells[last].state === "missing" || r.cells[last].state === "short") : [];
  const dateOf = (s: string) => month[s]?.header.date ?? null;
  const short = (iso: string | null) =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "";
  const title = (sup: string, s: string, c: Cell) => {
    const d = `${sup} · sheet ${s}${dateOf(s) ? ` (${short(dateOf(s))})` : ""}`;
    if (c.state === "full" || c.state === "short")
      return `${d}: ${c.sheets} manpower sheet${c.sheets === 1 ? "" : "s"} entered (usually ${c.usual}), ${c.workers} worker${c.workers === 1 ? "" : "s"}${
        c.review === "ok" ? " · checked against the paper ✓" : c.review === "problem" ? " · does not match the paper ⚠" : " · not checked yet"
      }. Click to open.`;
    if (c.state === "missing") return `${d}: nothing entered yet (usually ${c.usual} sheet${c.usual === 1 ? "" : "s"} a day)`;
    if (c.state === "off") return `${d}: Sunday / holiday, nothing entered`;
    return `${d}: not entered yet`;
  };

  return (
    <div className="card sup-cal">
      <div className="sup-cal-head">
        <h3>Manpower sheets entered, day by day</h3>
        {lastDone && (
          <span className={`sup-cal-today${missingLast.length ? " warn-text" : " ok-text"}`} role="status">
            Sheet {view.lastDay}
            {dateOf(String(view.lastDay)) ? ` (${short(dateOf(String(view.lastDay)))})` : ""}: {lastDone.done} of {lastDone.expected} supervisors complete
            {missingLast.length ? ` · still to enter: ${missingLast.map((r) => r.sup).join(", ")}` : " ✓"}
          </span>
        )}
      </div>
      <div className="sup-cal-scroll">
        <table className="sup-cal-grid">
          <thead>
            <tr>
              <th className="sup-cal-name">Supervisor</th>
              {view.days.map((s) => (
                <th key={s} className={`${view.offDay(s) ? "off" : ""}${dayNo(s) === view.lastDay ? " last" : ""}`} title={short(dateOf(s)) || `Sheet ${s}`}>
                  {s}
                </th>
              ))}
              <th className="num" title="Days with nothing entered / fewer sheets than usual">Gaps</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.sup}>
                <th className="sup-cal-name" title={`Usually ${r.usual} manpower sheet${r.usual === 1 ? "" : "s"} a day`}>
                  {r.sup} <span className="muted small">×{r.usual}</span>
                </th>
                {r.cells.map((c, i) => {
                  const s = view.days[i];
                  const clickable = c.sheets > 0;
                  return (
                    <td key={s} className={`c-${c.state}${dayNo(s) === view.lastDay ? " last" : ""}`}>
                      {clickable ? (
                        <button
                          className="sup-cal-cell"
                          title={title(r.sup, s, c)}
                          aria-label={title(r.sup, s, c)}
                          onClick={() => onPick(s, r.sup)}
                        >
                          {c.state === "short" ? `${c.sheets}/${c.usual}` : c.sheets}
                          {c.review === "ok" ? <i className="rv ok">✓</i> : c.review === "problem" ? <i className="rv bad">!</i> : null}
                        </button>
                      ) : (
                        <span className="sup-cal-cell" title={title(r.sup, s, c)} aria-label={title(r.sup, s, c)}>
                          {c.state === "missing" ? "–" : ""}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="num">
                  {r.missing + r.short ? <span className="warn-text">{r.missing + r.short}</span> : <span className="ok-text">✓</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="sup-cal-name">Complete</th>
              {view.perDay.map((d, i) => (
                <td key={view.days[i]} className={`foot${d.expected && d.done < d.expected ? " warn-text" : d.expected ? " ok-text" : ""}`} title={`${d.done} of ${d.expected} supervisors complete`}>
                  {d.expected ? `${d.done}/${d.expected}` : ""}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="sup-cal-legend small">
        <span className="key c-full">2</span> entered (sheets that day) <span className="key c-short">1/3</span> fewer than usual{" "}
        <span className="key c-missing">–</span> nothing entered on a working day <span className="key c-off" /> Sunday / holiday{" "}
        <span className="key c-later" /> not entered yet · <i className="rv ok">✓</i> checked against the paper <i className="rv bad">!</i> does not
        match · ×3 = usual sheets a day. A sheet is one push with that supervisor (a correction pushed later counts as another).
      </p>
    </div>
  );
}
