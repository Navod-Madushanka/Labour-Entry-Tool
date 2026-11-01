// Month history from the day sheets already loaded: stats and suggestions (PLAN.md Phase 3).
import type { DayView, Entry, Worker } from "./api";

export type Month = Record<string, DayView>; // sheet -> day

/** The month with the previous month's last days in front of it, as sheets 0, -1, -2, … (the
 * last day of the previous month is sheet 0), so "the days before sheet 1" exist and every rule
 * works the same on the 1st as on the 15th. `prev`: that month's day sheets as read. */
export function carryOver(month: Month, prev: Month, days = 7): Month {
  const last = Object.keys(prev)
    .map(Number)
    .filter((n) => n >= 1 && prev[String(n)].entries.length)
    .sort((a, b) => b - a)
    .slice(0, days);
  if (!last.length) return month;
  const out: Month = {};
  last.forEach((n, i) => {
    const s = String(-i);
    const d = prev[String(n)];
    out[s] = { ...d, header: { ...d.header, sheet: s }, entries: d.entries.map((v) => ({ ...v, entry: { ...v.entry, sheet: s } })) };
  });
  return { ...out, ...month };
}

const num = (v: unknown) => (typeof v === "number" ? v : null);

export interface WorkerStats {
  days: number;
  hours: number; // effective
}

export function workerStats(month: Month, callingName: string): WorkerStats {
  let days = 0;
  let hours = 0;
  for (const [sheet, day] of Object.entries(month)) {
    if (Number(sheet) < 1) continue; // the previous month's days (carry-over) are not this month
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

/** The worker's own times, recent days weighing most (0.8 per day back): a crew that moved to
 * nights is suggested nights after about three nights, not once the month's count turns. Replay:
 * times right 71.1 -> 71.4% (INDIAN), 51.2 -> 51.7% (SUB CONTRACT); 1 / days ago was too steep. */
export function recentTimes(entries: Entry[], sheet: number): UsualTimes | null {
  const score = new Map<string, { t: UsualTimes; s: number }>();
  for (const e of entries) {
    const tin = num(e.time_in);
    const tout = num(e.time_out);
    const ago = sheet - Number(e.sheet);
    if (tin === null || tout === null || !(ago > 0)) continue;
    const key = `${tin}-${tout}`;
    const item = score.get(key) ?? { t: { time_in: tin, time_out: tout, count: 0 }, s: 0 };
    item.t.count += 1;
    item.s += 0.8 ** ago;
    score.set(key, item);
  }
  let best: { t: UsualTimes; s: number } | null = null;
  for (const item of score.values()) if (!best || item.s > best.s) best = item;
  return best?.t ?? null;
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
export function companions(month: Month, names: string[], sheet: number, exclude: Set<string>, window = 10, limit = COMPANION_LIMIT): Companion[] {
  const score = new Map<string, number>();
  const days = new Map<string, number>();
  const mine = new Set(names);
  for (let n = sheet - 1; n >= sheet - window; n--) {
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

/** How many "same entry also for" chips are shown. Replay: 8 chips are right more often (40% vs
 * 36%) but find fewer of the crew (2.3 vs 2.8 right names per entry), so 12 stay. Lowering anyone
 * absent the last days changed nothing (they seldom rank high), so it was left out. */
export const COMPANION_LIMIT = 12;

export type CodeTier = "partners" | "sametimes" | "last" | "trade" | "month";

export interface CodeSuggestion {
  code: string;
  why: string; // "INB-03, INB-04 today", "yesterday", "Carpenters today"
  tier: CodeTier; // which rule gave it (for the replay and the suggestion log)
  confident?: boolean; // strong enough to fill the box (else it is only offered as a chip)
}

/** Partners today who must agree before a code fills the box by itself (and their share). */
export const CONFIDENT_AGREE = 2;
export const CONFIDENT_SHARE = 0.75;

export interface TodayEntry {
  calling_name: string;
  code: string | null; // first activity
  time_in: number | null;
  time_out: number | null;
  activities?: { code: string; hours: number | null }[]; // every line (for copying a whole record)
}

const firstCode = (e: Entry): string | null =>
  e.activities.map((a) => (typeof a.code === "string" ? a.code.trim() : "")).find(Boolean) ?? null;

/** Activity codes to suggest for a worker on `sheet`, best first. The order comes from replaying
 * the October INDIAN workbook: the code the worker's usual partners (same code and times on the
 * last days) have today first, then workers with the same times in the trade today, yesterday's
 * own code, the trade today, the trade this month. First guess right 76% of the time, top three
 * 89% (yesterday's code first: 64% and 85%). `today` is this sheet's entries, Excel and queue. */
/** The worker's usual partners: who had the same first code and the same times as them on the
 * last `window` days, more recent days weighing more (1 / days ago); the top five. Also their own
 * latest entry before `sheet`. */
export function usualPartners(month: Month, sheet: number, worker: Worker, window = 10): { partners: Set<string>; last?: Entry } {
  const score = new Map<string, number>();
  let last: Entry | undefined;
  for (let n = sheet - 1; n >= sheet - window; n--) {
    const day = month[String(n)];
    const mine = day?.entries.find((v) => v.entry.calling_name === worker.calling_name)?.entry;
    if (!day || !mine) continue;
    last ??= mine;
    const code = firstCode(mine);
    if (num(mine.time_in) === null || num(mine.time_out) === null) continue;
    for (const v of day.entries) {
      const e = v.entry;
      // Same first code (or both without one: workbooks kept without codes have crews too) and
      // the same In and Out. Replay: letting Out differ by up to 2 h made times worse and codes
      // no better, so the match stays exact.
      if (e.calling_name && e.calling_name !== worker.calling_name && firstCode(e) === code &&
          e.time_in === mine.time_in && e.time_out === mine.time_out)
        score.set(e.calling_name, (score.get(e.calling_name) ?? 0) + 1 / (sheet - n));
    }
  }
  const partners = new Set([...score].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name));
  return { partners, last };
}

export interface TimeSuggestion {
  time_in: number;
  time_out: number;
  why: string;
  tier: "partners" | "usual" | "trade";
}

/** Times to suggest for a worker on `sheet`: the times most of their usual partners have today,
 * else their own usual times this month, else the times most of their trade has today. */
export function suggestTimes(month: Month, sheet: number, worker: Worker, workers: Worker[], today: TodayEntry[]): TimeSuggestion | null {
  const others = today.filter((t) => t.calling_name !== worker.calling_name && t.time_in !== null && t.time_out !== null);
  const commonest = (list: TodayEntry[]) => {
    const counts = new Map<string, { t: TodayEntry; n: number; names: string[] }>();
    for (const t of list) {
      const key = `${t.time_in}-${t.time_out}`;
      const c = counts.get(key) ?? { t, n: 0, names: [] };
      c.n += 1;
      c.names.push(t.calling_name);
      counts.set(key, c);
    }
    return [...counts.values()].sort((a, b) => b.n - a.n)[0];
  };
  const { partners } = usualPartners(month, sheet, worker);
  const withPartners = commonest(others.filter((t) => partners.has(t.calling_name)));
  if (withPartners)
    return { time_in: withPartners.t.time_in!, time_out: withPartners.t.time_out!,
             why: `${withPartners.names.slice(0, 2).join(", ")}${withPartners.names.length > 2 ? " …" : ""} today`, tier: "partners" };  // prettier-ignore
  const usual = recentTimes(entriesOf(month, worker.calling_name, sheet), sheet);
  if (usual) return { time_in: usual.time_in, time_out: usual.time_out, why: `usual (${usual.count}×)`, tier: "usual" };
  const trade = new Map(workers.map((w) => [w.calling_name, w.trade_group]));
  const crew = commonest(others.filter((t) => trade.get(t.calling_name) === worker.trade_group));
  return crew ? { time_in: crew.t.time_in!, time_out: crew.t.time_out!, why: `${String(worker.trade_group ?? "trade")} today`, tier: "trade" } : null;
}

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
  const add = (code: string | null | undefined, why: string, tier: CodeTier) => {
    if (code && !out.some((s) => s.code === code)) out.push({ code, why, tier });
  };
  const top = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const count = (codes: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const c of codes) if (c) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  };
  const others = today.filter((t) => t.calling_name !== worker.calling_name && t.code);

  const { partners, last } = usualPartners(month, sheet, worker, window);
  const withPartners = others.filter((t) => partners.has(t.calling_name));
  for (const code of top(count(withPartners.map((t) => t.code))).slice(0, 1)) {
    const names = withPartners.filter((t) => t.code === code).map((t) => t.calling_name);
    add(code, `${names.length}/${withPartners.length} crew today (${names.slice(0, 2).join(", ")}${names.length > 2 ? " …" : ""})`, "partners");
    out[0].confident = names.length >= CONFIDENT_AGREE && names.length / withPartners.length >= CONFIDENT_SHARE;
  }

  // The trade with the same times today.
  if (times.time_in !== null && times.time_out !== null) {
    const same = others.filter((t) => sameTrade(t.calling_name) && t.time_in === times.time_in && t.time_out === times.time_out);
    add(top(count(same.map((t) => t.code)))[0], "same times today", "sametimes");
  }
  if (last) add(firstCode(last), "last day", "last");
  const tradeName = String(worker.trade_group ?? "trade");
  for (const code of top(count(others.filter((t) => sameTrade(t.calling_name)).map((t) => t.code))).slice(0, 2))
    add(code, `${tradeName} today`, "trade");
  const monthCodes: (string | null)[] = [];
  for (const day of Object.values(month))
    for (const v of day.entries) if (v.entry.calling_name && sameTrade(v.entry.calling_name)) monthCodes.push(firstCode(v.entry));
  for (const code of top(count(monthCodes)).slice(0, 3)) add(code, `${tradeName} this month`, "month");
  for (const x of out) x.confident ??= false;
  return out.slice(0, 5);
}

export interface RecordSuggestion {
  time_in: number;
  time_out: number;
  activities: { code: string; hours: number | null }[];
  agree: number; // partners today with this record
  of: number; // partners entered today
  why: string; // "3/3 crew today"
}

/** Fill every activity line from the crew's record: only for a record of several lines that the
 * crew agrees on (replay: 12 of 13 such fills right; without the agreement only 30 of 64). A
 * single line goes through the code suggestion as usual, and times come from suggestTimes (the
 * record's times were right slightly less often: 77.0% vs 77.3%). */
export function fillsLines(rec: RecordSuggestion | null): rec is RecordSuggestion {
  return Boolean(rec && rec.activities.length > 1 && rec.agree >= CONFIDENT_AGREE && rec.agree / rec.of >= CONFIDENT_SHARE);
}

/** The whole record (times, every activity line and its hours) most of the worker's usual partners
 * have today, when at least one of them is entered. */
export function suggestRecord(month: Month, sheet: number, worker: Worker, today: TodayEntry[]): RecordSuggestion | null {
  const { partners } = usualPartners(month, sheet, worker);
  const mine = today.filter((t) => t.calling_name !== worker.calling_name && partners.has(t.calling_name) && t.time_in !== null && t.time_out !== null);
  if (!mine.length) return null;
  const counts = new Map<string, { t: TodayEntry; n: number }>();
  for (const t of mine) {
    const lines = (t.activities ?? (t.code ? [{ code: t.code, hours: null }] : [])).map((a) => `${a.code}:${a.hours ?? ""}`).sort().join(",");
    const key = `${t.time_in}|${t.time_out}|${lines}`;
    const c = counts.get(key) ?? { t, n: 0 };
    c.n += 1;
    counts.set(key, c);
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  const t = best.t;
  return {
    time_in: t.time_in!,
    time_out: t.time_out!,
    activities: t.activities ?? (t.code ? [{ code: t.code, hours: null }] : []),
    agree: best.n,
    of: mine.length,
    why: `${best.n}/${mine.length} crew today`,
  };
}

/** Who is probably typed next, for the empty worker box: the last worker's crew not yet in today,
 * then the workers of the last day with work not yet in today (in sheet order from after the
 * last worker, as the paper sheet runs), then everyone else. */
export const NEXT_CREW = 3; // replay, crew order: top 5 64%, top 12 75% (all crew first: 54%, 77%; none: 58%, 68%)
export function nextWorkers(month: Month, sheet: number, last: Worker | null, workers: Worker[], today: TodayEntry[], limit = 12): Worker[] {
  const done = new Set(today.map((t) => t.calling_name));
  const byName = new Map(workers.map((w) => [w.calling_name, w]));
  const out: Worker[] = [];
  const add = (name: string) => {
    const w = byName.get(name);
    if (w && !done.has(name) && !out.includes(w)) out.push(w);
  };
  if (last) for (const c of companions(month, [last.calling_name], sheet, done, 10, NEXT_CREW)) add(c.name);
  let prev: DayView | undefined;
  for (let n = sheet - 1; n >= sheet - 10 && !prev; n--) if (month[String(n)]?.entries.length) prev = month[String(n)];
  if (prev) {
    const rows = prev.entries.map((v) => v.entry).filter((e) => e.calling_name).sort((a, b) => a.block - b.block);
    const from = last ? rows.findIndex((e) => e.block > last.block) : 0;
    const ordered = from > 0 ? [...rows.slice(from), ...rows.slice(0, from)] : rows;
    for (const e of ordered) {
      if (out.length >= limit) break;
      add(e.calling_name!);
    }
  }
  for (const w of workers) {
    if (out.length >= limit) break;
    add(w.calling_name);
  }
  return out.slice(0, limit);
}

/** Partners already in today whose entry must all differ before a mismatch is flagged. Replay on
 * correct October entries vs planted misread codes: 3 partners, code only -> fires on 3-4% of
 * entries, catches 41% of misreads (2 partners: 5% / 57%; times too: 10-12% / 59%). */
export const MISMATCH_MIN_PARTNERS = 3;
export const MISMATCH_FIELDS: "code" | "times" | "either" = "code";

/** A soft warning before Push: this entry's code or times differ from every one of the worker's
 * usual partners already entered today (often a misread line of the paper sheet). */
export function crewMismatch(month: Month, sheet: number, worker: Worker, today: TodayEntry[], entry: Pick<TodayEntry, "code" | "time_in" | "time_out">): TodayEntry[] | null {
  const { partners } = usualPartners(month, sheet, worker);
  const present = today.filter((t) => t.calling_name !== worker.calling_name && partners.has(t.calling_name));
  if (present.length < MISMATCH_MIN_PARTNERS) return null;
  const differs = (t: TodayEntry) => {
    const code = t.code !== entry.code;
    const times = t.time_in !== entry.time_in || t.time_out !== entry.time_out;
    return MISMATCH_FIELDS === "code" ? code : MISMATCH_FIELDS === "times" ? times : code || times;
  };
  return present.every(differs) ? present : null;
}
