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
