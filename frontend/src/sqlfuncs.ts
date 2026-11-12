// The SQL panel's function library: the functions of the common relational databases (MySQL /
// MariaDB, PostgreSQL, SQL Server, Oracle, SQLite), under each database's own name where they
// differ (IFNULL / ISNULL / NVL, SUBSTRING / SUBSTR / MID, DATEADD / DATE_ADD, LEN / LENGTH, …).
// Values are text, numbers or NULL; dates are text 'YYYY-MM-DD' (with ' HH:MM:SS' for a date and
// time); the in / out columns are clock hours as numbers (7.5 = 07:30), which the time functions
// understand. Aggregates and window functions are listed here and worked out by sql.ts.

export type Val = string | number | null;
export type FnCategory = "Aggregate" | "Window" | "String" | "Number" | "Date and time" | "Conditional and NULL" | "Conversion" | "Other";
export interface FnInfo {
  name: string; // canonical (upper case)
  aliases: string[];
  cat: FnCategory;
  sig: string;
  help: string;
}
interface ScalarDef extends FnInfo {
  min: number;
  max: number; // Infinity: any number
  call: (a: Val[]) => Val;
}

export class SqlFnError extends Error {}
const fail = (msg: string): never => {
  throw new SqlFnError(msg);
};

// --- helpers --------------------------------------------------------------------------------------

const isNull = (v: Val) => v === null;
const str = (v: Val) => (v === null ? "" : typeof v === "number" ? numText(v) : v);
const numText = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e10) / 1e10));
const num = (v: Val, fn = ""): number => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (s === "") return 0;
  const n = Number(s);
  if (Number.isNaN(n)) {
    // MySQL reads the leading number of a text ('12abc' -> 12); others refuse: say it plainly
    const lead = s.match(/^[-+]?\d+(\.\d+)?/);
    if (lead) return Number(lead[0]);
    fail(`${fn ? `${fn}: ` : ""}"${s}" is not a number.`);
  }
  return n;
};
const int = (v: Val, fn = "") => Math.trunc(num(v, fn));
/** NULL in -> NULL out, for the plain functions. */
const n1 = (f: (x: number) => number | null, name: string) => (a: Val[]) => (isNull(a[0]) ? null : clean(f(num(a[0], name))));
const s1 = (f: (x: string) => Val) => (a: Val[]) => (isNull(a[0]) ? null : f(str(a[0])));
const anyNull = (a: Val[], upTo = a.length) => a.slice(0, upTo).some(isNull);
const clean = (x: number | null): Val => (x === null || !Number.isFinite(x) ? null : Math.abs(x - Math.round(x)) < 1e-9 ? Math.round(x) : x);
const pad2 = (n: number) => String(n).padStart(2, "0");

const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A date (and time) from a value: 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM[:SS]', 'YYYYMMDD', a clock
 * time 'HH:MM[:SS]' (on 1900-01-01, for the time functions), or clock hours as a number (in/out). */
interface DT {
  d: Date; // UTC fields hold the local date and time
  time: boolean; // had a time part
}
function toDT(v: Val, fn = ""): DT | null {
  if (v === null || v === "") return null;
  if (typeof v === "number") {
    // clock hours (in / out columns): 7.5 -> 07:30; past 24 -> the next day
    const ms = Math.round(v * 3600) * 1000;
    return { d: new Date(Date.UTC(1900, 0, 1) + ms), time: true };
  }
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/);
  if (!m) {
    const c = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (c) m = [s, c[1], c[2], c[3]] as unknown as RegExpMatchArray;
  }
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
    if (d.getUTCMonth() !== +m[2] - 1) fail(`${fn ? `${fn}: ` : ""}"${s}" is not a date.`);
    return { d, time: m[4] !== undefined };
  }
  const t = s.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (t) return { d: new Date(Date.UTC(1900, 0, 1, +t[1], +t[2], +(t[3] ?? 0))), time: true };
  return fail(`${fn ? `${fn}: ` : ""}"${s}" is not a date or a time (use 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS').`);
}
const dateText = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const timeText = (d: Date) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
const dtText = (x: DT) => (x.time ? `${dateText(x.d)} ${timeText(x.d)}` : dateText(x.d));
const nowLocal = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds()));
};
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const dayOfYear = (d: Date) => Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1;
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear();
  return { year: y, week: Math.ceil(((+t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7) };
}
/** MySQL WEEK(d, 0): weeks start on Sunday, days before the year's first Sunday are week 0. */
const sundayWeek = (d: Date) => {
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).getUTCDay();
  const firstSunday = jan1 === 0 ? 1 : 8 - jan1, doy = dayOfYear(d);
  return doy < firstSunday ? 0 : Math.floor((doy - firstSunday) / 7) + 1;
};

type Unit = "year" | "quarter" | "month" | "week" | "day" | "hour" | "minute" | "second" | "millisecond" | "dayofyear" | "weekday" | "isoweek" | "isodow" | "dow" | "epoch" | "decade" | "century";
const UNITS: Record<string, Unit> = {
  year: "year", years: "year", yy: "year", yyyy: "year", y: "year", yr: "year",
  quarter: "quarter", quarters: "quarter", qq: "quarter", q: "quarter",
  month: "month", months: "month", mm: "month", m: "month", mon: "month",
  week: "week", weeks: "week", wk: "week", ww: "week", w: "week",
  day: "day", days: "day", dd: "day", d: "day", dayofmonth: "day",
  hour: "hour", hours: "hour", hh: "hour", h: "hour",
  minute: "minute", minutes: "minute", mi: "minute", n: "minute", min: "minute",
  second: "second", seconds: "second", ss: "second", s: "second", sec: "second",
  millisecond: "millisecond", milliseconds: "millisecond", ms: "millisecond",
  dayofyear: "dayofyear", dy: "dayofyear", doy: "dayofyear",
  weekday: "weekday", dw: "weekday", dayofweek: "weekday",
  isoweek: "isoweek", iso_week: "isoweek", isowk: "isoweek", isoww: "isoweek",
  isodow: "isodow", dow: "dow", epoch: "epoch", decade: "decade", century: "century",
};
export const unitOf = (v: Val, fn: string): Unit => UNITS[String(v ?? "").trim().toLowerCase().replace(/^'|'$/g, "")] ?? fail(`${fn}: "${v}" is not a date part (year, quarter, month, week, day, hour, minute, second).`);
export const isUnitWord = (w: string) => w.toLowerCase() in UNITS;

function part(x: DT, u: Unit): number {
  const d = x.d;
  switch (u) {
    case "year": return d.getUTCFullYear();
    case "quarter": return Math.floor(d.getUTCMonth() / 3) + 1;
    case "month": return d.getUTCMonth() + 1;
    case "week": return isoWeek(d).week;
    case "isoweek": return isoWeek(d).week;
    case "day": return d.getUTCDate();
    case "hour": return d.getUTCHours();
    case "minute": return d.getUTCMinutes();
    case "second": return d.getUTCSeconds();
    case "millisecond": return d.getUTCSeconds() * 1000;
    case "dayofyear": return dayOfYear(d);
    case "weekday": return d.getUTCDay() + 1; // SQL Server: 1 = Sunday
    case "dow": return d.getUTCDay(); // PostgreSQL: 0 = Sunday
    case "isodow": return d.getUTCDay() || 7; // 1 = Monday … 7 = Sunday
    case "epoch": return Math.round((+d - Date.UTC(1970, 0, 1)) / 1000);
    case "decade": return Math.floor(d.getUTCFullYear() / 10);
    case "century": return Math.ceil(d.getUTCFullYear() / 100);
  }
}
function addTo(x: DT, u: Unit, n: number): DT {
  const d = new Date(x.d);
  const months = u === "year" ? 12 * n : u === "quarter" ? 3 * n : u === "month" ? n : null;
  if (months !== null) {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + Math.trunc(months));
    d.setUTCDate(Math.min(day, daysIn(d.getUTCFullYear(), d.getUTCMonth()))); // 31 Jan + 1 month = 28/29 Feb
    return { d, time: x.time };
  }
  const ms = { week: 7 * 864e5, day: 864e5, dayofyear: 864e5, weekday: 864e5, dow: 864e5, isodow: 864e5, hour: 36e5, minute: 6e4, second: 1e3, millisecond: 1, isoweek: 7 * 864e5 }[u as string];
  if (ms === undefined) fail(`Cannot add ${u}s to a date.`);
  const out = new Date(+d + Math.round(n * ms!));
  return { d: out, time: x.time || ["hour", "minute", "second", "millisecond"].includes(u) || !Number.isInteger(n) };
}
/** b - a in whole units (SQL Server DATEDIFF counts boundaries; for days and less it is the same as
 * whole units between midnights / hours). */
function diff(u: Unit, a: DT, b: DT, boundaries: boolean): number {
  const months = (b.d.getUTCFullYear() - a.d.getUTCFullYear()) * 12 + (b.d.getUTCMonth() - a.d.getUTCMonth());
  if (u === "year") return boundaries ? b.d.getUTCFullYear() - a.d.getUTCFullYear() : Math.trunc(wholeMonths(a, b) / 12);
  if (u === "quarter") return boundaries ? Math.floor((b.d.getUTCFullYear() * 12 + b.d.getUTCMonth()) / 3) - Math.floor((a.d.getUTCFullYear() * 12 + a.d.getUTCMonth()) / 3) : Math.trunc(wholeMonths(a, b) / 3);
  if (u === "month") return boundaries ? months : wholeMonths(a, b);
  const span = { week: 7 * 864e5, isoweek: 7 * 864e5, day: 864e5, dayofyear: 864e5, weekday: 864e5, dow: 864e5, isodow: 864e5, hour: 36e5, minute: 6e4, second: 1e3, millisecond: 1, epoch: 1e3, decade: 0, century: 0 }[u];
  if (!span) fail(`Cannot count ${u}s between dates.`);
  if (boundaries) {
    const floor = (d: Date) => Math.floor(+d / span!) ;
    if (u === "week" || u === "isoweek") return Math.floor((+b.d / 864e5 + 4) / 7) - Math.floor((+a.d / 864e5 + 4) / 7); // Sunday boundaries
    return floor(b.d) - floor(a.d);
  }
  return Math.trunc((+b.d - +a.d) / span!);
}
function wholeMonths(a: DT, b: DT): number {
  let m = (b.d.getUTCFullYear() - a.d.getUTCFullYear()) * 12 + (b.d.getUTCMonth() - a.d.getUTCMonth());
  const restA = +a.d - Date.UTC(a.d.getUTCFullYear(), a.d.getUTCMonth(), 1), restB = +b.d - Date.UTC(b.d.getUTCFullYear(), b.d.getUTCMonth(), 1);
  if (m > 0 && restB < restA) m -= 1;
  if (m < 0 && restB > restA) m += 1;
  return m;
}
function trunc(x: DT, u: Unit): DT {
  const d = x.d, y = d.getUTCFullYear(), mo = d.getUTCMonth();
  const at = (...p: number[]) => new Date(Date.UTC(p[0], p[1] ?? 0, p[2] ?? 1, p[3] ?? 0, p[4] ?? 0, p[5] ?? 0));
  switch (u) {
    case "year": return { d: at(y), time: x.time };
    case "quarter": return { d: at(y, mo - (mo % 3)), time: x.time };
    case "month": return { d: at(y, mo), time: x.time };
    case "week": case "isoweek": { const day = at(y, mo, d.getUTCDate()); day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); return { d: day, time: x.time }; }
    case "day": return { d: at(y, mo, d.getUTCDate()), time: x.time };
    case "hour": return { d: at(y, mo, d.getUTCDate(), d.getUTCHours()), time: true };
    case "minute": return { d: at(y, mo, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()), time: true };
    case "second": return { d: at(y, mo, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()), time: true };
    case "decade": return { d: at(y - (y % 10)), time: x.time };
    case "century": return { d: at(y - ((y - 1) % 100)), time: x.time };
    default: return fail(`Cannot truncate a date to ${u}.`);
  }
}

/** An interval written INTERVAL '3' DAY (kept as text 'INTERVAL 3 day'). */
export const intervalText = (n: Val, unit: string) => `INTERVAL ${num(n)} ${unit.toLowerCase()}`;
export function parseInterval(v: Val): { n: number; u: Unit } | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^INTERVAL\s+(-?[\d.]+)\s+(\w+)$/i);
  if (!m) return null;
  return { n: Number(m[1]), u: unitOf(m[2].replace(/s$/i, ""), "INTERVAL") };
}
/** date + INTERVAL, date - INTERVAL (and date + n days, as Oracle does). */
export function dateArith(a: Val, b: Val, op: "+" | "-"): Val | undefined {
  const ia = parseInterval(a), ib = parseInterval(b);
  if (ib && !ia) { const x = toDT(a, "date arithmetic"); return x ? dtText(addTo(x, ib.u, op === "+" ? ib.n : -ib.n)) : null; }
  if (ia && !ib && op === "+") { const x = toDT(b, "date arithmetic"); return x ? dtText(addTo(x, ia.u, ia.n)) : null; }
  return undefined;
}

// --- formats --------------------------------------------------------------------------------------

/** MySQL DATE_FORMAT / SQLite strftime specifiers. */
function formatPercent(x: DT, f: string): string {
  const d = x.d, h = d.getUTCHours();
  const map: Record<string, () => string> = {
    Y: () => String(d.getUTCFullYear()), y: () => pad2(d.getUTCFullYear() % 100), m: () => pad2(d.getUTCMonth() + 1), c: () => String(d.getUTCMonth() + 1),
    d: () => pad2(d.getUTCDate()), e: () => String(d.getUTCDate()), H: () => pad2(h), k: () => String(h), h: () => pad2(h % 12 || 12), I: () => pad2(h % 12 || 12), l: () => String(h % 12 || 12),
    i: () => pad2(d.getUTCMinutes()), M: () => MONTHS[d.getUTCMonth()],
    s: () => pad2(d.getUTCSeconds()), S: () => pad2(d.getUTCSeconds()), p: () => (h < 12 ? "AM" : "PM"), b: () => MONTHS[d.getUTCMonth()].slice(0, 3),
    W: () => DAYS[d.getUTCDay()], a: () => DAYS[d.getUTCDay()].slice(0, 3), w: () => String(d.getUTCDay()), j: () => String(dayOfYear(d)).padStart(3, "0"),
    T: () => timeText(d), r: () => `${pad2(h % 12 || 12)}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} ${h < 12 ? "AM" : "PM"}`, D: () => `${d.getUTCDate()}${ordinal(d.getUTCDate())}`,
    U: () => pad2(sundayWeek(d)), u: () => pad2(isoWeek(d).week), V: () => pad2(isoWeek(d).week), v: () => pad2(isoWeek(d).week), F: () => dateText(d), f: () => "000000", "%": () => "%",
  };
  return f.replace(/%(.)/g, (all, c: string) => (map[c] ? map[c]() : all));
}
/** SQLite strftime: %M is minutes there (MySQL's %i). */
const formatStrftime = (x: DT, f: string) => formatPercent(x, f.replace(/%M/g, "%i").replace(/%S/g, "%s"));
/** Oracle / PostgreSQL TO_CHAR date patterns. */
function formatOracle(x: DT, f: string): string {
  const d = x.d, h = d.getUTCHours();
  const tokens: [RegExp, () => string][] = [
    [/^YYYY/i, () => String(d.getUTCFullYear())], [/^YY/i, () => pad2(d.getUTCFullYear() % 100)], [/^MONTH/, () => MONTHS[d.getUTCMonth()].toUpperCase().padEnd(9)], [/^Month/, () => MONTHS[d.getUTCMonth()].padEnd(9)],
    [/^month/, () => MONTHS[d.getUTCMonth()].toLowerCase().padEnd(9)], [/^MON/, () => MONTHS[d.getUTCMonth()].slice(0, 3).toUpperCase()], [/^Mon/, () => MONTHS[d.getUTCMonth()].slice(0, 3)], [/^mon/, () => MONTHS[d.getUTCMonth()].slice(0, 3).toLowerCase()],
    [/^MM/i, () => pad2(d.getUTCMonth() + 1)], [/^DAY/, () => DAYS[d.getUTCDay()].toUpperCase().padEnd(9)], [/^Day/, () => DAYS[d.getUTCDay()].padEnd(9)], [/^day/, () => DAYS[d.getUTCDay()].toLowerCase().padEnd(9)],
    [/^DDD/i, () => String(dayOfYear(d)).padStart(3, "0")], [/^DD/i, () => pad2(d.getUTCDate())], [/^DY/, () => DAYS[d.getUTCDay()].slice(0, 3).toUpperCase()], [/^Dy/, () => DAYS[d.getUTCDay()].slice(0, 3)],
    [/^D/i, () => String(d.getUTCDay() + 1)], [/^HH24/i, () => pad2(h)], [/^HH12/i, () => pad2(h % 12 || 12)], [/^HH/i, () => pad2(h % 12 || 12)], [/^MI/i, () => pad2(d.getUTCMinutes())],
    [/^SS/i, () => pad2(d.getUTCSeconds())], [/^AM|^PM/, () => (h < 12 ? "AM" : "PM")], [/^am|^pm/, () => (h < 12 ? "am" : "pm")], [/^Q/i, () => String(Math.floor(d.getUTCMonth() / 3) + 1)],
    [/^IW/i, () => pad2(isoWeek(d).week)], [/^WW/i, () => pad2(Math.floor((dayOfYear(d) - 1) / 7) + 1)], [/^FM/i, () => ""],
  ];
  let out = "", rest = f;
  const fm = /FM/i.test(f);
  while (rest) {
    if (rest[0] === '"') { const end = rest.indexOf('"', 1); out += rest.slice(1, end < 0 ? undefined : end); rest = end < 0 ? "" : rest.slice(end + 1); continue; }
    const hit = tokens.find(([re]) => re.test(rest));
    if (hit) { const m = rest.match(hit[0])![0]; out += hit[1](); rest = rest.slice(m.length); } else { out += rest[0]; rest = rest.slice(1); }
  }
  return fm ? out.replace(/\s+(?=\S)/g, (s) => s).replace(/ +$/g, "").replace(/([A-Za-z]) {2,}/g, "$1 ") : out;
}
/** SQL Server FORMAT date patterns (.NET): yyyy, yy, MMMM, MMM, MM, M, dddd, ddd, dd, d, HH, hh, mm, ss, tt. */
function formatDotNet(x: DT, f: string): string {
  const d = x.d, h = d.getUTCHours();
  const tokens: [string, () => string][] = [
    ["yyyy", () => String(d.getUTCFullYear())], ["yy", () => pad2(d.getUTCFullYear() % 100)], ["MMMM", () => MONTHS[d.getUTCMonth()]], ["MMM", () => MONTHS[d.getUTCMonth()].slice(0, 3)],
    ["MM", () => pad2(d.getUTCMonth() + 1)], ["M", () => String(d.getUTCMonth() + 1)], ["dddd", () => DAYS[d.getUTCDay()]], ["ddd", () => DAYS[d.getUTCDay()].slice(0, 3)],
    ["dd", () => pad2(d.getUTCDate())], ["d", () => String(d.getUTCDate())], ["HH", () => pad2(h)], ["H", () => String(h)], ["hh", () => pad2(h % 12 || 12)], ["h", () => String(h % 12 || 12)],
    ["mm", () => pad2(d.getUTCMinutes())], ["m", () => String(d.getUTCMinutes())], ["ss", () => pad2(d.getUTCSeconds())], ["s", () => String(d.getUTCSeconds())], ["tt", () => (h < 12 ? "AM" : "PM")],
  ];
  let out = "", i = 0;
  while (i < f.length) {
    if (f[i] === "'" || f[i] === '"') { const q = f[i]; const end = f.indexOf(q, i + 1); out += f.slice(i + 1, end < 0 ? undefined : end); i = end < 0 ? f.length : end + 1; continue; }
    if (f[i] === "\\") { out += f[i + 1] ?? ""; i += 2; continue; }
    const hit = tokens.find(([t]) => f.startsWith(t, i));
    if (hit) { out += hit[1](); i += hit[0].length; } else { out += f[i]; i += 1; }
  }
  return out;
}
/** A number with grouping and decimals: 1234.5 -> '1,234.50'. */
const grouped = (n: number, dec: number, group = true) => n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: group });
/** TO_CHAR(number, '999,999.99') / FORMAT(number, 'N2' | '#,##0.00' | 'P1' | 'C'). */
function formatNumber(n: number, f: string): string {
  const std = f.match(/^([NnFfPpCcDdEe])(\d*)$/);
  if (std) {
    const k = std[1].toUpperCase(), dec = std[2] === "" ? (k === "D" ? 0 : 2) : Number(std[2]);
    if (k === "N") return grouped(n, dec);
    if (k === "F") return grouped(n, dec, false);
    if (k === "P") return `${grouped(n * 100, dec)}%`;
    if (k === "C") return `Rs ${grouped(n, dec)}`;
    if (k === "D") return String(Math.trunc(n)).padStart(dec, "0");
    return n.toExponential(dec).toUpperCase();
  }
  const body = f.replace(/^FM/i, "");
  const dot = body.search(/[.D]/);
  const dec = dot < 0 ? 0 : body.slice(dot + 1).replace(/[^09#]/g, "").length;
  const group = /[,G]/.test(body);
  const pct = body.endsWith("%");
  const text = grouped(pct ? n * 100 : n, dec, group);
  const lead = body.match(/^[^09#,.DG]+/)?.[0] ?? "";
  const minInt = (body.slice(0, dot < 0 ? undefined : dot).match(/0/g) ?? []).length;
  const [ip, fp] = text.split(".");
  const intPart = ip.replace(/^(-?)(\d+)/, (_m, s: string, d: string) => s + d.padStart(minInt, "0"));
  return `${lead.replace(/\$|L/g, (c) => (c === "L" ? "Rs " : c))}${intPart}${fp !== undefined ? `.${fp}` : ""}${pct ? "%" : ""}`;
}
/** Read a date from text with a pattern: STR_TO_DATE(s, '%d/%m/%Y'), TO_DATE(s, 'DD/MM/YYYY'). */
function parseWithPattern(s: string, f: string, percent: boolean): DT | null {
  const fields: string[] = [];
  const tok = percent
    ? [["%Y", "(\\d{4})", "Y"], ["%y", "(\\d{2})", "y"], ["%m", "(\\d{1,2})", "m"], ["%c", "(\\d{1,2})", "m"], ["%d", "(\\d{1,2})", "d"], ["%e", "(\\d{1,2})", "d"], ["%H", "(\\d{1,2})", "H"], ["%k", "(\\d{1,2})", "H"], ["%h", "(\\d{1,2})", "h"], ["%i", "(\\d{2})", "i"], ["%s", "(\\d{2})", "s"], ["%S", "(\\d{2})", "s"], ["%p", "(AM|PM|am|pm)", "p"], ["%b", "([A-Za-z]{3})", "b"], ["%M", "([A-Za-z]+)", "B"]]
    : [["YYYY", "(\\d{4})", "Y"], ["RRRR", "(\\d{4})", "Y"], ["YY", "(\\d{2})", "y"], ["MONTH", "([A-Za-z]+)", "B"], ["MON", "([A-Za-z]{3})", "b"], ["MM", "(\\d{1,2})", "m"], ["DD", "(\\d{1,2})", "d"], ["HH24", "(\\d{1,2})", "H"], ["HH12", "(\\d{1,2})", "h"], ["HH", "(\\d{1,2})", "h"], ["MI", "(\\d{2})", "i"], ["SS", "(\\d{2})", "s"], ["AM", "(AM|PM|am|pm)", "p"], ["PM", "(AM|PM|am|pm)", "p"]];
  let re = "^\\s*";
  let rest = percent ? f : f.toUpperCase();
  while (rest) {
    const hit = tok.find(([t]) => rest.startsWith(t));
    if (hit) { re += hit[1]; fields.push(hit[2]); rest = rest.slice(hit[0].length); } else { re += rest[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); rest = rest.slice(1); }
  }
  const m = s.match(new RegExp(`${re}\\s*$`, "i"));
  if (!m) return null;
  let y = 1900, mo = 0, d = 1, h = 0, mi = 0, sec = 0, pm: boolean | null = null, time = false;
  fields.forEach((k, n) => {
    const v = m[n + 1];
    if (k === "Y") y = +v; else if (k === "y") y = 2000 + +v - (+v >= 70 ? 100 : 0); else if (k === "m") mo = +v - 1;
    else if (k === "b" || k === "B") mo = MONTHS.findIndex((x) => x.toLowerCase().startsWith(v.toLowerCase().slice(0, 3)));
    else if (k === "d") d = +v; else if (k === "H" || k === "h") { h = +v; time = true; } else if (k === "i") { mi = +v; time = true; } else if (k === "s") { sec = +v; time = true; } else if (k === "p") pm = v.toUpperCase() === "PM";
  });
  if (pm !== null) h = (h % 12) + (pm ? 12 : 0);
  const out = new Date(Date.UTC(y, mo, d, h, mi, sec));
  if (out.getUTCMonth() !== mo) return null;
  return { d: out, time };
}

// --- casts ----------------------------------------------------------------------------------------

/** CAST(v AS type): the SQL types of the common databases. */
export function castTo(v: Val, type: string): Val {
  if (v === null) return null;
  const t = type.trim().toLowerCase().replace(/\s+/g, " ");
  const base = t.replace(/\(.*$/, "").replace(/ (unsigned|signed|varying|precision|without time zone|with time zone)$/, "").trim();
  const params = (t.match(/\(([^)]*)\)/)?.[1] ?? "").split(",").map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));
  if (["int", "integer", "bigint", "smallint", "tinyint", "mediumint", "signed", "unsigned", "int2", "int4", "int8", "long"].includes(base)) {
    if (typeof v === "string" && Number.isNaN(Number(v.trim()))) return fail(`CAST: "${v}" is not a number.`);
    return Math.trunc(num(v));
  }
  if (["decimal", "numeric", "number", "dec", "money", "smallmoney"].includes(base)) {
    const scale = params[1] ?? (base.includes("money") ? 4 : params.length ? 0 : null);
    const n = num(v, "CAST");
    return scale === null ? n : Math.round(n * 10 ** scale) / 10 ** scale;
  }
  if (["float", "real", "double", "float4", "float8", "binary_float", "binary_double"].includes(base)) return num(v, "CAST");
  if (["char", "varchar", "nchar", "nvarchar", "text", "ntext", "string", "varchar2", "nvarchar2", "clob", "character", "tinytext", "mediumtext", "longtext", "citext"].includes(base)) {
    const s = str(v);
    return params[0] ? s.slice(0, params[0]) : s;
  }
  if (base === "date") { const x = toDT(v, "CAST"); return x ? dateText(x.d) : null; }
  if (["datetime", "datetime2", "timestamp", "smalldatetime", "timestamptz", "datetimeoffset"].includes(base)) { const x = toDT(v, "CAST"); return x ? `${dateText(x.d)} ${timeText(x.d)}` : null; }
  if (base === "time") { const x = toDT(v, "CAST"); return x ? timeText(x.d) : null; }
  if (["bool", "boolean", "bit"].includes(base)) {
    const s = String(v).trim().toLowerCase();
    return ["true", "t", "yes", "y", "on"].includes(s) ? 1 : ["false", "f", "no", "n", "off", ""].includes(s) ? 0 : num(v) !== 0 ? 1 : 0;
  }
  if (["binary", "varbinary", "blob", "bytea", "json", "jsonb", "uuid", "uniqueidentifier", "xml", "sql_variant"].includes(base)) return str(v);
  return fail(`CAST: unknown type ${type.toUpperCase()}. Types: INT, DECIMAL(p,s), FLOAT, VARCHAR(n), DATE, DATETIME, TIME, BOOLEAN.`);
}
const tryCall = (f: () => Val): Val => {
  try {
    return f();
  } catch (e) {
    if (e instanceof SqlFnError) return null;
    throw e;
  }
};

// --- text helpers -----------------------------------------------------------------------------------

function soundex(s: string): string {
  const a = s.toUpperCase().replace(/[^A-Z]/g, "");
  if (!a) return "";
  const code: Record<string, string> = { B: "1", F: "1", P: "1", V: "1", C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2", D: "3", T: "3", L: "4", M: "5", N: "5", R: "6" };
  let out = a[0], last = code[a[0]] ?? "";
  for (const c of a.slice(1)) {
    const k = code[c] ?? "";
    if (k && k !== last) out += k;
    if (c !== "H" && c !== "W") last = k;
  }
  return (out + "000").slice(0, 4);
}
function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** A regular expression from SQL: flags 'i' (ignore case), 'c' (match case), 'm', 'n'. */
const regex = (p: Val, flags: Val = null, global = false) => {
  const f = String(flags ?? "");
  try {
    return new RegExp(str(p), `${f.includes("c") ? "" : f.includes("i") ? "i" : ""}${f.includes("m") ? "m" : ""}${f.includes("n") ? "s" : ""}${global ? "g" : ""}`);
  } catch {
    return fail(`"${p}" is not a valid regular expression.`);
  }
};
const pos1 = (hay: string, needle: string, from = 1) => (needle === "" ? 1 : hay.indexOf(needle, Math.max(0, from - 1)) + 1);
/** SUBSTRING with SQL's 1-based start (a negative start counts from the end, as in MySQL). */
function substr(s: string, start: number, len?: number): string {
  let from = start > 0 ? start - 1 : start < 0 ? Math.max(s.length + start, 0) : 0;
  let count = len === undefined ? s.length : len;
  if (start === 0 && len !== undefined) count = len - 1; // PostgreSQL / SQL Server: start 0 eats one
  if (count < 0) return fail("SUBSTRING: the length cannot be negative.");
  from = Math.min(from, s.length);
  return s.slice(from, from + Math.max(count, 0));
}
const padTo = (s: string, len: number, fill: string, left: boolean) => {
  if (len <= s.length) return s.slice(0, Math.max(len, 0));
  if (!fill) return s;
  const pad = fill.repeat(Math.ceil((len - s.length) / fill.length)).slice(0, len - s.length);
  return left ? pad + s : s + pad;
};
const trimChars = (s: string, chars: string | null, where: "both" | "leading" | "trailing") => {
  if (chars === null) return where === "both" ? s.trim() : where === "leading" ? s.replace(/^\s+/, "") : s.replace(/\s+$/, "");
  const set = new Set(chars);
  let a = 0, b = s.length;
  if (where !== "trailing") while (a < b && set.has(s[a])) a++;
  if (where !== "leading") while (b > a && set.has(s[b - 1])) b--;
  return s.slice(a, b);
};
const initcap = (s: string) => s.toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());

// --- the scalar functions ------------------------------------------------------------------------

const defs: ScalarDef[] = [];
const fn = (names: string, cat: FnCategory, sig: string, help: string, min: number, max: number, call: (a: Val[]) => Val) => {
  const [name, ...aliases] = names.split(/\s+/).map((x) => x.toUpperCase());
  defs.push({ name, aliases, cat, sig, help, min, max, call });
};
const S = "String", N = "Number", D = "Date and time", C = "Conditional and NULL", V = "Conversion", O = "Other";

// strings
fn("CONCAT", S, "CONCAT(a, b, …)", "Joins texts; NULLs count as empty (MySQL: CONCAT with a NULL is NULL — use CONCAT_WS to skip them).", 1, Infinity, (a) => a.map(str).join(""));
fn("CONCAT_WS", S, "CONCAT_WS(separator, a, b, …)", "Joins with a separator, skipping NULLs.", 2, Infinity, (a) => (isNull(a[0]) ? null : a.slice(1).filter((x) => !isNull(x)).map(str).join(str(a[0]))));
fn("LENGTH LEN CHAR_LENGTH CHARACTER_LENGTH", S, "LENGTH(text)", "Number of characters (LEN: SQL Server, ignores trailing spaces).", 1, 1, s1((s) => s.length));
fn("DATALENGTH OCTET_LENGTH", S, "OCTET_LENGTH(text)", "Number of bytes (UTF-8).", 1, 1, s1((s) => new TextEncoder().encode(s).length));
fn("BIT_LENGTH", S, "BIT_LENGTH(text)", "Number of bits.", 1, 1, s1((s) => 8 * new TextEncoder().encode(s).length));
fn("UPPER UCASE", S, "UPPER(text)", "In capitals.", 1, 1, s1((s) => s.toUpperCase()));
fn("LOWER LCASE", S, "LOWER(text)", "In small letters.", 1, 1, s1((s) => s.toLowerCase()));
fn("INITCAP PROPER", S, "INITCAP(text)", "First Letter Of Each Word In Capitals.", 1, 1, s1(initcap));
fn("LEFT", S, "LEFT(text, n)", "The first n characters.", 2, 2, (a) => (anyNull(a) ? null : num(a[1]) < 0 ? str(a[0]).slice(0, num(a[1])) : str(a[0]).slice(0, int(a[1]))));
fn("RIGHT", S, "RIGHT(text, n)", "The last n characters.", 2, 2, (a) => (anyNull(a) ? null : int(a[1]) <= 0 ? (int(a[1]) < 0 ? str(a[0]).slice(-int(a[1])) : "") : str(a[0]).slice(-int(a[1]))));
fn("SUBSTRING SUBSTR MID", S, "SUBSTRING(text, start [, length]) · SUBSTRING(text FROM start FOR length)", "Part of a text, from position start (1 = first).", 2, 3, (a) => (anyNull(a) ? null : substr(str(a[0]), int(a[1]), a[2] === undefined ? undefined : int(a[2]))));
fn("POSITION STRPOS", S, "POSITION(needle IN text) · STRPOS(text, needle)", "Where needle first appears (1 = first), 0 when not there.", 2, 2, (a) => (anyNull(a) ? null : pos1(str(a[1]), str(a[0]))));
fn("LOCATE", S, "LOCATE(needle, text [, from])", "MySQL: where needle appears (1 = first), 0 when not there.", 2, 3, (a) => (anyNull(a) ? null : pos1(str(a[1]), str(a[0]), a[2] === undefined ? 1 : int(a[2]))));
fn("CHARINDEX", S, "CHARINDEX(needle, text [, from])", "SQL Server: where needle appears (1 = first), 0 when not there.", 2, 3, (a) => (anyNull(a) ? null : pos1(str(a[1]), str(a[0]), a[2] === undefined ? 1 : int(a[2]))));
fn("INSTR", S, "INSTR(text, needle [, from [, nth]])", "MySQL / Oracle / SQLite: where needle appears in text (1 = first), 0 when not there.", 2, 4, (a) => {
  if (anyNull(a)) return null;
  const s = str(a[0]), n = str(a[1]), nth = a[3] === undefined ? 1 : int(a[3]);
  let at = a[2] === undefined ? 1 : int(a[2]), found = 0;
  for (let k = 0; k < nth; k++) { found = pos1(s, n, at); if (!found) return 0; at = found + 1; }
  return found;
});
fn("REPLACE", S, "REPLACE(text, find, with)", "Every find replaced (with '' removes it).", 2, 3, (a) => (anyNull(a, 2) ? null : str(a[1]) === "" ? str(a[0]) : str(a[0]).split(str(a[1])).join(str(a[2] ?? ""))));
fn("TRANSLATE", S, "TRANSLATE(text, from, to)", "Each character of from becomes the one at the same place in to (dropped when to is shorter).", 3, 3, (a) => {
  if (anyNull(a)) return null;
  const f = str(a[1]), t = str(a[2]);
  return [...str(a[0])].map((c) => { const k = f.indexOf(c); return k < 0 ? c : t[k] ?? ""; }).join("");
});
fn("REVERSE", S, "REVERSE(text)", "Back to front.", 1, 1, s1((s) => [...s].reverse().join("")));
fn("REPEAT REPLICATE", S, "REPEAT(text, n)", "The text n times.", 2, 2, (a) => (anyNull(a) ? null : str(a[0]).repeat(Math.max(int(a[1]), 0))));
fn("SPACE", S, "SPACE(n)", "n spaces.", 1, 1, (a) => (isNull(a[0]) ? null : " ".repeat(Math.max(int(a[0]), 0))));
fn("LPAD", S, "LPAD(text, length [, fill])", "Padded on the left to length (fill defaults to a space).", 2, 3, (a) => (anyNull(a) ? null : padTo(str(a[0]), int(a[1]), a[2] === undefined ? " " : str(a[2]), true)));
fn("RPAD", S, "RPAD(text, length [, fill])", "Padded on the right to length.", 2, 3, (a) => (anyNull(a) ? null : padTo(str(a[0]), int(a[1]), a[2] === undefined ? " " : str(a[2]), false)));
fn("TRIM BTRIM", S, "TRIM(text) · TRIM([LEADING|TRAILING|BOTH] chars FROM text) · BTRIM(text, chars)", "Spaces (or the given characters) taken off both ends.", 1, 3, (a) => (isNull(a[0]) ? null : trimChars(str(a[0]), a[1] === undefined || isNull(a[1]) ? null : str(a[1]), (String(a[2] ?? "both").toLowerCase() as "both"))));
fn("LTRIM", S, "LTRIM(text [, chars])", "Spaces (or chars) taken off the start.", 1, 2, (a) => (isNull(a[0]) ? null : trimChars(str(a[0]), a[1] === undefined ? null : str(a[1]), "leading")));
fn("RTRIM", S, "RTRIM(text [, chars])", "Spaces (or chars) taken off the end.", 1, 2, (a) => (isNull(a[0]) ? null : trimChars(str(a[0]), a[1] === undefined ? null : str(a[1]), "trailing")));
fn("SPLIT_PART", S, "SPLIT_PART(text, delimiter, n)", "PostgreSQL: the n-th piece of text split on delimiter (negative n counts from the end).", 3, 3, (a) => {
  if (anyNull(a)) return null;
  const parts = str(a[0]).split(str(a[1])), n = int(a[2]);
  return (n > 0 ? parts[n - 1] : parts[parts.length + n]) ?? "";
});
fn("SUBSTRING_INDEX", S, "SUBSTRING_INDEX(text, delimiter, n)", "MySQL: text before the n-th delimiter (negative n: after the n-th from the end).", 3, 3, (a) => {
  if (anyNull(a)) return null;
  const parts = str(a[0]).split(str(a[1])), n = int(a[2]);
  return n >= 0 ? parts.slice(0, n).join(str(a[1])) : parts.slice(n).join(str(a[1]));
});
fn("STUFF", S, "STUFF(text, start, length, insert)", "SQL Server: length characters at start replaced with insert.", 4, 4, (a) => (anyNull(a, 3) ? null : (() => { const s = str(a[0]), st = int(a[1]) - 1; return st < 0 || st > s.length ? null : s.slice(0, st) + str(a[3]) + s.slice(st + int(a[2])); })()));
fn("OVERLAY", S, "OVERLAY(text PLACING insert FROM start [FOR length])", "Like STUFF: part of a text replaced.", 3, 4, (a) => (anyNull(a, 3) ? null : (() => { const s = str(a[0]), ins = str(a[1]), st = int(a[2]) - 1, len = a[3] === undefined ? ins.length : int(a[3]); return s.slice(0, st) + ins + s.slice(st + len); })()));
fn("ASCII", S, "ASCII(text)", "The code of the first character.", 1, 1, s1((s) => (s ? s.charCodeAt(0) : 0)));
fn("UNICODE", S, "UNICODE(text)", "The Unicode code point of the first character.", 1, 1, s1((s) => (s ? s.codePointAt(0)! : null)));
fn("CHAR CHR NCHAR", S, "CHAR(code, …)", "The characters with these codes.", 1, Infinity, (a) => (anyNull(a) ? null : a.map((x) => String.fromCodePoint(int(x))).join("")));
fn("SOUNDEX", S, "SOUNDEX(text)", "Sound code of a name (similar-sounding names share it).", 1, 1, s1(soundex));
fn("DIFFERENCE", S, "DIFFERENCE(a, b)", "SQL Server: 0–4, how alike two SOUNDEX codes are (4 = the same).", 2, 2, (a) => (anyNull(a) ? null : [...soundex(str(a[0]))].filter((c, i) => c === soundex(str(a[1]))[i]).length));
fn("LEVENSHTEIN EDIT_DISTANCE", S, "LEVENSHTEIN(a, b)", "How many single-character edits turn a into b.", 2, 2, (a) => (anyNull(a) ? null : levenshtein(str(a[0]), str(a[1]))));
fn("QUOTE QUOTENAME", S, "QUOTE(text)", "The text in single quotes, ready for SQL.", 1, 2, s1((s) => `'${s.replace(/'/g, "''")}'`));
fn("FIELD", S, "FIELD(value, a, b, …)", "MySQL: which of a, b, … equals value (1, 2, …), 0 if none.", 2, Infinity, (a) => (isNull(a[0]) ? 0 : a.slice(1).findIndex((x) => !isNull(x) && str(x).toUpperCase() === str(a[0]).toUpperCase()) + 1));
fn("ELT CHOOSE", S, "ELT(n, a, b, …) · CHOOSE(n, a, b, …)", "The n-th value of the list (NULL when there is none).", 2, Infinity, (a) => (isNull(a[0]) ? null : a[int(a[0])] ?? null));
fn("FIND_IN_SET", S, "FIND_IN_SET(value, 'a,b,c')", "MySQL: the place of value in a comma list, 0 if not there.", 2, 2, (a) => (anyNull(a) ? null : str(a[1]).split(",").indexOf(str(a[0])) + 1));
fn("STARTS_WITH STARTSWITH", S, "STARTS_WITH(text, prefix)", "1 when text starts with prefix.", 2, 2, (a) => (anyNull(a) ? null : str(a[0]).startsWith(str(a[1])) ? 1 : 0));
fn("ENDS_WITH ENDSWITH", S, "ENDS_WITH(text, suffix)", "1 when text ends with suffix.", 2, 2, (a) => (anyNull(a) ? null : str(a[0]).endsWith(str(a[1])) ? 1 : 0));
fn("CONTAINS", S, "CONTAINS(text, part)", "1 when text contains part (case ignored).", 2, 2, (a) => (anyNull(a) ? null : str(a[0]).toUpperCase().includes(str(a[1]).toUpperCase()) ? 1 : 0));
fn("REGEXP_LIKE", S, "REGEXP_LIKE(text, pattern [, flags])", "1 when the regular expression matches (flags: 'i' ignore case, 'c' match case). Also: text REGEXP pattern.", 2, 3, (a) => (anyNull(a, 2) ? null : regex(a[1], a[2] ?? "i").test(str(a[0])) ? 1 : 0));
fn("REGEXP_REPLACE", S, "REGEXP_REPLACE(text, pattern, with [, flags])", "Every match replaced ($1 for a group); flag 'i' ignores case.", 2, 6, (a) => {
  if (anyNull(a, 2)) return null;
  const flags = [a[3], a[4], a[5]].find((x) => typeof x === "string") as string | undefined;
  return str(a[0]).replace(regex(a[1], flags ?? "", !String(flags ?? "g").includes("1")), str(a[2] ?? "").replace(/\\(\d)/g, "$$$1"));
});
fn("REGEXP_SUBSTR REGEXP_EXTRACT SUBSTRING_REGEX", S, "REGEXP_SUBSTR(text, pattern [, from [, nth [, flags]]])", "The (nth) part that matches.", 2, 5, (a) => {
  if (anyNull(a, 2)) return null;
  const s = str(a[0]).slice(a[2] === undefined ? 0 : int(a[2]) - 1);
  const all = [...s.matchAll(regex(a[1], a[4] ?? "", true))];
  return all[(a[3] === undefined ? 1 : int(a[3])) - 1]?.[0] ?? null;
});
fn("REGEXP_INSTR", S, "REGEXP_INSTR(text, pattern)", "Where the pattern first matches (1 = first), 0 if not.", 2, 2, (a) => (anyNull(a) ? null : str(a[0]).search(regex(a[1])) + 1));
fn("REGEXP_COUNT", S, "REGEXP_COUNT(text, pattern [, from [, flags]])", "How many times the pattern matches.", 2, 4, (a) => (anyNull(a, 2) ? null : [...str(a[0]).slice(a[2] === undefined ? 0 : int(a[2]) - 1).matchAll(regex(a[1], a[3] ?? "", true))].length));
fn("HEX", S, "HEX(value)", "A number in hexadecimal, or a text's bytes in hexadecimal.", 1, 1, (a) => (isNull(a[0]) ? null : typeof a[0] === "number" ? Math.trunc(a[0]).toString(16).toUpperCase() : [...new TextEncoder().encode(str(a[0]))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()));
fn("UNHEX", S, "UNHEX(hex)", "The text from hexadecimal bytes.", 1, 1, s1((s) => new TextDecoder().decode(new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16))))));
fn("TO_BASE64 BASE64_ENCODE", S, "TO_BASE64(text)", "Base64 of a text.", 1, 1, s1((s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))));
fn("FROM_BASE64 BASE64_DECODE", S, "FROM_BASE64(text)", "Text from Base64.", 1, 1, s1((s) => { try { return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))); } catch { return null; } }));

// numbers
fn("ABS", N, "ABS(x)", "Without its sign.", 1, 1, n1(Math.abs, "ABS"));
fn("CEIL CEILING", N, "CEIL(x)", "Rounded up to a whole number.", 1, 1, n1(Math.ceil, "CEIL"));
fn("FLOOR", N, "FLOOR(x)", "Rounded down to a whole number.", 1, 1, n1(Math.floor, "FLOOR"));
fn("ROUND", N, "ROUND(x [, places])", "Rounded (half away from zero) to places decimals; negative places round to tens, hundreds….", 1, 3, (a) => {
  if (anyNull(a, 2)) return null;
  const x = num(a[0], "ROUND");
  const p = a[1] === undefined ? 0 : int(a[1]), f = 10 ** p;
  if (a[2] !== undefined && num(a[2]) !== 0) return clean(Math.trunc(x * f) / f); // SQL Server ROUND(x, p, 1): truncate
  return clean((Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f);
});
fn("TRUNCATE TRUNC", N, "TRUNC(x [, places]) · TRUNC(date [, 'month'])", "Cut (not rounded) to places decimals; on a date, cut to the day (or the part given).", 1, 2, (a) => {
  if (anyNull(a, 1)) return null;
  if (typeof a[0] === "string" && /^\d{4}-\d{2}-\d{2}/.test(a[0])) { const x = toDT(a[0], "TRUNC")!; return dateText(trunc(x, a[1] === undefined ? "day" : unitOf(a[1], "TRUNC")).d); }
  const f = 10 ** (a[1] === undefined ? 0 : int(a[1]));
  return clean(Math.trunc(num(a[0], "TRUNC") * f) / f);
});
fn("MOD", N, "MOD(x, y) · x % y", "The remainder of x / y (NULL when y is 0).", 2, 2, (a) => (anyNull(a) || num(a[1]) === 0 ? null : clean(num(a[0]) % num(a[1]))));
fn("DIV", N, "DIV(x, y) · x DIV y", "Whole-number division.", 2, 2, (a) => (anyNull(a) || num(a[1]) === 0 ? null : Math.trunc(num(a[0]) / num(a[1]))));
fn("POWER POW", N, "POWER(x, y)", "x to the power y.", 2, 2, (a) => (anyNull(a) ? null : clean(num(a[0]) ** num(a[1]))));
fn("SQUARE", N, "SQUARE(x)", "x times x.", 1, 1, n1((x) => x * x, "SQUARE"));
fn("SQRT", N, "SQRT(x)", "Square root (NULL for a negative x).", 1, 1, n1((x) => (x < 0 ? null : Math.sqrt(x)), "SQRT"));
fn("CBRT", N, "CBRT(x)", "Cube root.", 1, 1, n1(Math.cbrt, "CBRT"));
fn("EXP", N, "EXP(x)", "e to the power x.", 1, 1, n1(Math.exp, "EXP"));
fn("LN", N, "LN(x)", "Natural logarithm.", 1, 1, n1((x) => (x <= 0 ? null : Math.log(x)), "LN"));
fn("LOG", N, "LOG(x) · LOG(base, x)", "Logarithm: natural with one value (MySQL, SQL Server), to base with two (MySQL / PostgreSQL order: base first).", 1, 2, (a) => (anyNull(a) ? null : a.length === 1 ? clean(num(a[0]) <= 0 ? null : Math.log(num(a[0]))) : clean(Math.log(num(a[1])) / Math.log(num(a[0])))));
fn("LOG10", N, "LOG10(x)", "Logarithm to base 10.", 1, 1, n1((x) => (x <= 0 ? null : Math.log10(x)), "LOG10"));
fn("LOG2", N, "LOG2(x)", "Logarithm to base 2.", 1, 1, n1((x) => (x <= 0 ? null : Math.log2(x)), "LOG2"));
fn("SIGN SIGNUM", N, "SIGN(x)", "-1, 0 or 1.", 1, 1, n1(Math.sign, "SIGN"));
fn("PI", N, "PI()", "3.14159…", 0, 0, () => Math.PI);
fn("RAND RANDOM", N, "RAND()", "A random number from 0 up to 1.", 0, 1, () => Math.random());
fn("SIN", N, "SIN(x)", "Sine (x in radians).", 1, 1, n1(Math.sin, "SIN"));
fn("COS", N, "COS(x)", "Cosine.", 1, 1, n1(Math.cos, "COS"));
fn("TAN", N, "TAN(x)", "Tangent.", 1, 1, n1(Math.tan, "TAN"));
fn("COT", N, "COT(x)", "Cotangent.", 1, 1, n1((x) => 1 / Math.tan(x), "COT"));
fn("ASIN", N, "ASIN(x)", "Arc sine.", 1, 1, n1(Math.asin, "ASIN"));
fn("ACOS", N, "ACOS(x)", "Arc cosine.", 1, 1, n1(Math.acos, "ACOS"));
fn("ATAN", N, "ATAN(x) · ATAN(y, x)", "Arc tangent.", 1, 2, (a) => (anyNull(a) ? null : clean(a.length === 2 ? Math.atan2(num(a[0]), num(a[1])) : Math.atan(num(a[0])))));
fn("ATAN2 ATN2", N, "ATAN2(y, x)", "Arc tangent of y / x.", 2, 2, (a) => (anyNull(a) ? null : clean(Math.atan2(num(a[0]), num(a[1])))));
fn("SINH", N, "SINH(x)", "Hyperbolic sine.", 1, 1, n1(Math.sinh, "SINH"));
fn("COSH", N, "COSH(x)", "Hyperbolic cosine.", 1, 1, n1(Math.cosh, "COSH"));
fn("TANH", N, "TANH(x)", "Hyperbolic tangent.", 1, 1, n1(Math.tanh, "TANH"));
fn("DEGREES", N, "DEGREES(x)", "Radians to degrees.", 1, 1, n1((x) => (x * 180) / Math.PI, "DEGREES"));
fn("RADIANS", N, "RADIANS(x)", "Degrees to radians.", 1, 1, n1((x) => (x * Math.PI) / 180, "RADIANS"));
fn("GREATEST", N, "GREATEST(a, b, …)", "The largest value (NULLs skipped, as in PostgreSQL and SQL Server).", 1, Infinity, (a) => pick(a, 1));
fn("LEAST", N, "LEAST(a, b, …)", "The smallest value (NULLs skipped).", 1, Infinity, (a) => pick(a, -1));
fn("GCD", N, "GCD(a, b)", "Greatest common divisor.", 2, 2, (a) => (anyNull(a) ? null : gcd(int(a[0]), int(a[1]))));
fn("LCM", N, "LCM(a, b)", "Least common multiple.", 2, 2, (a) => (anyNull(a) ? null : (() => { const x = int(a[0]), y = int(a[1]); return x && y ? Math.abs((x * y) / gcd(x, y)) : 0; })()));
fn("FACTORIAL", N, "FACTORIAL(n)", "1 × 2 × … × n.", 1, 1, n1((x) => (x < 0 ? null : Array.from({ length: Math.trunc(x) }, (_, i) => i + 1).reduce((p, v) => p * v, 1)), "FACTORIAL"));
fn("WIDTH_BUCKET", N, "WIDTH_BUCKET(x, low, high, buckets)", "Which of buckets equal bands between low and high x falls in (0 below, buckets + 1 above).", 4, 4, (a) => {
  if (anyNull(a)) return null;
  const [x, lo, hi, n] = a.map((v) => num(v));
  return x < lo ? 0 : x >= hi ? n + 1 : Math.floor(((x - lo) / (hi - lo)) * n) + 1;
});
fn("ISNUMERIC IS_NUMBER", N, "ISNUMERIC(value)", "1 when the value is a number.", 1, 1, (a) => (isNull(a[0]) ? 0 : typeof a[0] === "number" || (a[0].trim() !== "" && !Number.isNaN(Number(a[0]))) ? 1 : 0));
fn("BIT_COUNT", N, "BIT_COUNT(n)", "How many 1 bits.", 1, 1, n1((x) => [...Math.trunc(x).toString(2)].filter((c) => c === "1").length, "BIT_COUNT"));
fn("CONV", N, "CONV(n, from_base, to_base)", "MySQL: a number from one base to another.", 3, 3, (a) => (anyNull(a) ? null : parseInt(str(a[0]), int(a[1])).toString(int(a[2])).toUpperCase()));
fn("BIN", N, "BIN(n)", "In binary.", 1, 1, n1((x) => Number(Math.trunc(x).toString(2)), "BIN"));
fn("OCT", N, "OCT(n)", "In octal.", 1, 1, n1((x) => Number(Math.trunc(x).toString(8)), "OCT"));

// conditional and NULL
fn("COALESCE", C, "COALESCE(a, b, …)", "The first value that is not NULL.", 1, Infinity, (a) => a.find((x) => !isNull(x)) ?? null);
fn("IFNULL NVL", C, "IFNULL(a, b) · NVL(a, b)", "a, or b when a is NULL.", 2, 2, (a) => (isNull(a[0]) ? a[1] : a[0]));
fn("ISNULL", C, "ISNULL(a, b) · ISNULL(a)", "SQL Server: a, or b when a is NULL. MySQL, one value: 1 when it is NULL.", 1, 2, (a) => (a.length === 1 ? (isNull(a[0]) ? 1 : 0) : isNull(a[0]) ? a[1] : a[0]));
fn("NVL2", C, "NVL2(a, if_not_null, if_null)", "Oracle: the second value when a is not NULL, else the third.", 3, 3, (a) => (isNull(a[0]) ? a[2] : a[1]));
fn("NULLIF", C, "NULLIF(a, b)", "NULL when a = b, else a.", 2, 2, (a) => (!isNull(a[0]) && !isNull(a[1]) && (typeof a[0] === "number" || typeof a[1] === "number" ? num(a[0]) === num(a[1]) : str(a[0]).toUpperCase() === str(a[1]).toUpperCase()) ? null : a[0]));
fn("IF IIF", C, "IF(condition, then, else) · IIF(…)", "then when the condition holds, else otherwise.", 3, 3, (a) => (truthy(a[0]) ? a[1] : a[2]));
fn("DECODE", C, "DECODE(value, match1, result1, …, [default])", "Oracle: like CASE value WHEN match1 THEN result1 … ELSE default END.", 3, Infinity, (a) => {
  for (let k = 1; k + 1 < a.length; k += 2) if ((isNull(a[0]) && isNull(a[k])) || (!isNull(a[0]) && !isNull(a[k]) && str(a[0]).toUpperCase() === str(a[k]).toUpperCase())) return a[k + 1];
  return a.length % 2 === 0 ? a[a.length - 1] : null;
});
fn("ZEROIFNULL", C, "ZEROIFNULL(x)", "0 when x is NULL.", 1, 1, (a) => (isNull(a[0]) ? 0 : a[0]));
fn("NULLIFZERO", C, "NULLIFZERO(x)", "NULL when x is 0.", 1, 1, (a) => (!isNull(a[0]) && num(a[0]) === 0 ? null : a[0]));
fn("EQUAL_NULL", C, "EQUAL_NULL(a, b)", "1 when a equals b, NULLs counting as equal.", 2, 2, (a) => ((isNull(a[0]) && isNull(a[1])) || (!isNull(a[0]) && !isNull(a[1]) && str(a[0]) === str(a[1])) ? 1 : 0));

// conversion
fn("CAST TRY_CAST SAFE_CAST", V, "CAST(value AS type) · TRY_CAST(…)", "To another type: INT, DECIMAL(p,s), FLOAT, VARCHAR(n), DATE, DATETIME, TIME, BOOLEAN. TRY_CAST gives NULL instead of an error.", 2, 3, (a) => (a[2] === "try" ? tryCall(() => castTo(a[0], str(a[1]))) : castTo(a[0], str(a[1]))));
fn("CONVERT TRY_CONVERT", V, "CONVERT(type, value [, style]) · CONVERT(value, type)", "SQL Server / MySQL: like CAST. Style 103 = dd/mm/yyyy, 101 = mm/dd/yyyy, 120 = yyyy-mm-dd hh:mi:ss.", 2, 4, (a) => {
  const f = () => {
    const out = castTo(a[0], str(a[1]));
    const style = a[2] === undefined || isNull(a[2]) ? null : int(a[2]);
    const x = style !== null ? toDT(a[0], "CONVERT") : null;
    if (x && /char|text|string/i.test(str(a[1]))) {
      const d = x.d, dd = pad2(d.getUTCDate()), mm = pad2(d.getUTCMonth() + 1), y = d.getUTCFullYear();
      const styled: Record<number, string> = { 101: `${mm}/${dd}/${y}`, 103: `${dd}/${mm}/${y}`, 104: `${dd}.${mm}.${y}`, 105: `${dd}-${mm}-${y}`, 106: `${dd} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${y}`, 108: timeText(d), 110: `${mm}-${dd}-${y}`, 111: `${y}/${mm}/${dd}`, 112: `${y}${mm}${dd}`, 120: `${dateText(d)} ${timeText(d)}`, 121: `${dateText(d)} ${timeText(d)}.000`, 23: dateText(d), 126: `${dateText(d)}T${timeText(d)}` };
      if (styled[style!]) return styled[style!];
    }
    return out;
  };
  return a[3] === "try" ? tryCall(f) : f();
});
fn("TO_NUMBER TO_DECIMAL TO_DOUBLE", V, "TO_NUMBER(text [, format])", "Oracle / PostgreSQL: a number from text (grouping commas and currency signs ignored).", 1, 2, (a) => (isNull(a[0]) ? null : typeof a[0] === "number" ? a[0] : num(str(a[0]).replace(/[,\s]|Rs\.?|\$/g, ""), "TO_NUMBER")));
fn("TO_CHAR VARCHAR_FORMAT", V, "TO_CHAR(value [, format])", "Oracle / PostgreSQL: a date as text ('DD/MM/YYYY HH24:MI', 'Mon YYYY', 'Day') or a number ('999,999.99', 'FM990.0').", 1, 2, (a) => {
  if (isNull(a[0])) return null;
  if (a[1] === undefined) return str(a[0]);
  if (typeof a[0] === "number" && !/[YMDHS]/i.test(str(a[1]).replace(/FM/i, ""))) return formatNumber(a[0], str(a[1]));
  const x = toDT(a[0], "TO_CHAR");
  return x ? formatOracle(x, str(a[1])) : null;
});
fn("TO_DATE", V, "TO_DATE(text [, format])", "Oracle / PostgreSQL: a date from text, e.g. TO_DATE('05/10/2026', 'DD/MM/YYYY').", 1, 2, (a) => {
  if (isNull(a[0])) return null;
  if (a[1] === undefined) { const x = toDT(a[0], "TO_DATE"); return x ? dateText(x.d) : null; }
  const x = parseWithPattern(str(a[0]), str(a[1]), false) ?? fail(`TO_DATE: "${a[0]}" does not match ${a[1]}.`);
  return x.time ? dtText(x) : dateText(x.d);
});
fn("TO_TIMESTAMP TO_DATETIME", V, "TO_TIMESTAMP(text [, format])", "A date and time from text.", 1, 2, (a) => {
  if (isNull(a[0])) return null;
  const x = a[1] === undefined ? toDT(a[0], "TO_TIMESTAMP") : parseWithPattern(str(a[0]), str(a[1]), false) ?? fail(`TO_TIMESTAMP: "${a[0]}" does not match ${a[1]}.`);
  return x ? `${dateText(x.d)} ${timeText(x.d)}` : null;
});
fn("STR_TO_DATE", V, "STR_TO_DATE(text, format)", "MySQL: a date from text, e.g. STR_TO_DATE('05/10/2026', '%d/%m/%Y').", 2, 2, (a) => {
  if (anyNull(a)) return null;
  const x = parseWithPattern(str(a[0]), str(a[1]), true);
  return x ? (x.time ? dtText(x) : dateText(x.d)) : null;
});
fn("STR", V, "STR(number [, length [, decimals]])", "SQL Server: a number as right-aligned text.", 1, 3, (a) => (isNull(a[0]) ? null : (a[2] === undefined ? String(Math.round(num(a[0]))) : num(a[0]).toFixed(int(a[2]))).padStart(a[1] === undefined ? 10 : int(a[1]))));
fn("FORMAT", V, "FORMAT(number, decimals) · FORMAT(value, 'N2' | 'yyyy-MM-dd')", "MySQL: 1234.5 -> '1,234.50'. SQL Server: a .NET pattern for numbers (N2, P1, C) or dates (dd/MM/yyyy, MMMM yyyy).", 2, 3, (a) => {
  if (anyNull(a, 2)) return null;
  if (typeof a[1] === "number") return grouped(num(a[0], "FORMAT"), int(a[1]));
  const f = str(a[1]);
  if (typeof a[0] === "number" || /^[NnFfPpCcDdEe]\d*$|^[#0,.%]+$/.test(f)) return /^[#0,.%]+$/.test(f) ? formatNumber(num(a[0]), f.replace(/#/g, "9")) : formatNumber(num(a[0]), f);
  const x = toDT(a[0], "FORMAT");
  return x ? formatDotNet(x, f) : null;
});
fn("TO_BOOLEAN BOOL", V, "TO_BOOLEAN(value)", "1 for true / yes / 1, 0 for false / no / 0.", 1, 1, (a) => castTo(a[0], "boolean"));
fn("TYPEOF PG_TYPEOF", V, "TYPEOF(value)", "The kind of value: null, integer, real or text (as SQLite says).", 1, 1, (a) => (isNull(a[0]) ? "null" : typeof a[0] === "number" ? (Number.isInteger(a[0]) ? "integer" : "real") : "text"));

// dates and times
const today = () => dateText(nowLocal());
const nowText = () => { const d = nowLocal(); return `${dateText(d)} ${timeText(d)}`; };
fn("CURRENT_DATE CURDATE SYSDATE_DATE TODAY", D, "CURRENT_DATE", "Today's date.", 0, 0, today);
fn("CURRENT_TIMESTAMP NOW GETDATE SYSDATE SYSDATETIME LOCALTIMESTAMP LOCALTIME_STAMP DATETIME_NOW", D, "NOW() · CURRENT_TIMESTAMP · GETDATE()", "The date and time now (this PC).", 0, 1, nowText);
fn("UTC_TIMESTAMP GETUTCDATE SYSUTCDATETIME", D, "UTC_TIMESTAMP()", "The date and time now in UTC.", 0, 0, () => { const n = new Date(); return `${n.toISOString().slice(0, 10)} ${n.toISOString().slice(11, 19)}`; });
fn("UTC_DATE", D, "UTC_DATE()", "Today's date in UTC.", 0, 0, () => new Date().toISOString().slice(0, 10));
fn("CURRENT_TIME CURTIME LOCALTIME", D, "CURRENT_TIME", "The time now.", 0, 1, () => timeText(nowLocal()));
const dt1 = (name: string, f: (x: DT) => Val) => (a: Val[]) => { const x = toDT(a[0], name); return x ? f(x) : null; };
fn("DATE", D, "DATE(value)", "The date part ('YYYY-MM-DD').", 1, 1, dt1("DATE", (x) => dateText(x.d)));
fn("TIME", D, "TIME(value)", "The time part ('HH:MM:SS'); on in / out, their clock time.", 1, 1, dt1("TIME", (x) => timeText(x.d)));
fn("DATETIME TIMESTAMP", D, "DATETIME(date [, time])", "A date and time.", 1, 2, (a) => {
  const x = toDT(a[0], "DATETIME");
  if (!x) return null;
  if (a[1] !== undefined && !isNull(a[1])) { const t = toDT(a[1], "DATETIME")!; x.d.setUTCHours(t.d.getUTCHours(), t.d.getUTCMinutes(), t.d.getUTCSeconds()); }
  return `${dateText(x.d)} ${timeText(x.d)}`;
});
fn("YEAR", D, "YEAR(date)", "The year.", 1, 1, dt1("YEAR", (x) => part(x, "year")));
fn("QUARTER", D, "QUARTER(date)", "1–4.", 1, 1, dt1("QUARTER", (x) => part(x, "quarter")));
fn("MONTH", D, "MONTH(date)", "1–12.", 1, 1, dt1("MONTH", (x) => part(x, "month")));
fn("DAY DAYOFMONTH", D, "DAY(date)", "Day of the month, 1–31.", 1, 1, dt1("DAY", (x) => part(x, "day")));
fn("HOUR", D, "HOUR(time)", "0–23 (on in / out: the clock hour).", 1, 1, dt1("HOUR", (x) => part(x, "hour")));
fn("MINUTE", D, "MINUTE(time)", "0–59.", 1, 1, dt1("MINUTE", (x) => part(x, "minute")));
fn("SECOND", D, "SECOND(time)", "0–59.", 1, 1, dt1("SECOND", (x) => part(x, "second")));
fn("DAYOFWEEK", D, "DAYOFWEEK(date)", "MySQL: 1 = Sunday … 7 = Saturday.", 1, 1, dt1("DAYOFWEEK", (x) => part(x, "weekday")));
fn("WEEKDAY", D, "WEEKDAY(date)", "MySQL: 0 = Monday … 6 = Sunday.", 1, 1, dt1("WEEKDAY", (x) => (x.d.getUTCDay() + 6) % 7));
fn("ISODOW", D, "ISODOW(date)", "1 = Monday … 7 = Sunday.", 1, 1, dt1("ISODOW", (x) => part(x, "isodow")));
fn("DAYOFYEAR", D, "DAYOFYEAR(date)", "1–366.", 1, 1, dt1("DAYOFYEAR", (x) => part(x, "dayofyear")));
fn("WEEK", D, "WEEK(date [, mode])", "MySQL: week of the year (mode 0: weeks start on Sunday, 0–53; modes 1 and 3: ISO weeks, Monday start).", 1, 2, (a) => { const x = toDT(a[0], "WEEK"); if (!x) return null; const mode = a[1] === undefined ? 0 : int(a[1]); return mode % 2 === 1 ? isoWeek(x.d).week : sundayWeek(x.d); });
fn("WEEKOFYEAR ISOWEEK ISO_WEEK", D, "WEEKOFYEAR(date)", "ISO week number, 1–53 (weeks start on Monday).", 1, 1, dt1("WEEKOFYEAR", (x) => isoWeek(x.d).week));
fn("YEARWEEK", D, "YEARWEEK(date)", "MySQL: year and week, e.g. 202641.", 1, 2, dt1("YEARWEEK", (x) => { const w = isoWeek(x.d); return w.year * 100 + w.week; }));
fn("DAYNAME", D, "DAYNAME(date)", "Monday … Sunday.", 1, 1, dt1("DAYNAME", (x) => DAYS[x.d.getUTCDay()]));
fn("MONTHNAME", D, "MONTHNAME(date)", "January … December.", 1, 1, dt1("MONTHNAME", (x) => MONTHS[x.d.getUTCMonth()]));
fn("LAST_DAY EOMONTH", D, "LAST_DAY(date) · EOMONTH(date [, months])", "The last day of the month (EOMONTH: months later).", 1, 2, (a) => { const x = toDT(a[0], "LAST_DAY"); if (!x) return null; const m = addTo({ d: new Date(Date.UTC(x.d.getUTCFullYear(), x.d.getUTCMonth(), 1)), time: false }, "month", a[1] === undefined ? 0 : int(a[1])).d; return dateText(new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0))); });
fn("DATEADD", D, "DATEADD(part, n, date)", "SQL Server: n parts (year, month, day, hour, …) added to date.", 3, 3, (a) => { if (anyNull(a)) return null; const x = toDT(a[2], "DATEADD")!; return dtText(addTo(x, unitOf(a[0], "DATEADD"), num(a[1]))); });
fn("TIMESTAMPADD", D, "TIMESTAMPADD(part, n, date)", "MySQL: like DATEADD.", 3, 3, (a) => { if (anyNull(a)) return null; const x = toDT(a[2], "TIMESTAMPADD")!; return dtText(addTo(x, unitOf(a[0], "TIMESTAMPADD"), num(a[1]))); });
const addInterval = (name: string, sign: number) => (a: Val[]) => {
  if (anyNull(a)) return null;
  const x = toDT(a[0], name)!;
  const iv = parseInterval(a[1]);
  if (iv) return dtText(addTo(x, iv.u, sign * iv.n));
  if (a[2] !== undefined) return dtText(addTo(x, unitOf(a[2], name), sign * num(a[1]))); // DATE_ADD(d, 3, 'day')
  return dtText(addTo(x, "day", sign * num(a[1]))); // ADDDATE(d, 3): days
};
fn("DATE_ADD ADDDATE", D, "DATE_ADD(date, INTERVAL n unit)", "MySQL: date plus an interval, e.g. DATE_ADD(date, INTERVAL 7 DAY). Also date + INTERVAL '7' DAY.", 2, 3, addInterval("DATE_ADD", 1));
fn("DATE_SUB SUBDATE", D, "DATE_SUB(date, INTERVAL n unit)", "MySQL: date minus an interval.", 2, 3, addInterval("DATE_SUB", -1));
fn("ADD_MONTHS", D, "ADD_MONTHS(date, n)", "Oracle: n months later (end of month kept).", 2, 2, (a) => { if (anyNull(a)) return null; const x = toDT(a[0], "ADD_MONTHS")!; return dtText(addTo(x, "month", int(a[1]))); });
fn("ADDTIME", D, "ADDTIME(time, 'HH:MM:SS')", "MySQL: a time plus a duration.", 2, 2, (a) => { if (anyNull(a)) return null; const x = toDT(a[0], "ADDTIME")!, t = toDT(a[1], "ADDTIME")!; return dtTextLike(a[0], addTo(x, "second", (+t.d - Date.UTC(1900, 0, 1)) / 1000)); });
fn("SUBTIME", D, "SUBTIME(time, 'HH:MM:SS')", "MySQL: a time minus a duration.", 2, 2, (a) => { if (anyNull(a)) return null; const x = toDT(a[0], "SUBTIME")!, t = toDT(a[1], "SUBTIME")!; return dtTextLike(a[0], addTo(x, "second", -(+t.d - Date.UTC(1900, 0, 1)) / 1000)); });
const dtTextLike = (orig: Val, x: DT) => (typeof orig === "number" || /^\d{1,3}:\d{2}/.test(String(orig)) ? timeText(x.d) : dtText(x));
fn("DATEDIFF", D, "DATEDIFF(end, start) · DATEDIFF(part, start, end)", "MySQL: days from start to end. SQL Server: part boundaries crossed (DATEDIFF(month, '2026-01-31', '2026-02-01') = 1).", 2, 3, (a) => {
  if (anyNull(a)) return null;
  if (a.length === 2) { const e = toDT(a[0], "DATEDIFF")!, s = toDT(a[1], "DATEDIFF")!; return diff("day", trunc(s, "day"), trunc(e, "day"), false); }
  return diff(unitOf(a[0], "DATEDIFF"), toDT(a[1], "DATEDIFF")!, toDT(a[2], "DATEDIFF")!, true);
});
fn("DATEDIFF_BIG", D, "DATEDIFF_BIG(part, start, end)", "SQL Server: like DATEDIFF.", 3, 3, (a) => (anyNull(a) ? null : diff(unitOf(a[0], "DATEDIFF_BIG"), toDT(a[1], "DATEDIFF_BIG")!, toDT(a[2], "DATEDIFF_BIG")!, true)));
fn("TIMESTAMPDIFF", D, "TIMESTAMPDIFF(part, start, end)", "MySQL: whole parts from start to end (TIMESTAMPDIFF(MONTH, '2026-01-31', '2026-02-01') = 0).", 3, 3, (a) => (anyNull(a) ? null : diff(unitOf(a[0], "TIMESTAMPDIFF"), toDT(a[1], "TIMESTAMPDIFF")!, toDT(a[2], "TIMESTAMPDIFF")!, false)));
fn("MONTHS_BETWEEN", D, "MONTHS_BETWEEN(end, start)", "Oracle: months between two dates (with a fraction).", 2, 2, (a) => {
  if (anyNull(a)) return null;
  const e = toDT(a[0], "MONTHS_BETWEEN")!.d, s = toDT(a[1], "MONTHS_BETWEEN")!.d;
  const whole = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth();
  return clean(Math.round((whole + (e.getUTCDate() - s.getUTCDate()) / 31) * 1e8) / 1e8);
});
fn("TIMEDIFF", D, "TIMEDIFF(end, start)", "MySQL: the time between, as 'HH:MM:SS' (works on out and in).", 2, 2, (a) => {
  if (anyNull(a)) return null;
  const s = Math.round((+toDT(a[0], "TIMEDIFF")!.d - +toDT(a[1], "TIMEDIFF")!.d) / 1000), abs = Math.abs(s);
  return `${s < 0 ? "-" : ""}${pad2(Math.floor(abs / 3600))}:${pad2(Math.floor((abs % 3600) / 60))}:${pad2(abs % 60)}`;
});
fn("AGE", D, "AGE(end [, start])", "PostgreSQL: the years, months and days between (start: today).", 1, 2, (a) => {
  if (anyNull(a)) return null;
  const e = toDT(a[0], "AGE")!, s = a[1] === undefined ? { d: nowLocal(), time: false } : toDT(a[1], "AGE")!;
  const [late, early] = a[1] === undefined ? [s, e] : [e, s];
  let m = wholeMonths(early, late);
  const y = Math.trunc(m / 12);
  m -= y * 12;
  const days = diff("day", addTo(early, "month", y * 12 + m), late, false);
  return `${y} years ${m} mons ${days} days`;
});
fn("DATE_PART DATEPART", D, "DATE_PART('part', date) · DATEPART(part, date)", "A part of a date: year, quarter, month, week, day, dow (0 = Sunday), isodow, doy, hour, minute, second, epoch.", 2, 2, (a) => { if (anyNull(a)) return null; const x = toDT(a[1], "DATE_PART")!; return part(x, unitOf(a[0], "DATE_PART")); });
fn("EXTRACT", D, "EXTRACT(part FROM date)", "A part of a date (as DATE_PART).", 2, 2, (a) => { if (anyNull(a)) return null; const x = toDT(a[1], "EXTRACT")!; return part(x, unitOf(a[0], "EXTRACT")); });
fn("DATENAME", D, "DATENAME(part, date)", "SQL Server: the part as text (month: October, weekday: Monday).", 2, 2, (a) => { if (anyNull(a)) return null; const x = toDT(a[1], "DATENAME")!, u = unitOf(a[0], "DATENAME"); return u === "month" ? MONTHS[x.d.getUTCMonth()] : u === "weekday" ? DAYS[x.d.getUTCDay()] : String(part(x, u)); });
fn("DATE_TRUNC DATETRUNC", D, "DATE_TRUNC('part', date) · DATETRUNC(part, date)", "The date cut back to the start of its year, quarter, month, week (Monday), day, hour or minute.", 2, 2, (a) => { if (anyNull(a)) return null; const x = toDT(a[1], "DATE_TRUNC")!; return dtText(trunc(x, unitOf(a[0], "DATE_TRUNC"))); });
fn("DATE_FORMAT", D, "DATE_FORMAT(date, format)", "MySQL: %Y year, %m month, %d day, %H hour, %i minutes, %s seconds, %b Oct, %M October, %a Mon, %W Monday, %p AM/PM.", 2, 2, (a) => { if (anyNull(a)) return null; const x = toDT(a[0], "DATE_FORMAT")!; return formatPercent(x, str(a[1])); });
fn("TIME_FORMAT", D, "TIME_FORMAT(time, format)", "MySQL: a time with %H, %i, %s, %h, %p.", 2, 2, (a) => { if (anyNull(a)) return null; const x = toDT(a[0], "TIME_FORMAT")!; return formatPercent(x, str(a[1])); });
fn("STRFTIME", D, "STRFTIME(format, date)", "SQLite: %Y, %m, %d, %H, %M (minutes), %S, %j, %w, %W.", 2, 2, (a) => { if (anyNull(a)) return null; const x = toDT(a[1], "STRFTIME")!; return formatStrftime(x, str(a[0])); });
fn("JULIANDAY", D, "JULIANDAY(date)", "SQLite: the Julian day number.", 1, 1, dt1("JULIANDAY", (x) => clean(+x.d / 864e5 + 2440587.5)));
fn("UNIX_TIMESTAMP EPOCH", D, "UNIX_TIMESTAMP([date])", "Seconds since 1970-01-01.", 0, 1, (a) => (a.length ? dt1("UNIX_TIMESTAMP", (x) => part(x, "epoch"))(a) : Math.floor(Date.now() / 1000)));
fn("FROM_UNIXTIME TO_TIMESTAMP_SECONDS", D, "FROM_UNIXTIME(seconds)", "The date and time of a Unix time.", 1, 1, (a) => (isNull(a[0]) ? null : (() => { const d = new Date(num(a[0]) * 1000); return `${dateText(d)} ${timeText(d)}`; })()));
fn("MAKEDATE", D, "MAKEDATE(year, day_of_year)", "MySQL: the date of day n of a year.", 2, 2, (a) => (anyNull(a) ? null : dateText(new Date(Date.UTC(int(a[0]), 0, int(a[1]))))));
fn("MAKE_DATE DATEFROMPARTS DATE_FROM_PARTS", D, "MAKE_DATE(year, month, day)", "A date from its parts.", 3, 3, (a) => (anyNull(a) ? null : dateText(new Date(Date.UTC(int(a[0]), int(a[1]) - 1, int(a[2]))))));
fn("MAKETIME MAKE_TIME TIMEFROMPARTS", D, "MAKETIME(hour, minute, second)", "A time from its parts.", 3, 5, (a) => (anyNull(a, 3) ? null : `${pad2(int(a[0]))}:${pad2(int(a[1]))}:${pad2(int(a[2]))}`));
fn("DATETIMEFROMPARTS MAKE_TIMESTAMP", D, "MAKE_TIMESTAMP(y, m, d, h, mi, s)", "A date and time from its parts.", 6, 7, (a) => (anyNull(a, 6) ? null : (() => { const d = new Date(Date.UTC(int(a[0]), int(a[1]) - 1, int(a[2]), int(a[3]), int(a[4]), int(a[5]))); return `${dateText(d)} ${timeText(d)}`; })()));
fn("SEC_TO_TIME", D, "SEC_TO_TIME(seconds)", "MySQL: seconds as 'HH:MM:SS'.", 1, 1, (a) => (isNull(a[0]) ? null : (() => { const s = Math.round(num(a[0])), abs = Math.abs(s); return `${s < 0 ? "-" : ""}${pad2(Math.floor(abs / 3600))}:${pad2(Math.floor((abs % 3600) / 60))}:${pad2(abs % 60)}`; })()));
fn("TIME_TO_SEC", D, "TIME_TO_SEC(time)", "MySQL: a time in seconds (on in / out: seconds after midnight).", 1, 1, dt1("TIME_TO_SEC", (x) => Math.round((+x.d - Date.UTC(x.d.getUTCFullYear(), x.d.getUTCMonth(), x.d.getUTCDate())) / 1000) + (x.d.getUTCFullYear() === 1900 && x.d.getUTCDate() > 1 ? 86400 * (x.d.getUTCDate() - 1) : 0)));
fn("TO_DAYS", D, "TO_DAYS(date)", "MySQL: days since year 0.", 1, 1, dt1("TO_DAYS", (x) => Math.floor(+x.d / 864e5) + 719528));
fn("FROM_DAYS", D, "FROM_DAYS(n)", "MySQL: the date n days after year 0.", 1, 1, (a) => (isNull(a[0]) ? null : dateText(new Date((int(a[0]) - 719528) * 864e5))));
fn("NEXT_DAY", D, "NEXT_DAY(date, 'Monday')", "Oracle: the first such weekday after date.", 2, 2, (a) => {
  if (anyNull(a)) return null;
  const x = toDT(a[0], "NEXT_DAY")!, want = DAYS.findIndex((d) => d.toLowerCase().startsWith(str(a[1]).toLowerCase().slice(0, 3)));
  if (want < 0) return fail(`NEXT_DAY: "${a[1]}" is not a day of the week.`);
  const d = new Date(x.d);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== want);
  return dateText(d);
});
fn("ISDATE", D, "ISDATE(value)", "1 when the value is a date.", 1, 1, (a) => (tryCall(() => (toDT(a[0], "ISDATE") ? 1 : 0)) ?? 0));
fn("PERIOD_DIFF", D, "PERIOD_DIFF(YYYYMM, YYYYMM)", "MySQL: months between two periods.", 2, 2, (a) => (anyNull(a) ? null : (() => { const p = (v: Val) => { const n = int(v); return Math.floor(n / 100) * 12 + (n % 100); }; return p(a[0]) - p(a[1]); })()));
fn("PERIOD_ADD", D, "PERIOD_ADD(YYYYMM, n)", "MySQL: a period n months later.", 2, 2, (a) => (anyNull(a) ? null : (() => { const t = Math.floor(int(a[0]) / 100) * 12 + (int(a[0]) % 100) - 1 + int(a[1]); return Math.floor(t / 12) * 100 + (t % 12) + 1; })()));

// other
fn("UUID NEWID GEN_RANDOM_UUID UUID_GENERATE_V4", O, "UUID()", "A new random identifier.", 0, 0, () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`));
fn("VERSION @@VERSION", O, "VERSION()", "Which SQL this is.", 0, 0, () => "Labour Entry Assistant SQL (reads the open workbook; changes go to the waiting list)");
fn("DATABASE CURRENT_DATABASE DB_NAME SCHEMA CURRENT_SCHEMA", O, "DATABASE()", "The open workbook's month (the tables are this month's sheets).", 0, 0, () => "this workbook");

function pick(a: Val[], dir: 1 | -1): Val {
  const vals = a.filter((x) => !isNull(x));
  if (!vals.length) return null;
  const numeric = vals.every((x) => typeof x === "number" || (!Number.isNaN(Number(x)) && String(x).trim() !== ""));
  return vals.reduce((best, x) => {
    const c = numeric ? num(x) - num(best) : str(x).localeCompare(str(best));
    return c * dir > 0 ? x : best;
  });
}
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
export const truthy = (v: Val) => v !== null && v !== 0 && v !== "" && v !== "0";

// --- aggregates and window functions ------------------------------------------------------------------

const AGG_INFO: [string, string, string][] = [
  ["COUNT", "COUNT(*) · COUNT(x) · COUNT(DISTINCT x)", "How many rows (or values that are not NULL)."],
  ["COUNT_BIG", "COUNT_BIG(*)", "SQL Server: like COUNT."],
  ["SUM", "SUM(x)", "The total."],
  ["AVG MEAN", "AVG(x)", "The average."],
  ["MIN", "MIN(x)", "The smallest."],
  ["MAX", "MAX(x)", "The largest."],
  ["GROUP_CONCAT", "GROUP_CONCAT([DISTINCT] x [ORDER BY …] [SEPARATOR ', '])", "MySQL / SQLite: the values joined (comma by default)."],
  ["STRING_AGG", "STRING_AGG(x, ', ' [ORDER BY …])", "PostgreSQL / SQL Server: the values joined with a separator."],
  ["LISTAGG", "LISTAGG(x, ', ') WITHIN GROUP (ORDER BY …)", "Oracle: the values joined with a separator."],
  ["ARRAY_AGG", "ARRAY_AGG(x)", "PostgreSQL: the values as a list {a,b,c}."],
  ["STDDEV STDDEV_SAMP STDEV", "STDDEV(x)", "Standard deviation (sample)."],
  ["STDDEV_POP STDEVP", "STDDEV_POP(x)", "Standard deviation (population)."],
  ["VARIANCE VAR_SAMP VAR", "VARIANCE(x)", "Variance (sample)."],
  ["VAR_POP VARP", "VAR_POP(x)", "Variance (population)."],
  ["MEDIAN", "MEDIAN(x)", "The middle value."],
  ["PERCENTILE_CONT", "PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY x)", "The value at a fraction of the way through, between values when needed."],
  ["PERCENTILE_DISC", "PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY x)", "The first value at or past a fraction of the way through."],
  ["MODE", "MODE() WITHIN GROUP (ORDER BY x) · MODE(x)", "The most common value."],
  ["BOOL_AND EVERY", "BOOL_AND(condition)", "1 when the condition holds on every row."],
  ["BOOL_OR ANY_TRUE", "BOOL_OR(condition)", "1 when it holds on any row."],
  ["ANY_VALUE ARBITRARY", "ANY_VALUE(x)", "Any one of the values (the first)."],
  ["FIRST", "FIRST(x)", "The first value in the group."],
  ["LAST", "LAST(x)", "The last value in the group."],
  ["CORR", "CORR(y, x)", "Correlation coefficient (-1 … 1)."],
  ["COVAR_POP", "COVAR_POP(y, x)", "Covariance (population)."],
  ["COVAR_SAMP", "COVAR_SAMP(y, x)", "Covariance (sample)."],
  ["REGR_SLOPE", "REGR_SLOPE(y, x)", "Slope of the least-squares line."],
  ["REGR_INTERCEPT", "REGR_INTERCEPT(y, x)", "Intercept of the least-squares line."],
  ["REGR_COUNT", "REGR_COUNT(y, x)", "Rows where both are not NULL."],
  ["REGR_R2", "REGR_R2(y, x)", "R² of the least-squares line."],
  ["APPROX_COUNT_DISTINCT", "APPROX_COUNT_DISTINCT(x)", "How many different values (exact here)."],
  ["CHECKSUM_AGG BIT_XOR", "BIT_XOR(x)", "Bitwise XOR of the values."],
  ["BIT_AND", "BIT_AND(x)", "Bitwise AND of the values."],
  ["BIT_OR", "BIT_OR(x)", "Bitwise OR of the values."],
];
const WIN_INFO: [string, string, string][] = [
  ["ROW_NUMBER", "ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)", "1, 2, 3, … in each partition."],
  ["RANK", "RANK() OVER (ORDER BY …)", "Rank with gaps after ties (1, 1, 3)."],
  ["DENSE_RANK", "DENSE_RANK() OVER (ORDER BY …)", "Rank without gaps (1, 1, 2)."],
  ["PERCENT_RANK", "PERCENT_RANK() OVER (ORDER BY …)", "(rank - 1) / (rows - 1), from 0 to 1."],
  ["CUME_DIST", "CUME_DIST() OVER (ORDER BY …)", "Share of rows at or before this one."],
  ["NTILE", "NTILE(4) OVER (ORDER BY …)", "Which of n nearly equal bands the row is in."],
  ["LAG", "LAG(x [, n [, default]]) OVER (ORDER BY …)", "The value n rows before (1 by default)."],
  ["LEAD", "LEAD(x [, n [, default]]) OVER (ORDER BY …)", "The value n rows after."],
  ["FIRST_VALUE", "FIRST_VALUE(x) OVER (…)", "The first value in the window."],
  ["LAST_VALUE", "LAST_VALUE(x) OVER (…)", "The last value in the window (up to this row unless the frame says otherwise)."],
  ["NTH_VALUE", "NTH_VALUE(x, n) OVER (…)", "The n-th value in the window."],
];
const infoOf = (rows: [string, string, string][], cat: FnCategory): FnInfo[] => rows.map(([n, sig, help]) => { const [name, ...aliases] = n.split(" "); return { name, aliases, cat, sig, help }; });
const AGG_LIST = infoOf(AGG_INFO, "Aggregate");
const WIN_LIST = infoOf(WIN_INFO, "Window");
const canon = new Map<string, string>();
for (const f of [...AGG_LIST, ...WIN_LIST, ...defs]) for (const n of [f.name, ...f.aliases]) canon.set(n.toLowerCase(), f.name.toLowerCase());
const scalarByName = new Map(defs.map((d) => [d.name.toLowerCase(), d]));
export const AGGREGATES = new Set(AGG_LIST.map((f) => f.name.toLowerCase()));
export const WINDOW_ONLY = new Set(WIN_LIST.map((f) => f.name.toLowerCase()));
/** Functions written without brackets: CURRENT_DATE, CURRENT_TIMESTAMP, … */
export const NO_PARENS = new Set(["current_date", "current_time", "current_timestamp", "localtime", "localtimestamp", "sysdate", "systimestamp", "current_user", "user", "today"]);
/** The canonical lower-case name of a function or alias (null: not a function). */
export const fnName = (name: string): string | null => canon.get(name.toLowerCase()) ?? (["current_user", "user", "session_user", "systimestamp"].includes(name.toLowerCase()) ? name.toLowerCase() : null);
export const isFunction = (name: string) => fnName(name) !== null;

/** Every function, for the panel's list and help. */
export const FUNCTIONS: FnInfo[] = [...AGG_LIST, ...WIN_LIST, ...defs.map(({ name, aliases, cat, sig, help }) => ({ name, aliases, cat, sig, help }))];
export const functionInfo = (name: string): FnInfo | null => {
  const c = fnName(name);
  return c ? FUNCTIONS.find((f) => f.name.toLowerCase() === c) ?? null : null;
};

/** A scalar function call (arguments already worked out). */
export function callScalar(name: string, args: Val[], user = ""): Val {
  const c = fnName(name);
  if (c === "current_user" || c === "user" || c === "session_user") return user || null;
  if (c === "systimestamp") return nowText();
  const d = c ? scalarByName.get(c) : null;
  if (!d) return fail(`${name.toUpperCase()} is not a function here.`);
  if (args.length < d.min || args.length > d.max)
    fail(`${d.name} takes ${d.min === d.max ? d.min : d.max === Infinity ? `${d.min} or more` : `${d.min} to ${d.max}`} value${d.max === 1 ? "" : "s"}: ${d.sig}.`);
  return d.call(args);
}

/** An aggregate over values (NULLs already in `vals`; `rows` counts rows for COUNT(*)). */
export function aggregate(name: string, vals: Val[], opts: { star?: boolean; rows?: number; distinct?: boolean; sep?: string; param?: Val; xs?: Val[] } = {}): Val {
  const c = fnName(name) ?? name.toLowerCase();
  if ((c === "count" || c === "count_big") && opts.star) return opts.rows ?? vals.length;
  let list = vals.filter((v) => !isNull(v) && v !== "");
  if (opts.distinct) {
    const seen = new Set<string>();
    list = list.filter((v) => { const k = typeof v === "number" ? `n${v}` : `s${String(v).toUpperCase()}`; return seen.has(k) ? false : (seen.add(k), true); });
  }
  const nums = () => list.map((v) => num(v, name.toUpperCase()));
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const variance = (sample: boolean) => { const xs = nums(); if (xs.length < (sample ? 2 : 1)) return null; const m = mean(xs); return xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - (sample ? 1 : 0)); };
  switch (c) {
    case "count": case "count_big": case "approx_count_distinct": return c === "approx_count_distinct" ? new Set(list.map(String)).size : list.length;
    case "sum": return list.length ? r2(nums().reduce((s, v) => s + v, 0)) : null;
    case "avg": return list.length ? r2(mean(nums())) : null;
    case "min": case "max": {
      if (!list.length) return null;
      const numeric = list.every((v) => typeof v === "number");
      return [...list].sort((a, b) => (numeric ? (a as number) - (b as number) : String(a).localeCompare(String(b), undefined, { numeric: true })))[c === "min" ? 0 : list.length - 1];
    }
    case "group_concat": return list.length ? list.map(str).join(opts.sep ?? ",") : null;
    case "string_agg": case "listagg": return list.length ? list.map(str).join(opts.sep ?? "") : null;
    case "array_agg": return list.length ? `{${list.map(str).join(",")}}` : null;
    case "stddev": { const v = variance(true); return v === null ? null : clean(Math.round(Math.sqrt(v) * 1e6) / 1e6); }
    case "stddev_pop": { const v = variance(false); return v === null ? null : clean(Math.round(Math.sqrt(v) * 1e6) / 1e6); }
    case "variance": { const v = variance(true); return v === null ? null : clean(Math.round(v * 1e6) / 1e6); }
    case "var_pop": { const v = variance(false); return v === null ? null : clean(Math.round(v * 1e6) / 1e6); }
    case "median": case "percentile_cont": case "percentile_disc": {
      if (!list.length) return null;
      const p = c === "median" ? 0.5 : num(opts.param ?? 0.5);
      if (p < 0 || p > 1) return fail(`${name.toUpperCase()}: the fraction must be between 0 and 1.`);
      const xs = nums().sort((a, b) => a - b);
      if (c === "percentile_disc") return xs[Math.max(0, Math.ceil(p * xs.length) - 1)];
      const at = p * (xs.length - 1), lo = Math.floor(at);
      return clean(Math.round((xs[lo] + (xs[Math.min(lo + 1, xs.length - 1)] - xs[lo]) * (at - lo)) * 1e6) / 1e6);
    }
    case "mode": {
      if (!list.length) return null;
      const n = new Map<string, { v: Val; c: number }>();
      for (const v of list) { const k = String(v); n.set(k, { v, c: (n.get(k)?.c ?? 0) + 1 }); }
      return [...n.values()].sort((a, b) => b.c - a.c)[0].v;
    }
    case "bool_and": return list.length ? (list.every(truthy) ? 1 : 0) : null;
    case "bool_or": return list.length ? (list.some(truthy) ? 1 : 0) : null;
    case "any_value": case "first": return list[0] ?? null;
    case "last": return list[list.length - 1] ?? null;
    case "bit_and": return list.length ? nums().reduce((s, v) => s & Math.trunc(v), -1) : null;
    case "bit_or": return list.length ? nums().reduce((s, v) => s | Math.trunc(v), 0) : null;
    case "checksum_agg": return list.length ? nums().reduce((s, v) => s ^ Math.trunc(v), 0) : null;
    case "corr": case "covar_pop": case "covar_samp": case "regr_slope": case "regr_intercept": case "regr_count": case "regr_r2": {
      const pairs = vals.map((y, i) => [y, opts.xs?.[i] ?? null] as const); // CORR(y, x): vals are y, xs are x
      const ok = pairs.filter(([y, x]) => !isNull(y) && !isNull(x)).map(([y, x]) => [num(y), num(x)] as const);
      if (c === "regr_count") return ok.length;
      if (ok.length < (c === "covar_samp" ? 2 : 1)) return null;
      const my = mean(ok.map((p) => p[0])), mx = mean(ok.map((p) => p[1]));
      const sxy = ok.reduce((s, [y, x]) => s + (x - mx) * (y - my), 0), sxx = ok.reduce((s, [, x]) => s + (x - mx) ** 2, 0), syy = ok.reduce((s, [y]) => s + (y - my) ** 2, 0);
      const out = c === "covar_pop" ? sxy / ok.length : c === "covar_samp" ? sxy / (ok.length - 1) : c === "corr" ? (sxx && syy ? sxy / Math.sqrt(sxx * syy) : null) : c === "regr_slope" ? (sxx ? sxy / sxx : null) : c === "regr_intercept" ? (sxx ? my - (sxy / sxx) * mx : null) : sxx && syy ? (sxy * sxy) / (sxx * syy) : null;
      return out === null ? null : clean(Math.round(out * 1e6) / 1e6);
    }
  }
  return fail(`${name.toUpperCase()} is not an aggregate.`);
}
