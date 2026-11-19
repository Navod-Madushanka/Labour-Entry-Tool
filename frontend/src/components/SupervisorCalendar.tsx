// Which supervisors' manpower sheets are entered, day by day. First one day (the latest by default):
// a line per supervisor saying plainly "entered", "1 of 3 sheets" or "not entered", with a strip of
// the month's days coloured by how complete each is; the whole month as a grid on request. A cell counts the supervisor's sheets pushed that day (one push = one manpower
// sheet) against how many they usually hand in, so a supervisor with three sheets a day who has
// only one entered stands out as much as one with none.
import { useEffect, useMemo, useState } from "react";
import { store } from "../store";
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

  const [pick, setPick] = useState<string | null>(null); // the day shown (null: the latest entered)
  const [mode, setMode] = useState<"day" | "month">(() => (store.get("labour.sup.cal") === "month" ? "month" : "day"));
  useEffect(() => store.set("labour.sup.cal", mode), [mode]);
  if (!view.rows.length) return null;

  const dateOf = (s: string) => month[s]?.header.date ?? null;
  const longDate = (iso: string | null) =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : "";
  const shortDate = (iso: string | null) =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "";
  const latest = view.days.find((s) => dayNo(s) === view.lastDay) ?? view.days[0];
  const day = pick && view.days.includes(pick) ? pick : latest;
  const di = view.days.indexOf(day);
  const dayState = (i: number): "done" | "part" | "none" | "off" | "later" => {
    const d = view.perDay[i];
    if (!d.expected) return dayNo(view.days[i]) > view.lastDay ? "later" : "off"; // off: a day off, or entries with no supervisor
    if (d.done === d.expected) return "done";
    return view.rows.some((r) => r.cells[i].sheets > 0) ? "part" : "none";
  };
  const STATUS: Record<CellState, { icon: string; text: (c: Cell) => string; cls: string }> = {
    full: { icon: "✓", cls: "full", text: (c) => `Entered · ${c.sheets} sheet${c.sheets === 1 ? "" : "s"}` },
    short: { icon: "!", cls: "short", text: (c) => `${c.sheets} of ${c.usual} sheets entered` },
    missing: { icon: "✕", cls: "missing", text: () => "Not entered" },
    off: { icon: "–", cls: "off", text: () => "Day off (Sunday / holiday)" },
    later: { icon: "·", cls: "later", text: () => "Not started" },
  };
  const order: Record<CellState, number> = { missing: 0, short: 1, full: 2, off: 3, later: 4 };
  const rowsToday = view.rows
    .map((r) => ({ r, c: r.cells[di] }))
    .sort((a, b) => order[a.c.state] - order[b.c.state] || a.r.sup.localeCompare(b.r.sup));
  const today = view.perDay[di];
  const pct = today.expected ? Math.round((today.done / today.expected) * 100) : 0;

  return (
    <div className="card sup-cal">
      <div className="sup-cal-head">
        <h3>Manpower sheets entered</h3>
        <span className="seg" role="group" aria-label="Show">
          <button className={mode === "day" ? "active" : ""} aria-pressed={mode === "day"} onClick={() => setMode("day")}>
            One day
          </button>
          <button className={mode === "month" ? "active" : ""} aria-pressed={mode === "month"} onClick={() => setMode("month")}>
            Whole month
          </button>
        </span>
      </div>

      <div className="sup-days" role="tablist" aria-label="Day">
        {view.days.map((s, i) => {
          const st = dayState(i);
          const d = view.perDay[i];
          return (
            <button
              key={s}
              role="tab"
              aria-selected={mode === "day" && s === day}
              className={`sup-day d-${st}${mode === "day" && s === day ? " on" : ""}`}
              title={`${shortDate(dateOf(s)) || `Sheet ${s}`}: ${d.expected ? `${d.done} of ${d.expected} supervisors complete` : st === "later" ? "not entered yet" : view.offDay(s) ? "day off" : "no supervisor given for its entries (pushed before the tool asked, or typed in Excel)"}`}
              onClick={() => {
                setPick(s);
                setMode("day");
              }}
            >
              <span className="n">{s}</span>
              <span className="f">{d.expected ? `${d.done}/${d.expected}` : ""}</span>
            </button>
          );
        })}
      </div>

      {mode === "day" ? (
        <div className="sup-today">
          <div className="sup-today-head">
            <div>
              <b className="sup-today-date">{longDate(dateOf(day)) || `Sheet ${day}`}</b>
              {dateOf(day) && <span className="muted small"> · sheet {day}</span>}
            </div>
            {today.expected ? (
              <div className={`sup-today-sum ${today.done === today.expected ? "ok" : "warn"}`} role="status">
                <span className="big">
                  {today.done} of {today.expected}
                </span>{" "}
                supervisors complete
                <span className="bar" aria-hidden>
                  <span style={{ width: `${pct}%` }} />
                </span>
              </div>
            ) : (
              <span className="muted">{dayNo(day) > view.lastDay ? "Not entered yet" : view.offDay(day) ? "Day off: nothing expected" : "No supervisor given for this day's entries"}</span>
            )}
          </div>
          <ul className="sup-today-list">
            {rowsToday.map(({ r, c }) => {
              const st = STATUS[c.state];
              return (
                <li key={r.sup} className={`st-${st.cls}`}>
                  <span className="sup-dot" aria-hidden>
                    {st.icon}
                  </span>
                  <span className="sup-name">
                    <b>{r.sup}</b>
                    <span className="muted small"> · usually {r.usual} sheet{r.usual === 1 ? "" : "s"} a day</span>
                  </span>
                  <span className="sup-state">{st.text(c)}</span>
                  <span className="sup-extra small muted">
                    {c.sheets > 0 && (
                      <>
                        {c.workers} worker{c.workers === 1 ? "" : "s"} ·{" "}
                        {c.review === "ok" ? <span className="ok-text">checked ✓</span> : c.review === "problem" ? <span className="warn-text">doesn't match ⚠</span> : "not checked yet"}
                      </>
                    )}
                  </span>
                  {c.sheets > 0 ? (
                    <button className="small" onClick={() => onPick(day, r.sup)}>
                      Open
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <MonthGrid view={view} dateOf={dateOf} shortDate={shortDate} onPick={onPick} onDay={(s) => { setPick(s); setMode("day"); }} />
      )}
      <p className="sup-cal-legend small muted">
        A sheet is one push with that supervisor; "usually" is the number they hand in on most days this month. A correction pushed later
        counts as another sheet.
      </p>
    </div>
  );
}

function MonthGrid({ view, dateOf, shortDate, onPick, onDay }: {
  view: { days: string[]; rows: { sup: string; usual: number; cells: Cell[]; missing: number; short: number }[]; perDay: { done: number; expected: number }[]; lastDay: number; offDay: (s: string) => boolean };
  dateOf: (s: string) => string | null;
  shortDate: (iso: string | null) => string;
  onPick: (sheet: string, supervisor: string) => void;
  onDay: (sheet: string) => void;
}) {
  const label = (c: Cell) =>
    c.state === "full" ? `${c.sheets} entered` : c.state === "short" ? `${c.sheets} of ${c.usual} entered` : c.state === "missing" ? "not entered" : c.state === "off" ? "day off" : "not started";
  return (
    <>
      <div className="sup-cal-legend-top small">
        <span className="key c-full">✓</span> all entered <span className="key c-short">1/3</span> some missing <span className="key c-missing">✕</span> not
        entered <span className="key c-off">–</span> day off <span className="key c-later" /> not started
      </div>
      <div className="sup-cal-scroll">
        <table className="sup-cal-grid">
          <thead>
            <tr>
              <th className="sup-cal-name">Supervisor</th>
              {view.days.map((s) => (
                <th key={s} className={view.offDay(s) ? "off" : ""}>
                  <button className="link sup-cal-dayhead" title={`${shortDate(dateOf(s)) || `Sheet ${s}`}: see this day`} onClick={() => onDay(s)}>
                    {s}
                  </button>
                </th>
              ))}
              <th className="num">Gaps</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.sup}>
                <th className="sup-cal-name">
                  {r.sup} <span className="muted small">×{r.usual}</span>
                </th>
                {r.cells.map((c, i) => {
                  const s = view.days[i];
                  const t = `${r.sup}, ${shortDate(dateOf(s)) || `sheet ${s}`}: ${label(c)}`;
                  return (
                    <td key={s} className={`c-${c.state}`}>
                      {c.sheets ? (
                        <button className="sup-cal-cell" title={`${t}. Click to open.`} aria-label={t} onClick={() => onPick(s, r.sup)}>
                          {c.state === "short" ? `${c.sheets}/${c.usual}` : "✓"}
                        </button>
                      ) : (
                        <span className="sup-cal-cell" title={t} aria-label={t}>
                          {c.state === "missing" ? "✕" : c.state === "off" ? "–" : ""}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="num">{r.missing + r.short ? <span className="warn-text">{r.missing + r.short}</span> : <span className="ok-text">0</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="sup-cal-name">Complete</th>
              {view.perDay.map((d, i) => (
                <td key={view.days[i]} className={`foot${d.expected && d.done < d.expected ? " warn-text" : d.expected ? " ok-text" : ""}`}>
                  {d.expected ? `${d.done}/${d.expected}` : ""}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
