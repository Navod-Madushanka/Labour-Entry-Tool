// Analysis of the loaded month: hours by activity, place and trade, daily manpower, overtime,
// attendance and data quality. Pure functions over the day sheets already in memory (no Excel).
//
// Every entry is cut into slices, one per activity line (plus one for ZIDLE hours), each carrying
// its share of the entry's worked hours, overtime and the worker-day. Filters (trade, place, code,
// days) keep or drop slices, so every table and chart below adds up the same way.
import type { Cause, Issue, Lost, Master, Rates, Worker } from "./api";
import type { Month } from "./history";
import { placeSuffix } from "./codes";

export type DayKind = "Normal" | "Saturday" | "Sunday" | "Holiday";
export const NO_CODE = "Unallocated (ZIDLE)"; // worked hours not booked to any activity code
export const NO_PLACE = "No place";
export const NO_TRADE = "No trade";
export const NO_SUPERVISOR = "No supervisor";

export interface Slice {
  sheet: string;
  day: number;
  kind: DayKind;
  name: string; // calling name
  person: string; // the person (several calling names can be one person)
  trade: string;
  supervisor: string; // whose manpower sheet the entry came from (given at push)
  code: string;
  place: string;
  hours: number; // worked hours on this line
  ot: number; // its share of the entry's overtime
  share: number; // its share of the worker-day (0..1)
  cost: number; // at standard rates: normal hours x hourly rate + OT x hourly rate x multiplier
  otPremium: number; // the part of the cost above the normal rate (OT x hourly x (multiplier - 1))
  rated: boolean; // a rate was known for the worker (else cost is 0)
}

export interface EntryRow {
  sheet: string;
  day: number;
  kind: DayKind;
  name: string;
  person: string;
  trade: string;
  supervisor: string;
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

/** Standard daily rate of a worker: Labour Detail's own (when the QS uses it), else the trade's. */
export function dailyRate(rates: Rates, name: string, trade: string): number {
  return rates.workers?.[name] || rates.trades?.[trade] || 0;
}

/** What an overtime hour costs against a normal one, by day kind. Excel counts every hour of a
 * Sunday or holiday as overtime, so those days cost hours x rate x their multiplier. */
export function multiplier(rates: Rates, kind: DayKind): number {
  return kind === "Holiday" ? rates.holiday ?? 2 : kind === "Sunday" ? rates.sunday ?? 1.5 : rates.ot ?? 1.5;
}

export const hasRates = (rates: Rates | undefined) => Boolean(rates && (Object.keys(rates.trades ?? {}).length || Object.keys(rates.workers ?? {}).length));

/** Cut the month into slices and entry rows. Blank blocks and junk values are skipped. */
export function buildData(
  month: Month,
  master: Pick<Master, "workers" | "places" | "holidays" | "activities" | "check_activities"> & { rates?: Rates },
  owners: Map<string, string> = new Map(), // "sheet|calling name" -> supervisor
): Data {
  const workers = new Map(master.workers.map((w) => [w.calling_name, w]));
  const valid = new Set(master.activities.map((a) => a.trim()));
  const rates = master.rates ?? {};
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
      const supervisor = owners.get(`${sheet}|${name}`) ?? NO_SUPERVISOR;
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
      const daily = dailyRate(rates, name, trade);
      const hourly = daily / (rates.day_hours || 8);
      const mult = multiplier(rates, kind);
      for (const l of lines) {
        const share = total > 0 ? l.hours / total : 0;
        const suffix = l.code === NO_CODE ? null : placeSuffix(l.code);
        slices.push({
          sheet, day, kind, name, person, trade, supervisor, code: l.code,
          place: (suffix && master.places?.[suffix]) || (suffix ? `-${suffix}` : NO_PLACE),
          hours: worked * share, ot: ot * share, share,
          cost: hourly * ((worked - ot) * share + ot * share * mult), otPremium: hourly * ot * share * (mult - 1), rated: daily > 0,
        }); // prettier-ignore
      }
      const codes = coded.map((a) => text(a.code));
      entries.push({
        sheet, day, kind, name, person, trade, supervisor, tin: num(e.time_in), tout: num(e.time_out), worked, ot, zidle, codes,
        unknownCodes: master.check_activities && valid.size ? codes.filter((c) => !valid.has(c)) : [],
        issues: v.issues ?? [],
      }); // prettier-ignore
    }
  }
  return { slices, entries, days, workers, withActivities: master.check_activities };
}

export interface Filter {
  trade?: string;
  supervisor?: string;
  place?: string;
  code?: string;
  from?: number;
  to?: number;
}

export function applyFilter(data: Data, f: Filter): { slices: Slice[]; entries: EntryRow[] } {
  const inDays = (d: number) => (f.from === undefined || d >= f.from) && (f.to === undefined || d <= f.to);
  const slices = data.slices.filter(
    (s) => inDays(s.day) && (!f.trade || s.trade === f.trade) && (!f.supervisor || s.supervisor === f.supervisor) && (!f.place || s.place === f.place) && (!f.code || s.code === f.code),
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
  cost: number; // at standard rates
  otPremium: number;
  ratedHours: number; // hours with a known rate
  costPct: number; // share of all cost
  place?: string;
  breakdown: { key: string; hours: number }[]; // by trade (codes, places) or by code (trades)
}

function group(slices: Slice[], keyOf: (s: Slice) => string, subOf: (s: Slice) => string): Group[] {
  const total = slices.reduce((s, x) => s + x.hours, 0);
  const totalCost = slices.reduce((s, x) => s + x.cost, 0);
  const m = new Map<string, { g: Group; people: Set<string>; dayset: Set<number>; sub: Map<string, number> }>();
  for (const s of slices) {
    const k = keyOf(s);
    let item = m.get(k);
    if (!item) {
      item = { g: { key: k, hours: 0, ot: 0, normal: 0, workerDays: 0, workers: 0, first: null, last: null, days: 0, pct: 0, cost: 0, otPremium: 0, ratedHours: 0, costPct: 0, place: s.place, breakdown: [] }, people: new Set(), dayset: new Set(), sub: new Map() };
      m.set(k, item);
    }
    const g = item.g;
    g.hours += s.hours;
    g.ot += s.ot;
    g.cost += s.cost;
    g.otPremium += s.otPremium;
    if (s.rated) g.ratedHours += s.hours;
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
      costPct: totalCost > 0 ? g.cost / totalCost : 0,
      breakdown: [...sub].map(([key, hours]) => ({ key, hours })).sort((a, b) => b.hours - a.hours),
    }))
    .sort((a, b) => b.hours - a.hours);
}

export const byCode = (s: Slice[]) => group(s, (x) => x.code, (x) => x.trade);
export const byPlace = (s: Slice[]) => group(s, (x) => x.place, (x) => x.trade);
export const byTrade = (s: Slice[]) => group(s, (x) => x.trade, (x) => x.code);
export const bySupervisor = (s: Slice[]) => group(s, (x) => x.supervisor, (x) => x.code);

/** Who worked under whom, when: one row per entry (worker, day, supervisor, hours, codes). */
export interface SupervisedDay {
  sheet: string;
  day: number;
  date: string | null;
  name: string;
  person: string;
  trade: string;
  supervisor: string;
  hours: number;
  ot: number;
  codes: string[];
}

export function supervisedDays(data: Data, entries: EntryRow[]): SupervisedDay[] {
  const dates = new Map(data.days.map((d) => [d.sheet, d.date]));
  return entries.map((e) => ({
    sheet: e.sheet, day: e.day, date: dates.get(e.sheet) ?? null, name: e.name, person: e.person, trade: e.trade,
    supervisor: e.supervisor, hours: e.worked, ot: e.ot, codes: e.codes,
  })); // prettier-ignore
}

/** Whose worker each one is: the supervisor of most of their days (a supervisor beats "No
 * supervisor"), and every supervisor they worked under with the days. */
export interface WorkerSupervisor {
  name: string; // calling name (the first one, when a person has several)
  person: string;
  trade: string;
  supervisor: string; // the main one
  share: number; // of the worker's days under the main one (0..1)
  days: number;
  all: { supervisor: string; days: number; first: number; last: number }[]; // most days first
}

export function workerSupervisors(entries: EntryRow[]): WorkerSupervisor[] {
  const by = new Map<string, { names: string[]; trade: string; sup: Map<string, { days: Set<number>; first: number; last: number }> }>();
  for (const e of entries) {
    const r = by.get(e.person) ?? { names: [] as string[], trade: e.trade, sup: new Map() };
    if (!r.names.includes(e.name)) r.names.push(e.name);
    const s = r.sup.get(e.supervisor) ?? { days: new Set<number>(), first: e.day, last: e.day };
    s.days.add(e.day);
    s.first = Math.min(s.first, e.day);
    s.last = Math.max(s.last, e.day);
    r.sup.set(e.supervisor, s);
    by.set(e.person, r);
  }
  return [...by].map(([person, r]) => {
    const all = [...r.sup]
      .map(([supervisor, x]) => ({ supervisor, days: x.days.size, first: x.first, last: x.last }))
      .sort((a, b) => Number(a.supervisor === NO_SUPERVISOR) - Number(b.supervisor === NO_SUPERVISOR) || b.days - a.days || b.last - a.last);
    const days = new Set([...r.sup.values()].flatMap((x) => [...x.days])).size;
    return { name: r.names.sort()[0], person, trade: r.trade, supervisor: all[0].supervisor, share: days ? all[0].days / days : 0, days, all };
  });
}

/** Where each supervisor's people worked: supervisor x place x activity code. */
export interface SupervisorWork {
  supervisor: string;
  place: string;
  code: string;
  hours: number;
  ot: number;
  people: number;
  days: number;
  first: number;
  last: number;
}

export function supervisorWork(slices: Slice[]): SupervisorWork[] {
  const by = new Map<string, { s: Slice; hours: number; ot: number; people: Set<string>; days: Set<number>; first: number; last: number }>();
  for (const x of slices) {
    const key = `${x.supervisor}|${x.place}|${x.code}`;
    const r = by.get(key) ?? { s: x, hours: 0, ot: 0, people: new Set<string>(), days: new Set<number>(), first: x.day, last: x.day };
    r.hours += x.hours;
    r.ot += x.ot;
    r.people.add(x.person);
    r.days.add(x.day);
    r.first = Math.min(r.first, x.day);
    r.last = Math.max(r.last, x.day);
    by.set(key, r);
  }
  return [...by.values()]
    .map((r) => ({ supervisor: r.s.supervisor, place: r.s.place, code: r.s.code, hours: r.hours, ot: r.ot, people: r.people.size, days: r.days.size, first: r.first, last: r.last }))
    .sort((a, b) => a.supervisor.localeCompare(b.supervisor) || b.hours - a.hours);
}

/** People per day on each supervisor's sheets: day -> supervisor -> people. */
export function supervisorDays(slices: Slice[]): Map<number, Map<string, number>> {
  const sets = new Map<number, Map<string, Set<string>>>();
  for (const s of slices) {
    const day = sets.get(s.day) ?? new Map<string, Set<string>>();
    day.set(s.supervisor, (day.get(s.supervisor) ?? new Set()).add(s.person));
    sets.set(s.day, day);
  }
  return new Map([...sets].map(([d, m]) => [d, new Map([...m].map(([k, v]) => [k, v.size]))]));
}

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
  cost: number; // labour cost at standard rates
  otPremium: number;
  idleCost: number; // cost of unallocated hours
  coverage: number; // share of hours with a known rate (0..1)
  costPerWorkerDay: number;
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
    cost: sumBy(slices, (x) => x.cost), otPremium: sumBy(slices, (x) => x.otPremium),
    idleCost: sumBy(slices.filter((s) => s.code === NO_CODE), (x) => x.cost),
    coverage: hours > 0 ? sumBy(slices.filter((s) => s.rated), (x) => x.hours) / hours : 0,
    // over the rated worker-days only, so missing rates do not pull the average down
    costPerWorkerDay: sumBy(slices, (x) => x.cost) / (sumBy(slices.filter((s) => s.rated), (x) => x.share) || 1),
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

const sumBy = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------- as-built programme

/** The work part of a code, without its place: "03-11-00-00-P" -> "03-11-00-00". */
export function workPart(code: string): string {
  const suffix = placeSuffix(code);
  return suffix ? code.slice(0, code.length - suffix.length - 1) : code;
}

/** One activity's bar on the as-built programme: first to last day, and the crew each day. */
export interface ProgrammeBar {
  key: string; // activity code
  place: string;
  first: number;
  last: number;
  hours: number;
  people: Map<number, number>; // day -> distinct people on the code that day
  activeDays: number; // days with work between first and last
  peak: number; // most people on one day
}

export function programme(slices: Slice[]): ProgrammeBar[] {
  const by = new Map<string, { b: ProgrammeBar; sets: Map<number, Set<string>> }>();
  for (const s of slices) {
    if (s.code === NO_CODE) continue;
    let r = by.get(s.code);
    if (!r) {
      r = { b: { key: s.code, place: s.place, first: s.day, last: s.day, hours: 0, people: new Map(), activeDays: 0, peak: 0 }, sets: new Map() };
      by.set(s.code, r);
    }
    r.b.first = Math.min(r.b.first, s.day);
    r.b.last = Math.max(r.b.last, s.day);
    r.b.hours += s.hours;
    r.sets.set(s.day, (r.sets.get(s.day) ?? new Set()).add(s.person));
  }
  return [...by.values()]
    .map(({ b, sets }) => {
      for (const [d, p] of sets) b.people.set(d, p.size);
      b.activeDays = sets.size;
      b.peak = Math.max(0, ...[...b.people.values()]);
      return b;
    })
    .sort((a, b) => a.first - b.first || b.hours - a.hours || a.key.localeCompare(b.key));
}

/** Cumulative hours by day per key (the `top` keys with most hours), plus "All": S-curves. */
export interface Curve {
  key: string;
  total: number;
  points: { day: number; cum: number }[]; // one point per day in `days`
}

export const ALL = "All work";

export function sCurves(slices: Slice[], keyOf: (s: Slice) => string, days: number[], top = 6): Curve[] {
  const per = new Map<string, Map<number, number>>();
  const add = (k: string, d: number, h: number) => {
    const m = per.get(k) ?? new Map<number, number>();
    m.set(d, (m.get(d) ?? 0) + h);
    per.set(k, m);
  };
  for (const s of slices) {
    add(ALL, s.day, s.hours);
    add(keyOf(s), s.day, s.hours);
  }
  const totals = [...per].map(([k, m]) => ({ k, total: [...m.values()].reduce((a, b) => a + b, 0) }));
  const keep = totals.filter((t) => t.k !== ALL).sort((a, b) => b.total - a.total).slice(0, top).map((t) => t.k);
  return [ALL, ...keep].filter((k) => per.has(k)).map((k) => {
    const m = per.get(k)!;
    let cum = 0;
    const points = days.map((day) => ({ day, cum: (cum += m.get(day) ?? 0) }));
    return { key: k, total: cum, points };
  });
}

/** Flowline: each activity (work part) at each place, from its first to its last day there.
 * Places run bottom to top in the PM's order; places not in it follow, by name. */
export interface FlowSegment {
  activity: string; // work part, e.g. 03-11-00-00
  suffix: string; // place suffix
  first: number;
  last: number;
  hours: number;
}

export function flowline(slices: Slice[], order: string[]): { levels: string[]; activities: string[]; segments: FlowSegment[] } {
  const by = new Map<string, FlowSegment>();
  const hoursOf = new Map<string, number>();
  for (const s of slices) {
    if (s.code === NO_CODE) continue;
    const suffix = placeSuffix(s.code);
    if (!suffix) continue;
    const activity = workPart(s.code);
    const key = `${activity}|${suffix}`;
    const seg = by.get(key) ?? { activity, suffix, first: s.day, last: s.day, hours: 0 };
    seg.first = Math.min(seg.first, s.day);
    seg.last = Math.max(seg.last, s.day);
    seg.hours += s.hours;
    by.set(key, seg);
    hoursOf.set(activity, (hoursOf.get(activity) ?? 0) + s.hours);
  }
  const present = new Set([...by.values()].map((x) => x.suffix));
  const levels = [...order.filter((x) => present.has(x)), ...[...present].filter((x) => !order.includes(x)).sort()];
  const activities = [...hoursOf].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  return { levels, activities, segments: [...by.values()] };
}

/** Monday of the week a date is in (ISO date). */
export function weekOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Planned people a day from the PM's look-ahead (trade -> week Monday -> people), for one trade
 * or all; undefined for a day whose week has no plan. */
export function planned(plan: Record<string, Record<string, number>>, date: string | null, trade?: string): number | undefined {
  if (!date) return undefined;
  const week = weekOf(date);
  const trades = trade ? [trade] : Object.keys(plan);
  let sum = 0, any = false;
  for (const t of trades) {
    const v = plan[t]?.[week];
    if (v !== undefined) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : undefined;
}

// ------------------------------------------------------------------------ weekly site report

export interface Period {
  key: string; // "w:2026-10-05" or "month"
  label: string;
  from: number; // first day sheet
  to: number; // last day sheet
}

/** The weeks of the loaded month (Monday to Sunday, cut at the month's ends), then the month. */
export function periods(data: Data): Period[] {
  const by = new Map<string, number[]>();
  for (const d of data.days) {
    if (!d.date) continue;
    const w = weekOf(d.date);
    by.set(w, [...(by.get(w) ?? []), d.day]);
  }
  const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  const weeks = [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([w, ds]) => {
    const from = Math.min(...ds), to = Math.max(...ds);
    return { key: `w:${w}`, label: `Week commencing ${fmt(w)} (days ${from}–${to})`, from, to };
  });
  const all = data.days.map((d) => d.day);
  return all.length ? [...weeks, { key: "month", label: "Whole month", from: Math.min(...all), to: Math.max(...all) }] : weeks;
}

export const within = (slices: Slice[], from: number, to: number) => slices.filter((s) => s.day >= from && s.day <= to);

/** One line of "what changed": written by a rule, never by guesswork; `view` is the Analysis
 * view with the table behind it. */
export interface Change {
  text: string;
  view: "trades" | "activities" | "overtime" | "quality" | "attendance" | "overview" | "programme" | "lost";
  tone: "up" | "down" | "info" | "warn";
}

const pctTxt = (x: number) => `${Math.round(x * 100)}%`;
const hTxt = (x: number) => Math.round(x).toLocaleString();

/** The rule-written lines for a period against the one before it (`prev` empty: the first week,
 * so only what stands out in this one). `label` names a code, e.g. with its description. */
export function whatChanged(data: Data, cur: Period, prev: Period | null, label: (code: string) => string, money = false): Change[] {
  const out: Change[] = [];
  const now = within(data.slices, cur.from, cur.to);
  const was = prev ? within(data.slices, prev.from, prev.to) : [];
  if (!now.length) return [{ text: "No hours were booked in this period.", view: "overview", tone: "info" }];
  const kn = kpis(now), kw = was.length ? kpis(was) : null;
  const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;

  // Periods with a different number of days with work (a week still being entered, a short first
  // week) are compared per day with work, so a part-week does not read as a fall.
  const perDay = Boolean(kw && kw.workDays !== kn.workDays && kn.workDays && kw.workDays);
  const nowDiv = perDay ? kn.workDays : 1, wasDiv = perDay && kw ? kw.workDays : 1;
  const unit = perDay ? " a day" : "";

  // headline: hours (and cost) against the previous period
  if (kw) {
    const a = kn.hours / nowDiv, b = kw.hours / wasDiv, d = a - b;
    const head = perDay ? `${hTxt(kn.hours)} hours over ${kn.workDays} day${kn.workDays === 1 ? "" : "s"} with work (${hTxt(a)} a day)` : `${hTxt(kn.hours)} hours worked`;
    out.push({ text: `${head}, ${d >= 0 ? "up" : "down"} ${pctTxt(Math.abs(d) / (b || 1))}${unit} on the previous period (${hTxt(b)} h${unit})${money ? `; labour cost ${rs(kn.cost)} at standard rates (was ${rs(kw.cost)})` : ""}.`, view: "overview", tone: d >= 0 ? "up" : "down" });
  } else {
    out.push({ text: `${hTxt(kn.hours)} hours worked${money ? `, labour cost ${rs(kn.cost)} at standard rates` : ""}; no previous period in this workbook to compare with.`, view: "overview", tone: "info" });
  }

  // headcount
  out.push({ text: `Average headcount ${Math.round(kn.avgHeadcount)} a day${kw ? ` (was ${Math.round(kw.avgHeadcount)})` : ""}; peak ${kn.peak?.count ?? 0} on day ${kn.peak?.day ?? "–"}.`, view: "overview", tone: "info" });

  // biggest movers by trade
  if (kw) {
    const before = new Map(byTrade(was).map((g) => [g.key, g.hours / wasDiv]));
    const moves = byTrade(now).map((g) => ({ key: g.key, now: g.hours / nowDiv, was: before.get(g.key) ?? 0 }));
    for (const t of byTrade(was)) if (!moves.some((m) => m.key === t.key)) moves.push({ key: t.key, now: 0, was: t.hours / wasDiv });
    const big = moves.filter((m) => Math.abs(m.now - m.was) >= Math.max(16 / (perDay ? 6 : 1), (0.1 * kw.hours) / wasDiv / Math.max(moves.length, 1)))
      .sort((a, b) => Math.abs(b.now - b.was) - Math.abs(a.now - a.was)).slice(0, 2);
    for (const m of big) {
      const up = m.now > m.was;
      out.push({ text: `${m.key}: ${hTxt(m.was)} → ${hTxt(m.now)} h${unit} (${up ? "+" : "−"}${m.was ? pctTxt(Math.abs(m.now - m.was) / m.was) : "new"}).`, view: "trades", tone: up ? "up" : "down" });
    }
  }

  // activities started / with no hours any more
  const earlier = new Set(data.slices.filter((s) => s.day < cur.from).map((s) => s.code));
  const started = byCode(now).filter((g) => g.key !== NO_CODE && !earlier.has(g.key)).slice(0, 3);
  if (started.length && cur.key !== "month") out.push({ text: `Started: ${started.map((g) => `${label(g.key)} (day ${g.first})`).join("; ")}.`, view: "programme", tone: "info" });
  if (kw) {
    const nowCodes = new Set(now.map((s) => s.code));
    const later = new Set(data.slices.filter((s) => s.day > cur.to).map((s) => s.code));
    const stopped = byCode(was).filter((g) => g.key !== NO_CODE && !nowCodes.has(g.key) && !later.has(g.key)).slice(0, 3);
    if (stopped.length) out.push({ text: `No hours this period (finished or paused): ${stopped.map((g) => `${label(g.key)} (last day ${g.last})`).join("; ")}.`, view: "programme", tone: "info" });
  }

  // overtime share and who drove it
  if (kw && Math.abs(kn.otPct - kw.otPct) >= 0.02) {
    const rose = kn.otPct > kw.otPct;
    const key = (s: Slice) => `${s.trade}|${s.code}`;
    const sum = (xs: Slice[]) => { const m = new Map<string, number>(); for (const s of xs) m.set(key(s), (m.get(key(s)) ?? 0) + s.ot); return m; };
    const a = sum(now), b = sum(was);
    const drivers = [...new Set([...a.keys(), ...b.keys()])].map((k) => ({ k, d: (a.get(k) ?? 0) / nowDiv - (b.get(k) ?? 0) / wasDiv })).sort((x, y) => (rose ? y.d - x.d : x.d - y.d));
    const top = drivers[0];
    const [trade, code] = top ? top.k.split("|") : ["", ""];
    const drive = top && Math.abs(top.d) > 0 ? `; ${trade} on ${code === NO_CODE ? "unallocated hours" : label(code)} account for ${hTxt(Math.abs(top.d))} h${unit} of the change` : "";
    out.push({ text: `OT share ${rose ? "rose" : "fell"} from ${pctTxt(kw.otPct)} to ${pctTxt(kn.otPct)} of hours${drive}.`, view: "overtime", tone: rose ? "warn" : "down" });
  } else {
    out.push({ text: `Overtime ${hTxt(kn.ot)} h, ${pctTxt(kn.otPct)} of hours${money ? ` (OT premium ${rs(kn.otPremium)})` : ""}.`, view: "overtime", tone: "info" });
  }

  // unallocated hours
  const idleShare = kn.hours ? kn.idle / kn.hours : 0;
  const idleWas = kw && kw.hours ? kw.idle / kw.hours : null;
  if (data.withActivities && (idleShare >= 0.05 || (idleWas !== null && idleShare - idleWas >= 0.02))) {
    const perDay = new Map<number, number>();
    for (const s of now) if (s.code === NO_CODE) perDay.set(s.day, (perDay.get(s.day) ?? 0) + s.hours);
    const worst = [...perDay].sort((x, y) => y[1] - x[1])[0];
    out.push({ text: `Unallocated hours (ZIDLE) ${pctTxt(idleShare)} of hours${idleWas !== null ? ` (was ${pctTxt(idleWas)})` : ""}${worst ? `; most on day ${worst[0]} (${hTxt(worst[1])} h)` : ""}.`, view: "quality", tone: "warn" });
  }

  // long runs without a day off, by the end of the period (counts only, no names)
  const upTo = data.entries.filter((e) => e.day <= cur.to);
  const runs = people(data, upTo).filter((p) => p.currentRun >= 14);
  if (runs.length) out.push({ text: `${runs.length} worker${runs.length === 1 ? " has" : "s have"} worked 14 or more days in a row by day ${cur.to}.`, view: "attendance", tone: "warn" });
  return out;
}

/** The monthly labour return: people of each trade (class of personnel) on site each day. */
export function labourReturn(data: Data): { trades: string[]; rows: { day: number; date: string | null; kind: DayKind; byTrade: Map<string, number>; total: number }[] } {
  const rows = daily(data, data.slices).map((d) => ({ day: d.day, date: d.date, kind: d.kind, byTrade: d.byTrade, total: d.headcount }));
  const sums = new Map<string, number>();
  for (const r of rows) for (const [t, n] of r.byTrade) sums.set(t, (sums.get(t) ?? 0) + n);
  return { trades: [...sums].sort((a, b) => b[1] - a[1]).map(([t]) => t), rows };
}

// ------------------------------------------------------------------------ lost-time reasons

export const NO_REASON = "No reason given";

export interface LostSummary {
  byCause: { cause: string; label: string; party: string; hours: number; sheets: number }[];
  byParty: { party: string; hours: number }[];
  unallocated: number; // all unallocated hours in the slices
  explained: number; // of them, on supervisor sheets with a reason
  disrupted: { day: number; sheet: string; causes: string[]; note: string | null }[];
  compare: { label: string; days: number; headcount: number; hoursPerPerson: number; idleShare: number; otShare: number }[]; // disrupted vs clean
}

/** Unallocated (ZIDLE) hours by the reason given for their supervisor sheet (shared equally when
 * several causes were picked), by the responsible party, and disrupted days against clean ones. */
export function lostTime(data: Data, slices: Slice[], items: Lost[], causes: Cause[]): LostSummary {
  const info = new Map(causes.map((c) => [c.id, c]));
  const reason = new Map(items.filter((i) => i.supervisor).map((i) => [`${i.sheet}|${i.supervisor}`, i.causes]));
  const by = new Map<string, { hours: number; sheets: Set<string> }>();
  let unallocated = 0, explained = 0;
  for (const s of slices) {
    if (s.code !== NO_CODE) continue;
    unallocated += s.hours;
    const cs = reason.get(`${s.sheet}|${s.supervisor}`) ?? [];
    const keys = cs.length ? cs : [NO_REASON];
    if (cs.length) explained += s.hours;
    for (const k of keys) {
      const r = by.get(k) ?? { hours: 0, sheets: new Set<string>() };
      r.hours += s.hours / keys.length;
      r.sheets.add(`${s.sheet}|${s.supervisor}`);
      by.set(k, r);
    }
  }
  const byCause = [...by].map(([cause, r]) => ({
    cause, label: info.get(cause)?.label ?? cause, party: info.get(cause)?.party ?? "Not stated", hours: r.hours, sheets: r.sheets.size,
  })).sort((a, b) => Number(a.cause === NO_REASON) - Number(b.cause === NO_REASON) || b.hours - a.hours); // prettier-ignore
  const parties = new Map<string, number>();
  for (const c of byCause) parties.set(c.party, (parties.get(c.party) ?? 0) + c.hours);
  const byParty = [...parties].map(([party, hours]) => ({ party, hours })).sort((a, b) => b.hours - a.hours);

  const dayOf = new Map(data.days.map((d) => [d.sheet, d.day]));
  const disrupted = items
    .filter((i) => !i.supervisor && i.causes.length && dayOf.has(i.sheet))
    .map((i) => ({ day: dayOf.get(i.sheet)!, sheet: i.sheet, causes: i.causes, note: i.note }))
    .sort((a, b) => a.day - b.day);
  const bad = new Set(disrupted.map((d) => d.day));
  const group = (label: string, keep: (day: number) => boolean) => {
    const xs = slices.filter((s) => keep(s.day));
    const k = kpis(xs);
    const personDays = new Set(xs.map((s) => `${s.day}|${s.person}`)).size;
    return { label, days: k.workDays, headcount: k.avgHeadcount, hoursPerPerson: personDays ? k.hours / personDays : 0, idleShare: k.hours ? k.idle / k.hours : 0, otShare: k.otPct };
  };
  const compare = bad.size ? [group("Disrupted days", (d) => bad.has(d)), group("Clean days", (d) => !bad.has(d))] : [];
  return { byCause, byParty, unallocated, explained, disrupted, compare };
}

// ------------------------------------------------------------------ productivity and unit cost

export interface Norm {
  hours: number; // norm labour hours per unit
  source: string; // BOQ, BSR, other
}

export interface ProdWeek {
  week: string; // Monday (ISO)
  label: string;
  hours: number; // labour hours on the code that week
  cost: number;
  qty: number | null; // quantity done (null: not given)
  hpu: number | null; // hours per unit
  rspu: number | null; // rupees per unit
  index: number | null; // earned / actual hours
  disrupted: number[]; // disrupted days with hours on the code
}

export interface ProdRow {
  code: string;
  unit: string;
  qty: number; // in the weeks with a quantity
  hours: number; // hours in those weeks (the ones a rate rests on)
  allHours: number; // every hour on the code this month
  cost: number;
  hpu: number | null;
  rspu: number | null;
  norm: number | null;
  normSource: string; // "BOQ", "BSR", "site median" (from its own weeks), "" none
  index: number | null; // earned hours / actual hours: below 1 is slower than the norm
  weeks: ProdWeek[];
  mile: { clean: number | null; disrupted: number | null; extraHours: number | null }; // measured mile
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/** Hours and rupees per unit of work done, by week, against a norm; and the measured mile
 * (clean weeks against weeks with disrupted days). `codes`: the codes with quantities, units or
 * norms. A week without a quantity counts for nothing (its hours are not in the rates). */
export function productivity(
  data: Data,
  quantities: Record<string, Record<string, number>>,
  units: Record<string, string>,
  norms: Record<string, Norm>,
  disruptedDays: Set<number> = new Set(),
): ProdRow[] {
  const weeks = periods(data).filter((p) => p.key !== "month");
  const codes = [...new Set([...Object.keys(quantities), ...Object.keys(units), ...Object.keys(norms)])];
  return codes.map((code) => {
    const mine = data.slices.filter((s) => s.code === code);
    const wk: ProdWeek[] = weeks.map((p) => {
      const xs = mine.filter((s) => s.day >= p.from && s.day <= p.to);
      const hours = sumBy(xs, (s) => s.hours), cost = sumBy(xs, (s) => s.cost);
      const week = p.key.slice(2);
      const q = quantities[code]?.[week];
      const qty = q && q > 0 ? q : null;
      return {
        week, label: `${p.from}–${p.to}`, hours, cost, qty,
        hpu: qty && hours ? hours / qty : null, rspu: qty && cost ? cost / qty : null, index: null,
        disrupted: [...new Set(xs.map((s) => s.day))].filter((d) => disruptedDays.has(d)),
      }; // prettier-ignore
    });
    // a week counts once it has both a quantity and hours: a quantity with no hours yet means its
    // day sheets are not entered, and would make the rate look better than it is
    const measured = wk.filter((w) => w.qty && w.hours > 0);
    const qty = sumBy(measured, (w) => w.qty!), hours = sumBy(measured, (w) => w.hours), cost = sumBy(measured, (w) => w.cost);
    const own = measured.filter((w) => w.hours > 0).map((w) => w.hpu!);
    const given = norms[code]?.hours;
    const norm = given ?? (own.length >= 2 ? median(own) : null);
    for (const w of wk) w.index = norm && w.qty && w.hours ? (w.qty * norm) / w.hours : null;
    const rate = (ws: ProdWeek[]) => { const q = sumBy(ws, (w) => w.qty!); return q ? sumBy(ws, (w) => w.hours) / q : null; };
    const clean = measured.filter((w) => !w.disrupted.length), bad = measured.filter((w) => w.disrupted.length);
    const c = rate(clean), d = rate(bad);
    return {
      code, unit: units[code] ?? "", qty, hours, allHours: sumBy(mine, (s) => s.hours), cost,
      hpu: qty ? hours / qty : null, rspu: qty && cost ? cost / qty : null,
      norm, normSource: given ? norms[code].source || "norm" : norm ? "site median" : "",
      index: norm && qty && hours ? (qty * norm) / hours : null, weeks: wk,
      mile: { clean: c, disrupted: d, extraHours: c !== null && d !== null && d > c ? (d - c) * sumBy(bad, (w) => w.qty!) : null },
    }; // prettier-ignore
  }).sort((a, b) => b.allHours - a.allHours);
}

// ------------------------------------------------------------------------- fatigue and OT risk

export interface Limits {
  week_hours: number; // worked hours in any 7 days
  week_ot: number; // overtime hours in any 7 days
  days_in_row: number; // days in a row without a day off
  rest_hours: number; // rest between one day's Out and the next day's In
}

export const DEFAULT_LIMITS: Limits = { week_hours: 60, week_ot: 20, days_in_row: 13, rest_hours: 8 };

export interface FatigueRow {
  person: string;
  name: string; // the first calling name
  trade: string;
  days: number;
  maxWeek: number; // most hours worked in any 7 days
  maxWeekOt: number;
  daysOverWeek: number; // days whose 7 days up to them were over the hours limit
  daysOverOt: number;
  longestRun: number;
  shortRests: number; // nights with less rest than the limit
  minRest: number | null;
  sundays: number; // Sundays and holidays worked
  flags: string[]; // "7-day hours", "7-day OT", "days in a row", "short rest"
}

/** Per person, against the limits: the worst 7 days (hours and OT), days in a row, short rests
 * between consecutive days, Sundays and holidays worked. Riskiest first. */
export function fatigue(data: Data, entries: EntryRow[], limits: Limits = DEFAULT_LIMITS): FatigueRow[] {
  const base = new Map(people(data, entries).map((p) => [p.person, p]));
  const lastDay = Math.max(0, ...data.days.map((d) => d.day));
  const by = new Map<string, Map<number, { worked: number; ot: number; tin: number | null; tout: number | null }>>();
  for (const e of entries) {
    const m = by.get(e.person) ?? new Map();
    const d = m.get(e.day) ?? { worked: 0, ot: 0, tin: null, tout: null };
    d.worked += e.worked;
    d.ot += e.ot;
    if (e.tin !== null) d.tin = d.tin === null ? e.tin : Math.min(d.tin, e.tin);
    if (e.tout !== null) d.tout = d.tout === null ? e.tout : Math.max(d.tout, e.tout);
    m.set(e.day, d);
    by.set(e.person, m);
  }
  const rows: FatigueRow[] = [];
  for (const [person, days] of by) {
    const p = base.get(person);
    let maxWeek = 0, maxWeekOt = 0, daysOverWeek = 0, daysOverOt = 0;
    for (let d = 1; d <= lastDay; d++) {
      let wh = 0, wo = 0;
      for (let k = d - 6; k <= d; k++) {
        const x = days.get(k);
        if (x) { wh += x.worked; wo += x.ot; }
      }
      maxWeek = Math.max(maxWeek, wh);
      maxWeekOt = Math.max(maxWeekOt, wo);
      if (days.has(d) && wh > limits.week_hours) daysOverWeek += 1;
      if (days.has(d) && wo > limits.week_ot) daysOverOt += 1;
    }
    let shortRests = 0, minRest: number | null = null;
    for (const [d, x] of days) {
      const next = days.get(d + 1);
      if (!next || x.tout === null || next.tin === null) continue;
      const rest = 24 + next.tin - x.tout;
      minRest = minRest === null ? rest : Math.min(minRest, rest);
      if (rest < limits.rest_hours) shortRests += 1;
    }
    const longestRun = p?.longestRun ?? 0;
    const flags = [
      maxWeek > limits.week_hours && "7-day hours",
      maxWeekOt > limits.week_ot && "7-day OT",
      longestRun > limits.days_in_row && "days in a row",
      shortRests > 0 && "short rest",
    ].filter((f): f is string => Boolean(f));
    rows.push({
      person, name: p?.names[0] ?? person, trade: p?.trade ?? NO_TRADE, days: days.size, maxWeek, maxWeekOt, daysOverWeek, daysOverOt,
      longestRun, shortRests, minRest, sundays: (p?.sundays ?? 0) + (p?.holidays ?? 0), flags,
    }); // prettier-ignore
  }
  return rows.sort((a, b) => b.flags.length - a.flags.length || b.maxWeek - a.maxWeek || a.name.localeCompare(b.name));
}

/** People each day whose 7 days up to it were over the hours limit (the site's fatigue trend). */
export function overLimitByDay(data: Data, entries: EntryRow[], limits: Limits = DEFAULT_LIMITS): Map<number, number> {
  const per = new Map<string, Map<number, number>>();
  for (const e of entries) {
    const m = per.get(e.person) ?? new Map<number, number>();
    m.set(e.day, (m.get(e.day) ?? 0) + e.worked);
    per.set(e.person, m);
  }
  const out = new Map<number, number>();
  for (const d of data.days) {
    let n = 0;
    for (const m of per.values()) {
      if (!m.has(d.day)) continue;
      let wh = 0;
      for (let k = d.day - 6; k <= d.day; k++) wh += m.get(k) ?? 0;
      if (wh > limits.week_hours) n += 1;
    }
    out.set(d.day, n);
  }
  return out;
}

/** Overtime against output: the productivity index of code-weeks with a high OT share (above
 * the median) against those with a low one; null without at least two measured weeks. */
export function otAndOutput(data: Data, rows: ProdRow[]): { highOt: number; lowOt: number; split: number; weeks: number } | null {
  const pairs: { ot: number; index: number }[] = [];
  for (const r of rows)
    for (const w of r.weeks) {
      if (w.index === null) continue;
      const p = periods(data).find((x) => x.key === `w:${w.week}`);
      if (!p) continue;
      const xs = data.slices.filter((s) => s.code === r.code && s.day >= p.from && s.day <= p.to);
      const hours = sumBy(xs, (s) => s.hours);
      if (hours > 0) pairs.push({ ot: sumBy(xs, (s) => s.ot) / hours, index: w.index });
    }
  if (pairs.length < 2) return null;
  const split = median(pairs.map((x) => x.ot))!;
  const hi = pairs.filter((x) => x.ot > split), lo = pairs.filter((x) => x.ot <= split);
  if (!hi.length || !lo.length) return null;
  const avg = (xs: typeof pairs) => sumBy(xs, (x) => x.index) / xs.length;
  return { highOt: avg(hi), lowOt: avg(lo), split, weeks: pairs.length };
}

// --------------------------------------------------------------------------------- BP bill check

export const NO_BP = "No business partner";

export interface BpWorker {
  name: string; // calling name (a BP Bill row is a Labour Detail row)
  trade: string;
  bp: string;
  days: number; // days with an entry
  billable: number; // days at 6+ effective hours (the BP Bill rule)
  short: number; // days under 6 hours: not counted by the BP Bill
  hours: number;
  ot: number;
  sundays: number; // Sundays and holidays worked
  cost: number; // at standard rates (0 without rates)
  flags: string[]; // to check before the bill is certified
}

export interface BpGroup {
  bp: string;
  workers: BpWorker[];
  billable: number;
  days: number;
  hours: number;
  ot: number;
  sundays: number;
  cost: number;
  flagged: number; // workers with a flag
}

/** Per business partner (Labour Detail's column F): worker-days the BP Bill counts (a day at 6+
 * effective hours), hours, OT, Sundays, cost; and what to check before certifying: double
 * bookings (W03), missing employee codes, long runs, entries changed after supervisor review. */
export function bpBill(data: Data, entries: EntryRow[], opts: { daysInRow?: number; changedAfterReview?: Set<string> } = {}): BpGroup[] {
  const limit = opts.daysInRow ?? DEFAULT_LIMITS.days_in_row;
  const runs = new Map(people(data, entries).map((p) => [p.person, p.longestRun]));
  const cost = new Map<string, number>();
  for (const s of data.slices) cost.set(`${s.sheet}|${s.name}`, (cost.get(`${s.sheet}|${s.name}`) ?? 0) + s.cost);
  const by = new Map<string, BpWorker>();
  for (const e of entries) {
    const w = data.workers.get(e.name);
    const bp = text(w?.bp) || NO_BP;
    const r = by.get(e.name) ?? { name: e.name, trade: e.trade, bp, days: 0, billable: 0, short: 0, hours: 0, ot: 0, sundays: 0, cost: 0, flags: [] };
    r.days += 1;
    if (e.worked >= 6) r.billable += 1;
    else r.short += 1;
    r.hours += e.worked;
    r.ot += e.ot;
    if (e.kind === "Sunday" || e.kind === "Holiday") r.sundays += 1;
    r.cost += cost.get(`${e.sheet}|${e.name}`) ?? 0;
    const add = (f: string) => !r.flags.includes(f) && r.flags.push(f);
    if (e.issues.some((i) => i.rule === "W03")) add("double booking");
    if (opts.changedAfterReview?.has(`${e.sheet}|${e.name}`)) add("changed after review");
    by.set(e.name, r);
  }
  for (const r of by.values()) {
    const st = data.workers.get(r.name)?.code_status;
    if (st && st !== "valid") r.flags.push("no employee code");
    const person = text(data.workers.get(r.name)?.person) || r.name;
    if ((runs.get(person) ?? 0) > limit) r.flags.push("long run");
  }
  const groups = new Map<string, BpWorker[]>();
  for (const r of by.values()) groups.set(r.bp, [...(groups.get(r.bp) ?? []), r]);
  return [...groups].map(([bp, ws]) => ({
    bp, workers: ws.sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name)),
    billable: sumBy(ws, (w) => w.billable), days: sumBy(ws, (w) => w.days), hours: sumBy(ws, (w) => w.hours), ot: sumBy(ws, (w) => w.ot),
    sundays: sumBy(ws, (w) => w.sundays), cost: sumBy(ws, (w) => w.cost), flagged: ws.filter((w) => w.flags.length).length,
  })).sort((a, b) => Number(a.bp === NO_BP) - Number(b.bp === NO_BP) || b.billable - a.billable); // prettier-ignore
}
