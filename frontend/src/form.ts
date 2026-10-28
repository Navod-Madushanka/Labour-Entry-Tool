// The entry form's state and its conversion to the API's EntryInput.
import type { Entry, EntryInput, Worker } from "./api";
import { effectiveHours, formatClock, parseClock } from "./time";

export const LINES = 5;

export interface Line {
  code: string;
  hours: string;
}

export interface FormState {
  worker: Worker | null;
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
  if (f.timeIn.trim() && parseClock(f.timeIn) === null) p.timeIn = "Use HH:MM, e.g. 07:00";
  if (f.timeOut.trim() && parseClock(f.timeOut) === null) p.timeOut = "Use HH:MM, e.g. 19:00";
  f.lines.forEach((l, i) => {
    const h = toNumber(l.hours);
    if (h !== null && (Number.isNaN(h) || h <= 0)) p.lines[i] = "Hours must be a number > 0";
  });
  if (Number.isNaN(toNumber(f.additional) as number)) p.additional = "Must be a number";
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
export function autoHours(f: FormState): (number | null)[] {
  const none = f.lines.map(() => null);
  const blank = f.lines.map((l, i) => (l.code.trim() && !l.hours.trim() ? i : -1)).filter((i) => i >= 0);
  const tin = parseClock(f.timeIn);
  const tout = parseClock(f.timeOut);
  if (!blank.length || tin === null || tout === null) return none;
  const add = toNumber(f.additional);
  const worked = effectiveHours(tin, tout + (isOvernight(f) ? 24 : 0), add === null || Number.isNaN(add) ? 0 : add);
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
  return { ...f, worker, query: worker?.calling_name ?? "", overwrite: false, acknowledged: [] };
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
