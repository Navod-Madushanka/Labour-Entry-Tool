// Analysis of the loaded month: hours by activity, place and trade, daily manpower, overtime,
// attendance and data quality. Pure functions over the day sheets already in memory (no Excel).
//
// Every entry is cut into slices, one per activity line (plus one for ZIDLE hours), each carrying
// its share of the entry's worked hours, overtime and the worker-day. Filters (trade, place, code,
// days) keep or drop slices, so every table and chart below adds up the same way.
import type { Issue, Master, Worker } from "./api";
import type { Month } from "./history";
import { placeSuffix } from "./codes";

export type DayKind = "Normal" | "Saturday" | "Sunday" | "Holiday";
export const NO_CODE = "ZIDLE (no activity)";
export const NO_PLACE = "No place";
export const NO_TRADE = "No trade";

export interface Slice {
  sheet: string;
  day: number;
  kind: DayKind;
  name: string; // calling name
  person: string; // the person (several calling names can be one person)
  trade: string;
  code: string;
  place: string;
  hours: number; // worked hours on this line
  ot: number; // its share of the entry's overtime
  share: number; // its share of the worker-day (0..1)
}

export interface EntryRow {
  sheet: string;
  day: number;
  kind: DayKind;
  name: string;
  person: string;
  trade: string;
  tin: number | null;
  tout: number | null;
  worked: number;
  ot: number;
  zidle: number;
  codes: string[];
  unknownCodes: string[];
  issues: Issue[];
}

export interface Data {
  slices: Slice[];
  entries: EntryRow[];
  days: { sheet: string; day: number; date: string | null; kind: DayKind }[];
  workers: Map<string, Worker>; // calling name -> worker
  withActivities: boolean;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export function dayKind(dayType: unknown, date: string | null, holidays: string[]): DayKind {
  const t = text(dayType).toLowerCase();
  if ((date && holidays.includes(date)) || t === "holiday") return "Holiday";
  if (t === "sunday") return "Sunday";
  if (t === "saturday") return "Saturday";
  if (date) {
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (wd === 0) return "Sunday";
    if (wd === 6 && t !== "normal day") return "Saturday";
  }
  return "Normal";
}

/** Cut the month into slices and entry rows. Blank blocks and junk values are skipped. */
export function buildData(month: Month, master: Pick<Master, "workers" | "places" | "holidays" | "activities" | "check_activities">): Data {
  const workers = new Map(master.workers.map((w) => [w.calling_name, w]));
  const valid = new Set(master.activities.map((a) => a.trim()));
  const slices: Slice[] = [];
  const entries: EntryRow[] = [];
  const days: Data["days"] = [];
  const sheets = Object.keys(month).sort((a, b) => Number(a) - Number(b));
  for (const sheet of sheets) {
    const d = month[sheet];
    const day = Number(sheet);
    const date = d.header.date ?? d.expected_date ?? null;
    const kind = dayKind(d.header.day_type, date, master.holidays ?? []);
    days.push({ sheet, day, date, kind });
    for (const v of d.entries) {
      const e = v.entry;
      const name = text(e.calling_name);
      const worked = num(v.computed?.effective);
      if (!name || worked === null || worked <= 0) continue;
      const w = workers.get(name);
      const person = text(w?.person) || name;
      const trade = text(w?.trade_group) || NO_TRADE;
      const ot = Math.max(num(v.computed?.ot_raw) ?? 0, 0);
      const zidle = Math.max(num(v.computed?.zidle) ?? 0, 0);
      const lines: { code: string; hours: number }[] = [];
      const coded = e.activities.filter((a) => text(a.code));
      for (const a of coded) {
        const h = num(a.hours) ?? (coded.length === 1 ? worked - zidle : 0);
        if (h > 0) lines.push({ code: text(a.code), hours: h });
      }
      const lineSum = lines.reduce((s, l) => s + l.hours, 0);
      const idle = master.check_activities ? zidle : Math.max(worked - lineSum, 0);
      if (idle > 0) lines.push({ code: NO_CODE, hours: idle });
      if (!lines.length) lines.push({ code: NO_CODE, hours: worked });
      const total = lines.reduce((s, l) => s + l.hours, 0);
      for (const l of lines) {
        const share = total > 0 ? l.hours / total : 0;
        const suffix = l.code === NO_CODE ? null : placeSuffix(l.code);
        slices.push({
          sheet, day, kind, name, person, trade, code: l.code,
          place: (suffix && master.places?.[suffix]) || (suffix ? `-${suffix}` : NO_PLACE),
          hours: worked * share, ot: ot * share, share,
        }); // prettier-ignore
      }
      const codes = coded.map((a) => text(a.code));
      entries.push({
        sheet, day, kind, name, person, trade, tin: num(e.time_in), tout: num(e.time_out), worked, ot, zidle, codes,
        unknownCodes: master.check_activities && valid.size ? codes.filter((c) => !valid.has(c)) : [],
        issues: v.issues ?? [],
      }); // prettier-ignore
    }
  }
  return { slices, entries, days, workers, withActivities: master.check_activities };
}

export interface Filter {
  trade?: string;
  place?: string;
  code?: string;
  from?: number;
  to?: number;
}

export function applyFilter(data: Data, f: Filter): { slices: Slice[]; entries: EntryRow[] } {
  const inDays = (d: number) => (f.from === undefined || d >= f.from) && (f.to === undefined || d <= f.to);
  const slices = data.slices.filter(
    (s) => inDays(s.day) && (!f.trade || s.trade === f.trade) && (!f.place || s.place === f.place) && (!f.code || s.code === f.code),
  );
  const keys = new Set(slices.map((s) => `${s.sheet}|${s.name}`));
  const entries = data.entries.filter((e) => keys.has(`${e.sheet}|${e.name}`));
  return { slices, entries };
}

// ------------------------------------------------------------------------------- aggregates

export interface Group {
  key: string;
  hours: number;
  ot: number;
  normal: number;
  workerDays: number; // sum of shares
  workers: number; // distinct people
  first: number | null;
  last: number | null;
  days: number; // days with any hours
  pct: number; // share of all hours
  place?: string;
  breakdown: { key: string; hours: number }[]; // by trade (codes, places) or by code (trades)
}

function group(slices: Slice[], keyOf: (s: Slice) => string, subOf: (s: Slice) => string): Group[] {
  const total = slices.reduce((s, x) => s + x.hours, 0);
  const m = new Map<string, { g: Group; people: Set<string>; dayset: Set<number>; sub: Map<string, number> }>();
  for (const s of slices) {
    const k = keyOf(s);
    let item = m.get(k);
    if (!item) {
      item = { g: { key: k, hours: 0, ot: 0, normal: 0, workerDays: 0, workers: 0, first: null, last: null, days: 0, pct: 0, place: s.place, breakdown: [] }, people: new Set(), dayset: new Set(), sub: new Map() };
      m.set(k, item);
    }
    const g = item.g;
    g.hours += s.hours;
    g.ot += s.ot;
    g.workerDays += s.share;
    g.first = g.first === null ? s.day : Math.min(g.first, s.day);
    g.last = g.last === null ? s.day : Math.max(g.last, s.day);
    item.people.add(s.person);
    item.dayset.add(s.day);
    item.sub.set(subOf(s), (item.sub.get(subOf(s)) ?? 0) + s.hours);
  }
  return [...m.values()]
    .map(({ g, people, dayset, sub }) => ({
      ...g,
      normal: g.hours - g.ot,
      workers: people.size,
      days: dayset.size,
      pct: total > 0 ? g.hours / total : 0,
      breakdown: [...sub].map(([key, hours]) => ({ key, hours })).sort((a, b) => b.hours - a.hours),
    }))
    .sort((a, b) => b.hours - a.hours);
}

export const byCode = (s: Slice[]) => group(s, (x) => x.code, (x) => x.trade);
export const byPlace = (s: Slice[]) => group(s, (x) => x.place, (x) => x.trade);
export const byTrade = (s: Slice[]) => group(s, (x) => x.trade, (x) => x.code);

export interface Kpis {
  hours: number;
  normal: number;
  ot: number;
  otPct: number;
  workerDays: number;
  people: number;
  workDays: number; // days with any hours
  avgHeadcount: number;
  peak: { day: number; count: number } | null;
  idle: number; // ZIDLE hours
  codes: number;
}

export function kpis(slices: Slice[]): Kpis {
  const hours = slices.reduce((s, x) => s + x.hours, 0);
  const ot = slices.reduce((s, x) => s + x.ot, 0);
  const perDay = new Map<number, Set<string>>();
  for (const s of slices) perDay.set(s.day, (perDay.get(s.day) ?? new Set()).add(s.person));
  let peak: Kpis["peak"] = null;
  let sum = 0;
  for (const [day, people] of perDay) {
    sum += people.size;
    if (!peak || people.size > peak.count) peak = { day, count: people.size };
  }
  return {
    hours, ot, normal: hours - ot, otPct: hours > 0 ? ot / hours : 0,
    workerDays: slices.reduce((s, x) => s + x.share, 0),
    people: new Set(slices.map((s) => s.person)).size,
    workDays: perDay.size, avgHeadcount: perDay.size ? sum / perDay.size : 0, peak,
    idle: slices.filter((s) => s.code === NO_CODE).reduce((s, x) => s + x.hours, 0),
    codes: new Set(slices.filter((s) => s.code !== NO_CODE).map((s) => s.code)).size,
  }; // prettier-ignore
}

export interface DayRow {
  sheet: string;
  day: number;
  date: string | null;
  kind: DayKind;
  headcount: number;
  byTrade: Map<string, number>; // people per trade
  hours: number;
  ot: number;
}

/** One row per day sheet (also days without work, so gaps show). */
export function daily(data: Data, slices: Slice[], f: Filter = {}): DayRow[] {
  const rows = new Map<number, { people: Set<string>; trade: Map<string, Set<string>>; hours: number; ot: number }>();
  for (const s of slices) {
    const r = rows.get(s.day) ?? { people: new Set(), trade: new Map(), hours: 0, ot: 0 };
    r.people.add(s.person);
    r.trade.set(s.trade, (r.trade.get(s.trade) ?? new Set()).add(s.person));
    r.hours += s.hours;
    r.ot += s.ot;
    rows.set(s.day, r);
  }
  return data.days
    .filter((d) => (f.from === undefined || d.day >= f.from) && (f.to === undefined || d.day <= f.to))
    .map((d) => {
      const r = rows.get(d.day);
      return {
        ...d,
        headcount: r?.people.size ?? 0,
        byTrade: new Map([...(r?.trade ?? new Map<string, Set<string>>())].map(([t, p]) => [t, p.size])),
        hours: r?.hours ?? 0,
        ot: r?.ot ?? 0,
      };
    });
}

/** Hours per code per day for the `top` codes with most hours: when each task ran. */
export function heatmap(slices: Slice[], top = 12): { codes: string[]; cells: Map<string, Map<number, number>>; max: number } {
  const codes = byCode(slices).filter((g) => g.key !== NO_CODE).slice(0, top).map((g) => g.key);
  const keep = new Set(codes);
  const cells = new Map<string, Map<number, number>>(codes.map((c) => [c, new Map()]));
  let max = 0;
  for (const s of slices) {
    if (!keep.has(s.code)) continue;
    const row = cells.get(s.code)!;
    const v = (row.get(s.day) ?? 0) + s.hours;
    row.set(s.day, v);
    max = Math.max(max, v);
  }
  return { codes, cells, max };
}

export interface PersonRow {
  person: string;
  names: string[];
  name: string; // full name from Labour Detail
  trade: string;
  employeeCode: string;
  days: number;
  hours: number;
  ot: number;
  saturdays: number;
  sundays: number;
  holidays: number;
  late: number; // Out after 22:00
  overnight: number; // Out past midnight
  longestRun: number; // most days in a row with work
  currentRun: number; // days in a row up to the last day with work on site
  daysOff: number; // site work days without this person (between their first and last day)
  first: number;
  last: number;
}

/** Per person over the filtered entries. Runs count calendar days of the sheets (a site day with
 * nobody working, like a holiday, breaks no one's run; a site day without this person does). */
export function people(data: Data, entries: EntryRow[]): PersonRow[] {
  const siteDays = [...new Set(entries.map((e) => e.day))].sort((a, b) => a - b);
  const lastSite = siteDays.length ? siteDays[siteDays.length - 1] : 0;
  const m = new Map<string, { r: PersonRow; dayset: Set<number> }>();
  for (const e of entries) {
    let item = m.get(e.person);
    if (!item) {
      const w = data.workers.get(e.name);
      item = {
        r: { person: e.person, names: [], name: text(w?.name), trade: e.trade, employeeCode: text(w?.employee_code),
             days: 0, hours: 0, ot: 0, saturdays: 0, sundays: 0, holidays: 0, late: 0, overnight: 0,
             longestRun: 0, currentRun: 0, daysOff: 0, first: e.day, last: e.day }, // prettier-ignore
        dayset: new Set(),
      };
      m.set(e.person, item);
    }
    const r = item.r;
    if (!r.names.includes(e.name)) r.names.push(e.name);
    if (!item.dayset.has(e.day)) {
      item.dayset.add(e.day);
      r.days += 1;
      if (e.kind === "Saturday") r.saturdays += 1;
      if (e.kind === "Sunday") r.sundays += 1;
      if (e.kind === "Holiday") r.holidays += 1;
    }
    r.hours += e.worked;
    r.ot += e.ot;
    if (e.tout !== null && e.tout > 22) r.late += 1;
    if (e.tout !== null && e.tout >= 24) r.overnight += 1;
    r.first = Math.min(r.first, e.day);
    r.last = Math.max(r.last, e.day);
  }
  for (const { r, dayset } of m.values()) {
    let run = 0;
    for (const d of siteDays) {
      if (dayset.has(d)) {
        run += 1;
        r.longestRun = Math.max(r.longestRun, run);
      } else run = 0;
      if (d >= r.first && d <= r.last && !dayset.has(d)) r.daysOff += 1;
    }
    r.currentRun = dayset.has(lastSite) ? run : 0;
  }
  return [...m.values()].map((x) => x.r).sort((a, b) => b.hours - a.hours);
}

export interface Quality {
  idle: { sheet: string; name: string; hours: number }[];
  noCode: { sheet: string; name: string; hours: number }[];
  rareCodes: { code: string; uses: number; names: string[]; sheets: string[] }[];
  unknownCodes: { code: string; uses: number; sheets: string[] }[];
  longDays: { sheet: string; name: string; worked: number; shift: [number | null, number | null] }[];
  noEmployeeCode: { name: string; status: string; days: number }[];
  issues: { rule: string; severity: string; title: string; count: number; example: string }[];
}

export const LONG_DAY = 14; // worked hours above this are listed

export function quality(data: Data, entries: EntryRow[]): Quality {
  const idle = data.withActivities
    ? entries.filter((e) => e.zidle > 0).map((e) => ({ sheet: e.sheet, name: e.name, hours: e.zidle })).sort((a, b) => b.hours - a.hours)
    : [];
  const noCode = data.withActivities ? entries.filter((e) => !e.codes.length).map((e) => ({ sheet: e.sheet, name: e.name, hours: e.worked })) : [];
  const uses = new Map<string, { n: number; names: Set<string>; sheets: Set<string> }>();
  for (const e of entries)
    for (const c of new Set(e.codes)) {
      const u = uses.get(c) ?? { n: 0, names: new Set(), sheets: new Set() };
      u.n += 1;
      u.names.add(e.name);
      u.sheets.add(e.sheet);
      uses.set(c, u);
    }
  const rareCodes = [...uses]
    .filter(([, u]) => u.n <= 2)
    .map(([code, u]) => ({ code, uses: u.n, names: [...u.names], sheets: [...u.sheets] }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const unknown = new Map<string, { n: number; sheets: Set<string> }>();
  for (const e of entries)
    for (const c of e.unknownCodes) {
      const u = unknown.get(c) ?? { n: 0, sheets: new Set() };
      u.n += 1;
      u.sheets.add(e.sheet);
      unknown.set(c, u);
    }
  const longDays = entries
    .filter((e) => e.worked > LONG_DAY)
    .map((e) => ({ sheet: e.sheet, name: e.name, worked: e.worked, shift: [e.tin, e.tout] as [number | null, number | null] }))
    .sort((a, b) => b.worked - a.worked);
  const daysBy = new Map<string, Set<string>>();
  for (const e of entries) daysBy.set(e.name, (daysBy.get(e.name) ?? new Set()).add(e.sheet));
  const noEmployeeCode = [...daysBy]
    .map(([name, s]) => ({ name, status: data.workers.get(name)?.code_status ?? "missing", days: s.size }))
    .filter((x) => x.status !== "valid")
    .sort((a, b) => b.days - a.days);
  const rules = new Map<string, { rule: string; severity: string; title: string; count: number; example: string }>();
  for (const e of entries)
    for (const i of e.issues) {
      if (i.severity === "INFO") continue;
      const r = rules.get(i.rule) ?? { rule: i.rule, severity: i.severity, title: i.plain?.title || i.message, count: 0, example: `${e.name}, sheet ${e.sheet}` };
      r.count += 1;
      rules.set(i.rule, r);
    }
  return {
    idle, noCode, rareCodes, longDays, noEmployeeCode,
    unknownCodes: [...unknown].map(([code, u]) => ({ code, uses: u.n, sheets: [...u.sheets] })).sort((a, b) => b.uses - a.uses),
    issues: [...rules.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "BLOCK" ? -1 : 1)),
  }; // prettier-ignore
}

// ------------------------------------------------------------------- month-to-month compare

export interface BookSummary {
  workbook: string;
  month: string;
  savedAt: string;
  days: number; // day sheets loaded
  hours: number;
  ot: number;
  workerDays: number;
  people: number;
  avgHeadcount: number;
  peak: number;
  idle: number;
  trades: Record<string, number>; // hours
  codes: Record<string, number>; // hours, top 15
}

export function summarise(workbook: string, monthIso: string, data: Data, now = new Date()): BookSummary {
  const k = kpis(data.slices);
  const trades: Record<string, number> = {};
  for (const g of byTrade(data.slices)) trades[g.key] = round2(g.hours);
  const codes: Record<string, number> = {};
  for (const g of byCode(data.slices).slice(0, 15)) codes[g.key] = round2(g.hours);
  return {
    workbook, month: monthIso, savedAt: now.toISOString(), days: data.days.length,
    hours: round2(k.hours), ot: round2(k.ot), workerDays: round2(k.workerDays), people: k.people,
    avgHeadcount: round2(k.avgHeadcount), peak: k.peak?.count ?? 0, idle: round2(k.idle), trades, codes,
  }; // prettier-ignore
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
