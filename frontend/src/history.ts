// Month history from the day sheets already loaded: stats and suggestions (PLAN.md Phase 3).
import type { DayView, Entry, Worker } from "./api";

export type Month = Record<string, DayView>; // sheet -> day

const num = (v: unknown) => (typeof v === "number" ? v : null);

export interface WorkerStats {
  days: number;
  hours: number; // effective
}

export function workerStats(month: Month, callingName: string): WorkerStats {
  let days = 0;
  let hours = 0;
  for (const day of Object.values(month)) {
    for (const v of day.entries) {
      if (v.entry.calling_name === callingName && v.computed) {
        days += 1;
        hours += v.computed.effective;
      }
    }
  }
  return { days, hours };
}

export function entriesOf(month: Month, callingName: string, beforeSheet?: number): Entry[] {
  return Object.keys(month)
    .map(Number)
    .filter((n) => beforeSheet === undefined || n < beforeSheet)
    .sort((a, b) => b - a) // newest first
    .flatMap((n) => month[String(n)].entries.map((v) => v.entry))
    .filter((e) => e.calling_name === callingName);
}

export interface UsualTimes {
  time_in: number;
  time_out: number;
  count: number;
}

export function usualTimes(entries: Entry[]): UsualTimes | null {
  const counts = new Map<string, UsualTimes>();
  for (const e of entries) {
    const tin = num(e.time_in);
    const tout = num(e.time_out);
    if (tin === null || tout === null) continue;
    const key = `${tin}-${tout}`;
    const item = counts.get(key) ?? { time_in: tin, time_out: tout, count: 0 };
    item.count += 1;
    counts.set(key, item);
  }
  let best: UsualTimes | null = null;
  for (const item of counts.values()) if (!best || item.count > best.count) best = item;
  return best;
}

export function recentActivities(entries: Entry[], limit = 5): string[] {
  const out: string[] = [];
  for (const e of entries) {
    for (const a of e.activities) {
      const code = typeof a.code === "string" ? a.code.trim() : null;
      if (code && !out.includes(code)) out.push(code);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Activity codes by how often they were used this month (most used first). */
export function topActivities(month: Month): Map<string, number> {
  const counts = new Map<string, number>();
  for (const day of Object.values(month))
    for (const v of day.entries)
      for (const a of v.entry.activities) {
        const code = typeof a.code === "string" ? a.code.trim() : null;
        if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
      }
  return new Map([...counts].sort((a, b) => b[1] - a[1]));
}

export interface CrewToday {
  activity: string | null;
  time_in: number | null;
  time_out: number | null;
  count: number;
}

/** What the worker's trade group is doing on this sheet (most common activity and times). */
export function crewToday(day: DayView | undefined, workers: Worker[], trade: unknown): CrewToday | null {
  if (!day || !trade) return null;
  const sameTrade = new Set(workers.filter((w) => w.trade_group === trade).map((w) => w.calling_name));
  const peers = day.entries.map((v) => v.entry).filter((e) => e.calling_name && sameTrade.has(e.calling_name));
  if (!peers.length) return null;
  const acts = new Map<string, number>();
  for (const e of peers) {
    const code = typeof e.activities[0]?.code === "string" ? (e.activities[0].code as string).trim() : null;
    if (code) acts.set(code, (acts.get(code) ?? 0) + 1);
  }
  const activity = [...acts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const times = usualTimes(peers);
  return { activity, time_in: times?.time_in ?? null, time_out: times?.time_out ?? null, count: peers.length };
}

export interface Companion {
  name: string;
  days: number; // days in the window with exactly the same entry
}

/** Same times and the same activities (codes and hours): workers on one record of the paper sheet. */
function recordKey(e: Entry): string | null {
  if (typeof e.time_in !== "number" || typeof e.time_out !== "number") return null;
  const acts = e.activities
    .filter((a) => typeof a.code === "string" && a.code.trim())
    .map((a) => `${String(a.code).trim()}:${a.hours ?? ""}`)
    .sort();
  return acts.length ? `${e.time_in}|${e.time_out}|${acts.join(",")}` : null;
}

/** Workers who usually share these workers' record: over the `window` days before `sheet`, how
 * often (more recent days weigh more) each other worker had exactly the same entry on the same day.
 * On the October file about half of the top suggestions turn out right for the day. */
export function companions(month: Month, names: string[], sheet: number, exclude: Set<string>, window = 10, limit = 12): Companion[] {
  const score = new Map<string, number>();
  const days = new Map<string, number>();
  const mine = new Set(names);
  for (let n = sheet - 1; n >= Math.max(1, sheet - window); n--) {
    const day = month[String(n)];
    if (!day) continue;
    const groups = new Map<string, string[]>();
    for (const v of day.entries) {
      const key = recordKey(v.entry);
      if (key && v.entry.calling_name) groups.set(key, [...(groups.get(key) ?? []), v.entry.calling_name]);
    }
    for (const group of groups.values()) {
      if (!group.some((g) => mine.has(g))) continue;
      for (const g of group) {
        if (mine.has(g) || exclude.has(g)) continue;
        score.set(g, (score.get(g) ?? 0) + 1 / (sheet - n));
        days.set(g, (days.get(g) ?? 0) + 1);
      }
    }
  }
  return [...score]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => ({ name, days: days.get(name) ?? 0 }));
}

export interface CodeSuggestion {
  code: string;
  why: string; // "INB-03, INB-04 today", "yesterday", "Carpenters today"
}

export interface TodayEntry {
  calling_name: string;
  code: string | null; // first activity
  time_in: number | null;
  time_out: number | null;
}

const firstCode = (e: Entry): string | null =>
  e.activities.map((a) => (typeof a.code === "string" ? a.code.trim() : "")).find(Boolean) ?? null;

/** Activity codes to suggest for a worker on `sheet`, best first. The order comes from replaying
 * the October INDIAN workbook: the code the worker's usual partners (same code and times on the
 * last days) have today first, then workers with the same times in the trade today, yesterday's
 * own code, the trade today, the trade this month. First guess right 76% of the time, top three
 * 89% (yesterday's code first: 64% and 85%). `today` is this sheet's entries, Excel and queue. */
export function suggestCodes(
  month: Month,
  sheet: number,
  worker: Worker,
  workers: Worker[],
  today: TodayEntry[],
  times: { time_in: number | null; time_out: number | null },
  window = 10,
): CodeSuggestion[] {
  const trade = new Map(workers.map((w) => [w.calling_name, w.trade_group]));
  const sameTrade = (name: string) => trade.get(name) === worker.trade_group && name !== worker.calling_name;
  const out: CodeSuggestion[] = [];
  const add = (code: string | null | undefined, why: string) => {
    if (code && !out.some((s) => s.code === code)) out.push({ code, why });
  };
  const top = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const count = (codes: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const c of codes) if (c) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  };
  const others = today.filter((t) => t.calling_name !== worker.calling_name && t.code);

  // Usual partners: same first code and the same times as this worker on the last days.
  const score = new Map<string, number>();
  let last: Entry | undefined;
  for (let n = sheet - 1; n >= Math.max(1, sheet - window); n--) {
    const day = month[String(n)];
    const mine = day?.entries.find((v) => v.entry.calling_name === worker.calling_name)?.entry;
    if (!day || !mine) continue;
    last ??= mine;
    const code = firstCode(mine);
    if (!code) continue;
    for (const v of day.entries) {
      const e = v.entry;
      if (e.calling_name && e.calling_name !== worker.calling_name && firstCode(e) === code &&
          e.time_in === mine.time_in && e.time_out === mine.time_out)
        score.set(e.calling_name, (score.get(e.calling_name) ?? 0) + 1 / (sheet - n));
    }
  }
  const partners = new Set(top(score).slice(0, 5));
  const withPartners = others.filter((t) => partners.has(t.calling_name));
  for (const code of top(count(withPartners.map((t) => t.code))).slice(0, 1)) {
    const names = withPartners.filter((t) => t.code === code).map((t) => t.calling_name);
    add(code, `${names.slice(0, 2).join(", ")}${names.length > 2 ? " …" : ""} today`);
  }

  // The trade with the same times today.
  if (times.time_in !== null && times.time_out !== null) {
    const same = others.filter((t) => sameTrade(t.calling_name) && t.time_in === times.time_in && t.time_out === times.time_out);
    add(top(count(same.map((t) => t.code)))[0], "same times today");
  }
  if (last) add(firstCode(last), "last day");
  const tradeName = String(worker.trade_group ?? "trade");
  for (const code of top(count(others.filter((t) => sameTrade(t.calling_name)).map((t) => t.code))).slice(0, 2))
    add(code, `${tradeName} today`);
  const monthCodes: (string | null)[] = [];
  for (const day of Object.values(month))
    for (const v of day.entries) if (v.entry.calling_name && sameTrade(v.entry.calling_name)) monthCodes.push(firstCode(v.entry));
  for (const code of top(count(monthCodes)).slice(0, 3)) add(code, `${tradeName} this month`);
  return out.slice(0, 5);
}
