// The entry form's state and its conversion to the API's EntryInput.
import type { Entry, EntryInput, Worker } from "./api";
import { formulaValue } from "./calc";
import { effectiveHours, formatClock, parseClock } from "./time";

export const LINES = 5;

export interface Line {
  code: string;
  hours: string;
}

/** Time In / Time Out of one "also for" worker whose times differ from the others. */
export interface OwnTimes {
  timeIn: string;
  timeOut: string;
}

export interface FormState {
  worker: Worker | null;
  also: Worker[]; // more workers who get the same entry
  alsoTimes: Record<string, OwnTimes>; // calling name -> own In/Out for one of `also`
  query: string;
  timeIn: string;
  timeOut: string;
  overnight: boolean | null; // null = automatic (Out earlier than In)
  lines: Line[];
  additional: string;
  remark: string;
  overwrite: boolean;
  acknowledged: string[];
}

export const emptyLines = (): Line[] => Array.from({ length: LINES }, () => ({ code: "", hours: "" }));

export const emptyForm = (): FormState => ({
  worker: null,
  also: [],
  alsoTimes: {},
  query: "",
  timeIn: "",
  timeOut: "",
  overnight: null,
  lines: emptyLines(),
  additional: "",
  remark: "",
  overwrite: false,
  acknowledged: [],
});

/** Overnight in effect: as set, or automatically when Out is not after In. */
export function isOvernight(f: FormState): boolean {
  if (f.overnight !== null) return f.overnight;
  const tin = parseClock(f.timeIn);
  const tout = parseClock(f.timeOut);
  return tin !== null && tout !== null && tout <= tin;
}

const toNumber = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const f = formulaValue(t); // "=16-7" -> 9, as in Excel
  if (f !== null) return f;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN; // NaN -> the server reports it
};

export interface FormProblems {
  timeIn?: string;
  timeOut?: string;
  lines: (string | undefined)[];
  additional?: string;
}

/** Problems the browser can see before asking the server (format only). */
export function formProblems(f: FormState): FormProblems {
  const p: FormProblems = { lines: [] };
  if (f.timeIn.trim() && parseClock(f.timeIn) === null) p.timeIn = "Type a time like 7, 7.30 or 07:30";
  if (f.timeOut.trim() && parseClock(f.timeOut) === null) p.timeOut = "Type a time like 19, 19.30 or 19:30";
  f.lines.forEach((l, i) => {
    const h = toNumber(l.hours);
    if (h !== null && (Number.isNaN(h) || h <= 0)) p.lines[i] = formulaValue(l.hours) !== null ? "Check the formula, e.g. =16-7" : "Type a number of hours, like 8 or 2.5";
  });
  if (Number.isNaN(toNumber(f.additional) as number)) p.additional = formulaValue(f.additional) !== null ? "Check the formula, e.g. =2-3" : "Type a number, like -1 or 1.5";
  return p;
}

export function hasProblems(p: FormProblems): boolean {
  return Boolean(p.timeIn || p.timeOut || p.additional || p.lines.some(Boolean));
}

export function toInput(f: FormState, sheet: string, extraAcks: string[] = []): EntryInput | null {
  if (!f.worker) return null;
  const tin = parseClock(f.timeIn);
  const tout = parseClock(f.timeOut);
  const add = toNumber(f.additional);
  const out = tout === null ? null : tout + (isOvernight(f) ? 24 : 0);
  const auto = autoHours(f);
  return {
    sheet,
    calling_name: f.worker.calling_name,
    time_in: tin,
    time_out: out,
    activities: f.lines
      .map((l, i) => ({ code: l.code.trim() || null, hours: l.hours.trim() ? toNumber(l.hours) : auto[i] }))
      .filter((a, i) => a.code || f.lines[i].hours.trim()),
    additional: add === null || Number.isNaN(add) ? null : add,
    remark: f.remark.trim() || null,
    overwrite: f.overwrite,
    acknowledged: [...new Set([...f.acknowledged, ...extraAcks])],
  };
}

/** Hours for activity lines whose Hours box is left blank (index = line). The worked hours (Out - In,
 * less 1 h lunch when Out is after 12:00 or 2 h lunch and dinner after 22:00, plus additional
 * hours) minus any hours typed on other lines are shared equally between the blank lines, in
 * quarter hours (11 h over 3 lines: 3.75, 3.75, 3.5). Null for lines that get nothing. */
/** Worked hours from the form's times (lunch and dinner taken off, additional hours added). */
export function workedHours(f: FormState): number | null {
  const tin = parseClock(f.timeIn);
  const tout = parseClock(f.timeOut);
  if (tin === null || tout === null) return null;
  const add = toNumber(f.additional);
  return effectiveHours(tin, tout + (isOvernight(f) ? 24 : 0), add === null || Number.isNaN(add) ? 0 : add);
}

export function autoHours(f: FormState): (number | null)[] {
  const none = f.lines.map(() => null);
  const blank = f.lines.map((l, i) => (l.code.trim() && !l.hours.trim() ? i : -1)).filter((i) => i >= 0);
  const worked = workedHours(f);
  if (!blank.length || worked === null) return none;
  const typed = f.lines.reduce((sum, l) => sum + (l.hours.trim() ? Number(toNumber(l.hours)) || 0 : 0), 0);
  const quarters = Math.round((worked - typed) * 4);
  if (quarters < blank.length) return none; // not even a quarter hour each
  const each = Math.floor(quarters / blank.length);
  const extra = quarters - each * blank.length; // the first lines get one more quarter
  const out: (number | null)[] = [...none];
  blank.forEach((line, n) => (out[line] = (each + (n < extra ? 1 : 0)) / 4));
  return out;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Fill the form from an entry already on a sheet (edit) or from another day (copy). */
export function fromEntry(e: Entry, worker: Worker, overwrite: boolean): FormState {
  const lines = emptyLines();
  e.activities.slice(0, LINES).forEach((a, i) => {
    lines[i] = { code: str(a.code).trim(), hours: str(a.hours) };
  });
  const tin = typeof e.time_in === "number" ? e.time_in : null;
  const tout = typeof e.time_out === "number" ? e.time_out : null;
  return {
    ...emptyForm(),
    worker,
    query: worker.calling_name,
    timeIn: formatClock(tin),
    timeOut: formatClock(tout),
    overnight: tout !== null ? tout >= 24 : null,
    lines,
    additional: str(e.additional),
    remark: str(e.remark),
    overwrite,
  };
}

/** Same times and activities for another worker (crew entry, "keep" after queueing). */
export function forWorker(f: FormState, worker: Worker | null): FormState {
  return { ...f, worker, also: [], alsoTimes: {}, query: worker?.calling_name ?? "", overwrite: false, acknowledged: [] };
}

/** Back from a queued EntryInput to the form (Edit in the queue). */
export function fromInput(i: EntryInput, worker: Worker): FormState {
  const lines = emptyLines();
  i.activities.slice(0, LINES).forEach((a, n) => {
    lines[n] = { code: a.code ?? "", hours: a.hours === null ? "" : String(a.hours) };
  });
  return {
    ...emptyForm(),
    worker,
    query: worker.calling_name,
    timeIn: formatClock(i.time_in),
    timeOut: formatClock(i.time_out),
    overnight: i.time_out !== null ? i.time_out >= 24 : null,
    lines,
    additional: i.additional === null ? "" : String(i.additional),
    remark: i.remark ?? "",
    overwrite: i.overwrite,
    also: [],
    alsoTimes: {},
    acknowledged: i.acknowledged.filter((r) => r !== "H01" && r !== "H02"),
  };
}

export const clearInput = (sheet: string, callingName: string): EntryInput => ({
  sheet,
  calling_name: callingName,
  time_in: null,
  time_out: null,
  activities: [],
  additional: null,
  remark: null,
  overwrite: true,
  acknowledged: [],
});

/** Several workers typed at once ("INB-01, INB-02; INC-05"): each name exactly, or the only
 * calling name that starts with it. Names that match nothing (or several) are returned as missing. */
export function resolveNames(workers: Worker[], text: string): { found: Worker[]; missing: string[] } {
  const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/[\s-]/g, "");
  const found: Worker[] = [];
  const missing: string[] = [];
  for (const token of text.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean)) {
    const q = norm(token);
    const exact = workers.find((w) => norm(w.calling_name) === q);
    const starts = workers.filter((w) => norm(w.calling_name).startsWith(q));
    const w = exact ?? (starts.length === 1 ? starts[0] : undefined);
    if (!w) missing.push(token);
    else if (!found.includes(w)) found.push(w);
  }
  return { found, missing };
}

/** The entry for the main worker plus the same entry for each extra worker. */
export function inputsFor(f: FormState, input: EntryInput, sheet: string, extraAcks: string[] = []): EntryInput[] {
  return [
    input,
    ...f.also.map((w) => {
      const own = f.alsoTimes[w.calling_name];
      // Own times: the entry is built again from them, with the hours following this worker's
      // own day (ownTimesForm).
      const base = own ? toInput(ownTimesForm(f, own), sheet, extraAcks) ?? input : input;
      return { ...base, calling_name: w.calling_name, overwrite: false };
    }),
  ];
}

/** The form for an "also for" worker with own times: same activities, hours fitted to their day.
 * Blank hours already follow the times. Typed hours that fill the main worker's whole day are
 * shared out again in the same proportions over the other worker's day, in quarter hours (one
 * activity: 7-19 = 11 h becomes 7-21 = 13 h). Typed hours that don't fill the day stay as typed. */
export function ownTimesForm(f: FormState, own: OwnTimes): FormState {
  const g: FormState = { ...f, timeIn: own.timeIn, timeOut: own.timeOut, overnight: null };
  const mainDay = workedHours(f);
  const ownDay = workedHours(g);
  const coded = f.lines.map((l, i) => (l.code.trim() ? i : -1)).filter((i) => i >= 0);
  const typed = coded.map((i) => toNumber(f.lines[i].hours));
  if (mainDay === null || ownDay === null || ownDay <= 0 || !coded.length) return g;
  if (typed.some((h) => h === null || Number.isNaN(h))) return g; // some blank: they follow the times
  const sum = (typed as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - mainDay) > 1e-6) return g; // not the whole day: keep as typed
  const quarters = Math.round(ownDay * 4);
  const share = (typed as number[]).map((h) => Math.round(((h / sum) * quarters)));
  share[share.length - 1] += quarters - share.reduce((a, b) => a + b, 0); // rounding to the last line
  if (share.some((q) => q <= 0)) return g;
  const lines = f.lines.map((l) => ({ ...l }));
  coded.forEach((i, n) => (lines[i].hours = String(share[n] / 4)));
  return { ...g, lines };
}

/** New times; activity hours that added up to the old worked hours are scaled to the new ones
 * (quarter hours, the last line takes the rest), as the entry form does. */
export function withTimes(input: EntryInput, tin: number | null, tout: number | null): EntryInput {
  let activities = input.activities;
  const coded = activities.filter((a) => a.code && a.hours !== null);
  if (input.time_in !== null && input.time_out !== null && tin !== null && tout !== null && coded.length) {
    const before = effectiveHours(input.time_in, input.time_out, input.additional ?? 0);
    const after = effectiveHours(tin, tout, input.additional ?? 0);
    const total = coded.reduce((sum, a) => sum + (a.hours ?? 0), 0);
    if (before > 0 && after > 0 && Math.abs(total - before) < 1e-9) {
      let left = after;
      const last = activities.lastIndexOf(coded[coded.length - 1]);
      activities = activities.map((a, i) => {
        if (!a.code || a.hours === null) return a;
        const hours = i === last ? left : Math.round(((a.hours * after) / before) * 4) / 4;
        left -= hours;
        return { ...a, hours };
      });
    }
  }
  return { ...input, time_in: tin, time_out: tout, activities };
}
