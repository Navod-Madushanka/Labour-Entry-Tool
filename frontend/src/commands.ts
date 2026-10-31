// Commands: change many entries at once by typing, e.g. "set out 20 for INB-01 on 1-10" or
// "copy INB-01, INB-02 from 26 to 21". A small language in the words of the job (workers, days,
// In/Out, codes), with many synonyms ("insert" = ADD). A command never writes anything: it only
// produces ordinary entries for the queue, which go through the usual checks, the manpower sheet
// and Push (one undoable batch). No AI: a strict parser that says what it did not understand.
import type { ActivityInput, EntryInput, Worker } from "./api";
import { clearInput, withTimes } from "./form";
import type { Month } from "./history";
import { effectiveHours, fmtHours, formatClock, formatShift, parseClock } from "./time";

// --- vocabulary ----------------------------------------------------------------------------------

export type Verb = "SET" | "SHIFT" | "ADD" | "COPY" | "FILL" | "MOVE" | "SWAP" | "CLEAR" | "REPLACE" | "ROUND" | "SHOW";
export type Field = "in" | "out" | "times" | "code" | "hours" | "additional" | "remark" | "worked";

export interface WordInfo {
  name: string; // the canonical word, as shown on the card: ADD, FOR, OUT…
  kind: "command" | "keyword" | "field" | "workers" | "days" | "operator";
  text: string; // what it does, in one or two sentences
  syntax?: string;
  examples?: string[];
  synonyms: string[];
}

const VERB_INFO: Record<Verb, Omit<WordInfo, "name" | "kind">> = {
  SET: {
    text: "Changes entries that are already there: In, Out, code, hours, additional hours or remark. Hours follow new times.",
    syntax: "set <field> <value> [<field> <value>…] for <workers> on <days> [where …]",
    examples: ["set out 20 for INB-01 on 1-10", "set in 7 out 19 for INB on 3 where out = 18", "set remark \"rain\" for all on 14"],
    synonyms: ["change", "update", "edit", "make", "modify", "put", "assign", "alter"],
  },
  SHIFT: {
    text: "Moves times earlier (-) or later (+) by an amount: hours, minutes (30m) or h:mm. Hours follow the times.",
    syntax: "shift <in|out|times> <+/-amount> for <workers> on <days>",
    examples: ["shift out +1 for INB-01 on 1-10", "shift times -30m for INC on 5", "shift in by 0.5 for crew of INB-03 on 12"],
    synonyms: ["offset", "nudge", "adjust", "delay", "advance", "slide"],
  },
  ADD: {
    text: "Creates new entries: the workers on the days with the times (and code). One code gets all the worked hours; several share them.",
    syntax: "add <workers> on <days> in <time> out <time> [code <code>[, <code>]] [hours <h>] [additional <h>] [remark \"…\"]",
    examples: ["add INB-01, INB-02 on 21 in 7 out 19 code 03-11-00-00-P", "add INB-01..INB-05 on 1-5 in 7 out 16 code 03-20-00-00"],
    synonyms: ["insert", "create", "new", "enter", "record", "log", "append"],
  },
  COPY: {
    text: "Copies the workers' entries from one day to other days. The source stays as it is.",
    syntax: "copy <workers> from <day> to <days> [overwrite]",
    examples: ["copy INB-01, INB-02, INB-05, INB-06 from 26 to 21", "copy crew of INB-03 from 10 to 11-15"],
    synonyms: ["duplicate", "clone", "replicate", "dup", "cp"],
  },
  FILL: {
    text: "Like COPY, but only into days where the worker has no entry yet: nothing is replaced.",
    syntax: "fill <workers> from <day> to <days>",
    examples: ["fill INB-01 from 1 to 2-6", "fill all from 20 to 21-24"],
    synonyms: ["repeat", "carry", "extend", "propagate", "spread"],
  },
  MOVE: {
    text: "Moves the workers' entries from one day to another: copied there, cleared from the source.",
    syntax: "move <workers> from <day> to <day> [overwrite]",
    examples: ["move INB-01, INB-02 from 26 to 21", "move all from 8 to 9"],
    synonyms: ["transfer", "relocate", "cut", "mv", "migrate"],
  },
  SWAP: {
    text: "Exchanges the workers' entries between two days.",
    syntax: "swap <workers> between <day> and <day>",
    examples: ["swap INB-01 between 3 and 4", "swap all on 10 and 11"],
    synonyms: ["exchange", "switch", "flip", "trade"],
  },
  CLEAR: {
    text: "Empties the workers' entries on the days (times, codes, hours, remark). Entries only waiting in the queue are just dropped.",
    syntax: "clear <workers> on <days> [where …]",
    examples: ["clear INB-03 on 15, 16", "clear all on 25 where code = 00-00-10-00"],
    synonyms: ["delete", "remove", "erase", "wipe", "blank", "del", "rm", "drop"],
  },
  REPLACE: {
    text: "Replaces one value with another wherever it appears: an activity code (the default), In or Out.",
    syntax: "replace [code|in|out] <old> with <new> for <workers> on <days>",
    examples: ["replace 03-11-00-00 with 03-11-00-00-P for all on 1-31", "replace out 18 with 19 for INB on 1-15"],
    synonyms: ["substitute", "rename", "sub", "swapcode"],
  },
  ROUND: {
    text: "Rounds In and Out to the nearest 15 minutes (the grid Excel expects).",
    syntax: "round [in|out|times] for <workers> on <days>",
    examples: ["round times for all on 1-31"],
    synonyms: ["snap", "tidy", "quarter"],
  },
  SHOW: {
    text: "Lists the matching entries with totals, without changing anything.",
    syntax: "show [<workers>] [on <days>] [where …]",
    examples: ["show INB-01 on 1-31", "show all on 12 where out > 19", "count all on 1-31 where code like 03-20*"],
    synonyms: ["find", "list", "select", "query", "get", "view", "search", "display", "count", "total", "sum", "look"],
  },
};

const KEYWORDS: Record<string, Omit<WordInfo, "name" | "kind"> & { name: string }> = {
  FOR: { name: "FOR", text: "Starts the list of workers: names, ranges, a prefix, all, crew of …, trade ….", synonyms: ["for", "of", "workers", "worker", "labour", "labor", "who", "employees", "people"] },
  ON: { name: "ON", text: "Starts the list of days (sheet numbers): 3, 1-10, 1..10, all, weekdays, saturdays, sundays, holidays, today, yesterday.", synonyms: ["on", "day", "days", "date", "dates", "sheet", "sheets", "at"] },
  FROM: { name: "FROM", text: "The day to take entries from (COPY, FILL, MOVE). With other commands, FROM a TO b is a range of days.", synonyms: ["from", "source"] },
  TO: { name: "TO", text: "The day(s) to put entries on (COPY, FILL, MOVE), or the end of a range (1 to 10, INB-01 to INB-20).", synonyms: ["to", "into", "onto", "until", "till", "through", "thru"] },
  WHERE: { name: "WHERE", text: "Only entries that match: field, operator, value. Join with AND. E.g. where out = 19 and code like 03-11*.", synonyms: ["where", "if", "when", "whose", "having"] },
  EXCEPT: { name: "EXCEPT", text: "Leaves these workers out of the selection.", synonyms: ["except", "excluding", "exclude", "but", "without", "minus", "not"] },
  BY: { name: "BY", text: "The amount for SHIFT (optional word): shift out by 1.", synonyms: ["by"] },
  WITH: { name: "WITH", text: "The new value for REPLACE: replace <old> with <new>.", synonyms: ["with"] },
  AND: { name: "AND", text: "Joins items: two conditions after WHERE, or the two days of SWAP.", synonyms: ["and", "&"] },
  BETWEEN: { name: "BETWEEN", text: "The two days for SWAP: between 3 and 4.", synonyms: ["between"] },
  OVERWRITE: { name: "OVERWRITE", text: "COPY/MOVE/ADD may replace entries already in Excel on the target days without asking each one again.", synonyms: ["overwrite", "force", "replace-existing"] },
  ALL: { name: "ALL", text: "As workers: everyone with an entry on those days (everyone in Labour Detail for ADD). As days: every day sheet.", synonyms: ["all", "everyone", "everybody", "each", "every", "*"] },
  CREW: { name: "CREW OF", text: "The worker and their usual partners (same entry on the last 10 days): crew of INB-03.", synonyms: ["crew", "gang", "team"] },
  TRADE: { name: "TRADE", text: "Every worker of a trade group from Labour Detail: trade Carpenter.", synonyms: ["trade", "group", "designation"] },
};

const FIELDS: Record<Field, Omit<WordInfo, "name" | "kind">> = {
  in: { text: "Time In: 7, 7.30, 07:30 or 0730.", synonyms: ["in", "start", "timein", "time-in", "begin", "arrival"] },
  out: { text: "Time Out. Earlier than In = the next morning (written past 24, as Excel needs).", synonyms: ["out", "end", "timeout", "time-out", "finish", "leave", "departure"] },
  times: { text: "Both In and Out (SHIFT, ROUND).", synonyms: ["times", "time", "both", "shift-times"] },
  code: { text: "Activity code (one line; for ADD, several separated by commas share the hours).", synonyms: ["code", "codes", "activity", "activities", "act", "wbs"] },
  hours: { text: "Hours on the activity line (one line only). Without it, the worked hours are used.", synonyms: ["hours", "hrs", "h", "hour"] },
  additional: { text: "Additional hours (e.g. -1 when dinner was taken).", synonyms: ["additional", "extra", "add-hours", "addl", "plus"] },
  remark: { text: "Remark text, in quotes for several words: remark \"rain stop\".", synonyms: ["remark", "remarks", "note", "notes", "comment"] },
  worked: { text: "Worked (effective) hours, after the lunch and dinner deductions. For WHERE and SHOW.", synonyms: ["worked", "effective", "total"] },
};

const OPERATORS: Record<string, { name: string; text: string }> = {
  "=": { name: "=", text: "equals (also: is, ==)" },
  "!=": { name: "!=", text: "is not (also: <>, isnt)" },
  "<": { name: "<", text: "less than" },
  ">": { name: ">", text: "more than" },
  "<=": { name: "<=", text: "at most" },
  ">=": { name: ">=", text: "at least" },
  like: { name: "LIKE", text: "matches with * as a wildcard: code like 03-11*" },
  contains: { name: "CONTAINS", text: "has this text in it" },
  empty: { name: "EMPTY", text: "has no value: where remark empty" },
};
const OP_SYNONYMS: Record<string, string> = { "==": "=", is: "=", equals: "=", eq: "=", "<>": "!=", isnt: "!=", ne: "!=", lt: "<", gt: ">", le: "<=", ge: ">=", matches: "like", has: "contains", blank: "empty", none: "empty" };

const lookup = new Map<string, { kind: WordInfo["kind"]; key: string }>();
for (const v of Object.keys(VERB_INFO) as Verb[]) {
  lookup.set(v.toLowerCase(), { kind: "command", key: v });
  for (const s of VERB_INFO[v].synonyms) lookup.set(s, { kind: "command", key: v });
}
for (const [k, info] of Object.entries(KEYWORDS)) for (const s of info.synonyms) if (!lookup.has(s)) lookup.set(s, { kind: "keyword", key: k });
for (const [k, info] of Object.entries(FIELDS)) for (const s of info.synonyms) if (!lookup.has(s)) lookup.set(s, { kind: "field", key: k });

const keywordOf = (t: string | undefined) => (t ? (lookup.get(t.toLowerCase())?.kind === "keyword" ? lookup.get(t.toLowerCase())!.key : null) : null);
const fieldOf = (t: string | undefined): Field | null => {
  if (!t) return null;
  const hit = lookup.get(t.toLowerCase());
  return hit?.kind === "field" ? (hit.key as Field) : FIELDS[t.toLowerCase() as Field] ? (t.toLowerCase() as Field) : null;
};
const verbOf = (t: string | undefined): Verb | null => (t ? (lookup.get(t.toLowerCase())?.kind === "command" ? (lookup.get(t.toLowerCase())!.key as Verb) : null) : null);

/** Every verb with its card, for the help list. */
export const ALL_VERBS: WordInfo[] = (Object.keys(VERB_INFO) as Verb[]).map((v) => ({ name: v, kind: "command", ...VERB_INFO[v] }));

// --- tokens --------------------------------------------------------------------------------------

export interface Token {
  text: string;
  start: number;
  end: number;
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /"[^"]*"?|'[^']*'?|<=|>=|!=|<>|==|[=<>,;&]|[^\s,;=<>!&]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

const unquote = (t: string) => (/^["']/.test(t) ? t.replace(/^["']|["']$/g, "") : t);

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** The closest known word to a typo ("outt" -> "out"), if close enough. */
export function didYouMean(word: string, pool: Iterable<string> = lookup.keys()): string | null {
  const w = word.toLowerCase();
  let best: string | null = null;
  let score = 3;
  for (const cand of pool) {
    const d = editDistance(w, cand.toLowerCase());
    if (d < score && d <= Math.max(1, Math.floor(cand.length / 3))) [best, score] = [cand, d];
  }
  return best;
}

// --- context: the month as the tool sees it ----------------------------------------------------

export interface CommandContext {
  workers: Worker[];
  month: Month; // sheet -> day, as loaded
  sheets: string[]; // the workbook's day sheets
  monthIso: string; // "2026-10"
  queued: EntryInput[]; // entries waiting in the queue (they count as the current state)
  withActivities: boolean;
  activities: string[];
  partners?: (name: string) => string[]; // usual partners, for "crew of"
  today?: Date;
}

interface Current {
  input: EntryInput;
  source: "excel" | "queue";
  inExcel: boolean; // the block has input in Excel (overwrite needed to replace it)
}

const num = (v: unknown) => (typeof v === "number" ? v : null);

function current(ctx: CommandContext, name: string, sheet: string): Current | null {
  const excel = ctx.month[sheet]?.entries.find((v) => v.entry.calling_name === name)?.entry;
  const queued = ctx.queued.find((q) => q.sheet === sheet && q.calling_name === name);
  if (queued) {
    const cleared = queued.time_in === null && queued.time_out === null && !queued.activities.length;
    return cleared ? null : { input: queued, source: "queue", inExcel: Boolean(excel) };
  }
  if (!excel) return null;
  return {
    source: "excel",
    inExcel: true,
    input: {
      sheet,
      calling_name: name,
      time_in: num(excel.time_in),
      time_out: num(excel.time_out),
      activities: excel.activities
        .filter((a) => (typeof a.code === "string" && a.code.trim()) || typeof a.hours === "number")
        .map((a) => ({ code: typeof a.code === "string" ? a.code.trim() : null, hours: num(a.hours) })),
      additional: num(excel.additional),
      remark: typeof excel.remark === "string" ? excel.remark : excel.remark === null || excel.remark === undefined ? null : String(excel.remark),
      overwrite: true,
      acknowledged: [],
    },
  };
}

const dateOf = (ctx: CommandContext, sheet: string): Date | null => {
  const iso = ctx.month[sheet]?.header.date;
  if (iso) return new Date(`${iso}T00:00:00`);
  const [y, m] = ctx.monthIso.split("-").map(Number);
  const d = new Date(y, m - 1, Number(sheet));
  return d.getMonth() === m - 1 ? d : null;
};

// --- parsing -------------------------------------------------------------------------------------

export interface Cond {
  field: Field;
  op: string;
  value: string | number | null;
}

export interface Command {
  verb: Verb;
  workers: string[] | null; // resolved calling names; null = not given
  workersAll: boolean;
  exclude: string[]; // EXCEPT
  days: string[] | null;
  from: string | null;
  to: string[] | null;
  fields: { in?: number; out?: number; code?: string[]; hours?: number; additional?: number; remark?: string };
  target: Field | null; // SHIFT / ROUND / REPLACE: which field
  amount: number | null; // SHIFT
  replace: { old: string | number; new: string | number } | null;
  conds: Cond[];
  overwrite: boolean;
}

export class CommandError extends Error {
  constructor(message: string, public at?: Token) {
    super(message);
  }
}

function parseAmount(t: string): number | null {
  const s = t.trim().toLowerCase();
  let m = s.match(/^([+-]?)(\d+(?:\.\d+)?)\s*(m|min|mins|minutes)$/);
  if (m) return (m[1] === "-" ? -1 : 1) * Number(m[2]) / 60;
  m = s.match(/^([+-]?)(\d+):(\d{2})$/);
  if (m) return (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60);
  m = s.match(/^([+-]?)(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?)?$/);
  if (m) return (m[1] === "-" ? -1 : 1) * Number(m[2]);
  return null;
}

const timeOf = (t: string): number | null => parseClock(unquote(t));

function daysOf(ctx: CommandContext, tokens: Token[]): string[] {
  const out: string[] = [];
  const add = (s: string) => ctx.sheets.includes(s) && !out.includes(s) && out.push(s);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i].text.toLowerCase();
    if (raw === "," || raw === "and" || raw === "&") continue;
    const next = tokens[i + 2];
    if (/^\d+$/.test(raw) && tokens[i + 1] && ["to", "till", "until", "through", "thru", "-"].includes(tokens[i + 1].text.toLowerCase()) && next && /^\d+$/.test(next.text)) {
      for (let d = Number(raw); d <= Number(next.text); d++) add(String(d));
      i += 2;
      continue;
    }
    let m = raw.match(/^(\d+)(?:-|\.\.)(\d+)$/);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
      for (let d = a; d <= b; d++) add(String(d));
      continue;
    }
    if (/^\d+$/.test(raw)) {
      if (!ctx.sheets.includes(raw)) throw new CommandError(`There is no sheet ${raw} in this workbook.`, tokens[i]);
      add(raw);
      continue;
    }
    const kind = (d: Date | null) => (d ? d.getDay() : -1);
    const words: Record<string, (s: string) => boolean> = {
      all: () => true, every: () => true, everyday: () => true, month: () => true,
      weekdays: (s) => ![0, 6].includes(kind(dateOf(ctx, s))), weekday: (s) => ![0, 6].includes(kind(dateOf(ctx, s))),
      saturdays: (s) => kind(dateOf(ctx, s)) === 6, saturday: (s) => kind(dateOf(ctx, s)) === 6, sat: (s) => kind(dateOf(ctx, s)) === 6,
      sundays: (s) => kind(dateOf(ctx, s)) === 0, sunday: (s) => kind(dateOf(ctx, s)) === 0, sun: (s) => kind(dateOf(ctx, s)) === 0,
      weekends: (s) => [0, 6].includes(kind(dateOf(ctx, s))), weekend: (s) => [0, 6].includes(kind(dateOf(ctx, s))),
      holidays: (s) => String(ctx.month[s]?.header.day_type ?? "").trim().toLowerCase() === "holiday",
      holiday: (s) => String(ctx.month[s]?.header.day_type ?? "").trim().toLowerCase() === "holiday",
    };
    if (words[raw]) {
      ctx.sheets.filter(words[raw]).forEach(add);
      continue;
    }
    if (["today", "yesterday", "tomorrow"].includes(raw)) {
      const t = new Date(ctx.today ?? new Date());
      t.setDate(t.getDate() + (raw === "yesterday" ? -1 : raw === "tomorrow" ? 1 : 0));
      const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
      if (iso !== ctx.monthIso) throw new CommandError(`${raw} is not in this workbook's month.`, tokens[i]);
      add(String(t.getDate()));
      continue;
    }
    const hint = didYouMean(raw, Object.keys(words).concat(["today", "yesterday"]));
    throw new CommandError(`"${tokens[i].text}" is not a day${hint ? `. Did you mean "${hint}"?` : ": use sheet numbers like 3, 1-10, or all, weekdays, saturdays."}`, tokens[i]);
  }
  return out;
}

function workersOf(ctx: CommandContext, tokens: Token[]): { names: string[]; all: boolean } {
  const byKey = new Map(ctx.workers.map((w) => [w.calling_name.toUpperCase(), w.calling_name]));
  const out: string[] = [];
  let all = false;
  const add = (n: string) => !out.includes(n) && out.push(n);
  const numbered = (n: string) => n.toUpperCase().match(/^(.*?)(\d+)$/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].text;
    const low = t.toLowerCase();
    if (low === "," || low === "and" || low === "&") continue;
    if (["all", "everyone", "everybody", "each", "every", "*"].includes(low)) {
      all = true;
      continue;
    }
    if (["crew", "gang", "team"].includes(low)) {
      const j = tokens[i + 1]?.text.toLowerCase() === "of" ? i + 2 : i + 1;
      const who = byKey.get((tokens[j]?.text ?? "").toUpperCase());
      if (!who) throw new CommandError(`"crew of" needs a worker after it, e.g. crew of INB-03.`, tokens[i]);
      add(who);
      (ctx.partners?.(who) ?? []).forEach(add);
      i = j;
      continue;
    }
    if (["trade", "group", "designation"].includes(low)) {
      const trade = unquote(tokens[i + 1]?.text ?? "").toLowerCase();
      const hits = ctx.workers.filter((w) => String(w.trade_group ?? "").trim().toLowerCase() === trade);
      if (!hits.length) throw new CommandError(`No worker has the trade group "${tokens[i + 1]?.text ?? ""}".`, tokens[i]);
      hits.forEach((w) => add(w.calling_name));
      i += 1;
      continue;
    }
    // a name with a space ("INB-01 CH")
    const two = tokens[i + 1] ? `${t} ${tokens[i + 1].text}`.toUpperCase() : "";
    if (two && byKey.has(two)) {
      add(byKey.get(two)!);
      i += 1;
      continue;
    }
    // ranges: INB-01..INB-20, INB-01 to INB-20
    let a = t, b: string | null = null;
    const dots = t.split("..");
    if (dots.length === 2) [a, b] = dots;
    else if (["to", "till", "until", "through", "thru"].includes(tokens[i + 1]?.text.toLowerCase() ?? "") && tokens[i + 2] && byKey.has(t.toUpperCase())) {
      b = tokens[i + 2].text;
      i += 2;
    }
    if (b !== null) {
      const ma = numbered(a), mb = numbered(b);
      if (!ma || !mb || (mb[1] && mb[1] !== ma[1])) throw new CommandError(`"${a} to ${b}" is not a range of calling names.`, tokens[i]);
      const [lo, hi] = [Number(ma[2]), Number(mb[2])].sort((x, y) => x - y);
      const hits = ctx.workers
        .map((w) => ({ w, m: numbered(w.calling_name) }))
        .filter(({ m }) => m && m[1] === ma[1] && Number(m[2]) >= lo && Number(m[2]) <= hi)
        .sort((x, y) => Number(x.m![2]) - Number(y.m![2]));
      if (!hits.length) throw new CommandError(`No worker from ${a} to ${b}.`, tokens[i]);
      hits.forEach(({ w }) => add(w.calling_name));
      continue;
    }
    const exact = byKey.get(t.toUpperCase());
    if (exact) {
      add(exact);
      continue;
    }
    // a prefix: INB or INB* -> every INB-.. worker
    const prefix = t.replace(/\*$/, "").toUpperCase();
    const prefixed = ctx.workers.filter((w) => w.calling_name.toUpperCase().startsWith(prefix.endsWith("-") ? prefix : `${prefix}-`));
    if (/^[A-Za-z]+[-*]?$/.test(t) && prefixed.length) {
      prefixed.forEach((w) => add(w.calling_name));
      continue;
    }
    const hint = didYouMean(t, ctx.workers.map((w) => w.calling_name));
    throw new CommandError(`"${t}" is not a worker in Labour Detail${hint ? `. Did you mean ${hint}?` : "."}`, tokens[i]);
  }
  return { names: out, all };
}

const VALUE_FIELDS: Field[] = ["in", "out", "code", "hours", "additional", "remark"];

/** Read a command. Throws CommandError with the token it stopped at. */
export function parse(src: string, ctx: CommandContext): Command {
  const tokens = tokenize(src);
  if (!tokens.length) throw new CommandError("Type a command, e.g. set out 20 for INB-01 on 1-10.");
  const verb = verbOf(tokens[0].text);
  if (!verb) {
    const hint = didYouMean(tokens[0].text, [...lookup.entries()].filter(([, v]) => v.kind === "command").map(([k]) => k));
    throw new CommandError(`"${tokens[0].text}" is not a command${hint ? `. Did you mean "${hint}" (${verbOf(hint)})?` : ". Start with set, add, copy, move, clear, show…"}`, tokens[0]);
  }
  const cmd: Command = { verb, workers: null, workersAll: false, exclude: [], days: null, from: null, to: null, fields: {}, target: null, amount: null, replace: null, conds: [], overwrite: false };
  const transfer = verb === "COPY" || verb === "FILL" || verb === "MOVE";
  type Mode = "workers" | "days" | "from" | "to" | "except" | "where";
  let mode: Mode = "workers"; // words right after the verb are workers (copy INB-01 from …)
  const buckets: Record<"workers" | "days" | "from" | "to" | "except", Token[]> = { workers: [], days: [], from: [], to: [], except: [] };
  let i = 1;

  // SHIFT / ROUND / REPLACE: an optional field first; SHIFT then the amount
  if (verb === "SHIFT" || verb === "ROUND" || verb === "REPLACE") {
    const f = fieldOf(tokens[i]?.text);
    if (f) {
      cmd.target = f;
      i++;
    } else cmd.target = verb === "REPLACE" ? "code" : "times";
    if (verb === "SHIFT") {
      if (keywordOf(tokens[i]?.text) === "BY") i++;
      const amt = tokens[i] ? parseAmount(tokens[i].text) : null;
      if (amt === null) throw new CommandError(`SHIFT needs an amount after "${cmd.target}", e.g. +1, -0.5, +30m.`, tokens[i] ?? tokens[i - 1]);
      cmd.amount = amt;
      i++;
    }
    if (verb === "REPLACE") {
      const old = tokens[i];
      const w = tokens[i + 1];
      const nw = tokens[i + 2];
      if (!old || keywordOf(w?.text) !== "WITH" || !nw) throw new CommandError("REPLACE needs: replace <old> with <new>, e.g. replace 03-11-00-00 with 03-11-00-00-P.", old ?? tokens[0]);
      const val = (t: Token) => (cmd.target === "in" || cmd.target === "out" ? timeOf(t.text) : unquote(t.text).toUpperCase());
      const [o, n] = [val(old), val(nw)];
      if (o === null || n === null) throw new CommandError(`"${old.text}" or "${nw.text}" is not a time.`, old);
      cmd.replace = { old: o, new: n };
      i += 3;
    }
  }

  for (; i < tokens.length; i++) {
    const tok = tokens[i];
    const low = tok.text.toLowerCase();
    const kw = keywordOf(low);
    const field = fieldOf(low);

    if (mode === "where") {
      if (kw === "AND" || low === ",") continue;
      if (!field) throw new CommandError(`After WHERE comes a field (in, out, code, hours, worked, remark…), not "${tok.text}".`, tok);
      let op = (tokens[i + 1]?.text ?? "").toLowerCase();
      op = OP_SYNONYMS[op] ?? op;
      if (op === "not" && ["empty", "blank"].includes((tokens[i + 2]?.text ?? "").toLowerCase())) {
        cmd.conds.push({ field, op: "notempty", value: null });
        i += 2;
        continue;
      }
      if (op === "empty") {
        cmd.conds.push({ field, op: "empty", value: null });
        i += 1;
        continue;
      }
      if (!OPERATORS[op]) throw new CommandError(`"${tokens[i + 1]?.text ?? ""}" is not an operator: use =, !=, <, >, <=, >=, like, contains, empty.`, tokens[i + 1] ?? tok);
      const vt = tokens[i + 2];
      if (!vt) throw new CommandError(`WHERE ${field} ${op} needs a value.`, tokens[i + 1]);
      let value: string | number | null;
      if (field === "in" || field === "out") value = timeOf(vt.text);
      else if (field === "hours" || field === "additional" || field === "worked") value = Number(vt.text);
      else value = unquote(vt.text).toUpperCase();
      if (value === null || (typeof value === "number" && Number.isNaN(value))) throw new CommandError(`"${vt.text}" is not a value for ${field}.`, vt);
      cmd.conds.push({ field, op, value });
      i += 2;
      continue;
    }

    if (kw === "FOR") { mode = "workers"; continue; }
    if (kw === "ON") { mode = transfer && cmd.from === null && !buckets.from.length ? "from" : "days"; continue; }
    if (kw === "FROM") { mode = transfer ? "from" : "days"; continue; }
    if (kw === "TO") {
      const byKey = (t?: Token) => Boolean(t && ctx.workers.some((w) => w.calling_name.toUpperCase() === t.text.toUpperCase()));
      if (mode === "workers" && byKey(tokens[i + 1])) { buckets.workers.push(tok); continue; } // INB-01 to INB-20
      if (transfer) { mode = "to"; continue; } // copy … from 26 TO 21
      if (mode === "days") { buckets.days.push(tok); continue; } // from 1 to 10 = days 1-10
    }
    if (kw === "WHERE") { mode = "where"; continue; }
    if (kw === "EXCEPT") { mode = "except"; continue; }
    if (kw === "OVERWRITE") { cmd.overwrite = true; continue; }
    if (kw === "BETWEEN") { mode = "days"; continue; }
    if (field && (verb === "SET" || verb === "ADD") && VALUE_FIELDS.includes(field)) {
      // field value
      if (field === "in" || field === "out") {
        const v = tokens[i + 1] ? timeOf(tokens[i + 1].text) : null;
        if (v === null) throw new CommandError(`"${tokens[i + 1]?.text ?? ""}" is not a time for ${field.toUpperCase()}: use 7, 7.30, 19:00.`, tokens[i + 1] ?? tok);
        cmd.fields[field] = v;
        i += 1;
      } else if (field === "code") {
        const codes: string[] = [];
        while (tokens[i + 1] && (tokens[i + 1].text === "," || (!keywordOf(tokens[i + 1].text) && !fieldOf(tokens[i + 1].text)))) {
          i += 1;
          if (tokens[i].text !== ",") codes.push(unquote(tokens[i].text).trim().toUpperCase());
        }
        if (!codes.length) throw new CommandError("CODE needs an activity code after it.", tok);
        const unknown = codes.filter((c) => !ctx.activities.some((a) => a.toUpperCase() === c));
        if (unknown.length && ctx.withActivities) throw new CommandError(`${unknown.join(", ")} is not in the activity list${didYouMean(unknown[0], ctx.activities) ? `. Did you mean ${didYouMean(unknown[0], ctx.activities)}?` : "."}`, tok);
        cmd.fields.code = codes;
      } else if (field === "remark") {
        const parts: string[] = [];
        while (tokens[i + 1] && !keywordOf(tokens[i + 1].text) && !(fieldOf(tokens[i + 1].text) && parts.length)) {
          i += 1;
          parts.push(unquote(tokens[i].text));
        }
        cmd.fields.remark = parts.join(" ");
      } else {
        const v = tokens[i + 1] ? Number(unquote(tokens[i + 1].text)) : NaN;
        if (Number.isNaN(v)) throw new CommandError(`"${tokens[i + 1]?.text ?? ""}" is not a number for ${field.toUpperCase()}.`, tokens[i + 1] ?? tok);
        cmd.fields[field as "hours" | "additional"] = v;
        i += 1;
      }
      continue;
    }
    if (mode === "workers" && (/^\d+(?:-\d+)?$/.test(low) && !ctx.workers.some((w) => w.calling_name === tok.text))) {
      // a bare day number where workers were expected: "swap INB-01 3 and 4", "copy INB-01 26 to 21"
      if (transfer && !buckets.from.length) { buckets.from.push(tok); mode = "from"; continue; }
      mode = "days";
    }
    if (mode === "from" && buckets.from.length && kw !== "TO") {
      // copy … from 26 21 -> second number starts the targets only with TO
      throw new CommandError(`After FROM ${buckets.from[0].text} comes TO, e.g. from 26 to 21.`, tok);
    }
    buckets[mode as keyof typeof buckets].push(tok);
  }

  if (buckets.workers.length) {
    const w = workersOf(ctx, buckets.workers);
    cmd.workers = w.names;
    cmd.workersAll = w.all;
  }
  if (buckets.except.length) {
    cmd.exclude = workersOf(ctx, buckets.except).names;
    cmd.workers = (cmd.workers ?? []).filter((n) => !cmd.exclude.includes(n));
  }
  if (buckets.days.length) cmd.days = daysOf(ctx, buckets.days);
  if (buckets.from.length) {
    const f = daysOf(ctx, buckets.from);
    if (f.length !== 1) throw new CommandError("FROM takes one day.", buckets.from[0]);
    cmd.from = f[0];
  }
  if (buckets.to.length) cmd.to = daysOf(ctx, buckets.to);
  return cmd;
}

// --- running -------------------------------------------------------------------------------------

export interface ShowRow {
  sheet: string;
  name: string;
  times: string;
  codes: string;
  hours: number;
  worked: number | null;
  source: "Excel" | "queue";
}

export interface CommandResult {
  verb: Verb;
  inputs: EntryInput[]; // for the queue
  removeQueued: { sheet: string; name: string }[]; // waiting entries to drop (clear/move of queue-only)
  rows: ShowRow[] | null; // SHOW
  summary: string;
  notes: string[];
}

const MAX_CHANGES = 3000;

function workedOf(i: EntryInput): number | null {
  return i.time_in === null || i.time_out === null ? null : effectiveHours(i.time_in, i.time_out, i.additional ?? 0);
}

function matches(c: Cond, i: EntryInput): boolean {
  const codes = i.activities.map((a) => (a.code ?? "").toUpperCase()).filter(Boolean);
  const value = (() => {
    switch (c.field) {
      case "in": return i.time_in;
      case "out": return i.time_out === null ? null : i.time_out % 24 === i.time_out ? i.time_out : i.time_out;
      case "hours": return i.activities.reduce((s, a) => s + (a.hours ?? 0), 0);
      case "worked": return workedOf(i);
      case "additional": return i.additional ?? 0;
      case "remark": return (i.remark ?? "").toUpperCase();
      case "code": return codes;
      default: return null;
    }
  })();
  if (c.op === "empty") return value === null || value === "" || (Array.isArray(value) && !value.length);
  if (c.op === "notempty") return !(value === null || value === "" || (Array.isArray(value) && !value.length));
  const test = (v: string | number | null): boolean => {
    if (v === null) return false;
    const t = c.value;
    switch (c.op) {
      case "=": return typeof v === "number" && typeof t === "number" ? Math.abs(v - t) < 1e-6 || (c.field === "out" && Math.abs(v - 24 - t) < 1e-6) : String(v) === String(t);
      case "!=": return typeof v === "number" && typeof t === "number" ? Math.abs(v - t) > 1e-6 : String(v) !== String(t);
      case "<": return Number(v) < Number(t);
      case ">": return Number(v) > Number(t);
      case "<=": return Number(v) <= Number(t) + 1e-9;
      case ">=": return Number(v) >= Number(t) - 1e-9;
      case "like": return new RegExp(`^${String(t).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i").test(String(v));
      case "contains": return String(v).toUpperCase().includes(String(t).toUpperCase());
      default: return false;
    }
  };
  if (Array.isArray(value)) return c.op === "!=" ? value.every((v) => test(v)) : value.some((v) => test(v));
  return test(value as string | number | null);
}

const shiftOut = (tin: number, tout: number) => (tout <= tin ? tout + 24 : tout);

function splitHours(total: number, n: number): number[] {
  const each = Math.floor((total / n) * 4) / 4;
  const out = Array(n).fill(each);
  out[n - 1] = Math.round((total - each * (n - 1)) * 4) / 4;
  return out;
}

function describeWorkers(names: string[]): string {
  return names.length <= 4 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}
function describeDays(days: string[]): string {
  if (days.length === 1) return `day ${days[0]}`;
  const n = days.map(Number);
  const contiguous = n.every((d, i) => i === 0 || d === n[i - 1] + 1);
  return contiguous ? `days ${n[0]}-${n[n.length - 1]}` : `days ${days.join(", ")}`;
}

/** Turn a command into queue entries (or SHOW rows). Nothing is written. */
export function run(cmd: Command, ctx: CommandContext): CommandResult {
  const res: CommandResult = { verb: cmd.verb, inputs: [], removeQueued: [], rows: null, summary: "", notes: [] };
  const skipped: Record<string, string[]> = {};
  const skip = (why: string, what: string) => (skipped[why] ??= []).push(what);
  const passes = (i: EntryInput) => cmd.conds.every((c) => matches(c, i));
  const v = cmd.verb;
  const transfer = v === "COPY" || v === "FILL" || v === "MOVE";

  const needWorkers = () => {
    if (!cmd.workers?.length && !cmd.workersAll) throw new CommandError(`Say which workers: ${v.toLowerCase()} … for INB-01, INB (all INB), all, crew of INB-03.`);
  };
  const needDays = () => {
    if (!cmd.days?.length) throw new CommandError(`Say which days: … on 1-10 (or on all, weekdays, saturdays).`);
  };
  // workers of a selection on a day: the listed ones, or with ALL everyone with an entry there
  const whoOn = (sheet: string): string[] => {
    if (!cmd.workersAll) return cmd.workers ?? [];
    const names = new Set<string>([...(cmd.workers ?? []), ...whoOnAll(ctx, sheet)]);
    return [...names].filter((n) => !cmd.exclude.includes(n));
  };

  if (v === "SHOW") {
    const days = cmd.days ?? ctx.sheets;
    const rows: ShowRow[] = [];
    for (const sheet of days)
      for (const name of cmd.workers?.length || cmd.workersAll ? whoOn(sheet) : whoOnAll(ctx, sheet).filter((n) => !cmd.exclude.includes(n))) {
        const cur = current(ctx, name, sheet);
        if (!cur || !passes(cur.input)) continue;
        const i = cur.input;
        rows.push({
          sheet, name, times: formatShift(i.time_in, i.time_out),
          codes: i.activities.map((a) => `${a.code ?? "?"}${a.hours !== null ? ` · ${fmtHours(a.hours)}` : ""}`).join(", "),
          hours: i.activities.reduce((s, a) => s + (a.hours ?? 0), 0), worked: workedOf(i), source: cur.source === "excel" ? "Excel" : "queue",
        });
      }
    res.rows = rows;
    const worked = rows.reduce((s, r) => s + (r.worked ?? 0), 0);
    res.summary = `${rows.length} entr${rows.length === 1 ? "y" : "ies"}, ${fmtHours(worked)} worked hours in all. Nothing is changed.`;
    return res;
  }

  needWorkers();
  if (transfer) {
    if (!cmd.from) {
      if (cmd.days?.length === 1) cmd.from = cmd.days[0];
      else throw new CommandError(`Say the day to take from: ${v.toLowerCase()} … from 26 to 21.`);
    }
    if (!cmd.to?.length) throw new CommandError(`Say the day(s) to put the entries on: … to 21 (or to 21-25).`);
    if (v === "MOVE" && cmd.to.length !== 1) throw new CommandError("MOVE goes to one day: move … from 26 to 21.");
    for (const name of whoOn(cmd.from)) {
      const src = current(ctx, name, cmd.from);
      if (!src) { skip(`no entry on day ${cmd.from}`, name); continue; }
      if (!passes(src.input)) continue;
      for (const to of cmd.to) {
        if (to === cmd.from) continue;
        const there = current(ctx, name, to);
        if (v === "FILL" && there) { skip(`already has an entry`, `${name} on ${to}`); continue; }
        const inExcel = Boolean(ctx.month[to]?.entries.some((e) => e.entry.calling_name === name));
        if (inExcel && !cmd.overwrite) skip("already in Excel: press Replace in the queue (or add OVERWRITE)", `${name} on ${to}`);
        res.inputs.push({ ...src.input, sheet: to, overwrite: inExcel ? cmd.overwrite : false, acknowledged: [] });
      }
      if (v === "MOVE") {
        if (src.inExcel) res.inputs.push(clearInput(cmd.from, name));
        else res.removeQueued.push({ sheet: cmd.from, name });
      }
    }
    const moved = new Set(res.inputs.filter((i) => i.sheet !== cmd.from).map((i) => i.calling_name));
    res.summary = `${v} ${describeWorkers([...moved])} from day ${cmd.from} to ${describeDays(cmd.to)}: ${res.inputs.filter((i) => i.sheet !== cmd.from).length} entr${res.inputs.length === 1 ? "y" : "ies"}${v === "MOVE" ? `, day ${cmd.from} cleared for them` : ""}.`;
  } else if (v === "SWAP") {
    const days = cmd.days ?? [];
    if (days.length !== 2) throw new CommandError("SWAP takes two days: swap INB-01 between 3 and 4.");
    const [a, b] = days;
    const names = new Set([...whoOn(a), ...whoOn(b)]);
    for (const name of names) {
      const ea = current(ctx, name, a), eb = current(ctx, name, b);
      if (!ea && !eb) { skip("no entry on either day", name); continue; }
      res.inputs.push(eb ? { ...eb.input, sheet: a, overwrite: true, acknowledged: [] } : clearInput(a, name));
      res.inputs.push(ea ? { ...ea.input, sheet: b, overwrite: true, acknowledged: [] } : clearInput(b, name));
    }
    res.summary = `SWAP days ${a} and ${b} for ${describeWorkers([...names])}.`;
  } else if (v === "ADD") {
    needDays();
    const f = cmd.fields;
    if (f.in === undefined || f.out === undefined) throw new CommandError("ADD needs the times: … in 7 out 19.");
    if (ctx.withActivities && !f.code?.length) throw new CommandError("ADD needs an activity code: … code 03-11-00-00.");
    const tout = shiftOut(f.in, f.out);
    const worked = effectiveHours(f.in, tout, f.additional ?? 0);
    const codes = f.code ?? [];
    const hours = codes.length === 1 && f.hours !== undefined ? [f.hours] : codes.length ? splitHours(worked, codes.length) : [];
    const activities: ActivityInput[] = codes.map((code, n) => ({ code, hours: hours[n] }));
    const names = (cmd.workersAll ? ctx.workers.map((w) => w.calling_name) : cmd.workers ?? []).filter((n) => !cmd.exclude.includes(n));
    for (const sheet of cmd.days!)
      for (const name of names) {
        const inExcel = Boolean(ctx.month[sheet]?.entries.some((e) => e.entry.calling_name === name));
        if (inExcel && !cmd.overwrite) skip("already in Excel: press Replace in the queue (or add OVERWRITE)", `${name} on ${sheet}`);
        res.inputs.push({ sheet, calling_name: name, time_in: f.in, time_out: tout, activities, additional: f.additional ?? null, remark: f.remark ?? null, overwrite: inExcel ? cmd.overwrite : false, acknowledged: [] });
      }
    res.summary = `ADD ${describeWorkers(names)} on ${describeDays(cmd.days!)}: ${res.inputs.length} new entr${res.inputs.length === 1 ? "y" : "ies"}, ${formatShift(f.in, tout)}${codes.length ? `, ${codes.join(" + ")}` : ""}.`;
  } else {
    needDays();
    if (v === "SET" && !Object.keys(cmd.fields).length) throw new CommandError("SET needs what to change: set out 20, set code …, set remark \"…\".");
    for (const sheet of cmd.days!)
      for (const name of whoOn(sheet)) {
        const cur = current(ctx, name, sheet);
        if (!cur) { if (!cmd.workersAll) skip(`no entry`, `${name} on ${sheet}`); continue; }
        if (!passes(cur.input)) continue;
        if (v === "CLEAR") {
          if (cur.inExcel) res.inputs.push(clearInput(sheet, name));
          else res.removeQueued.push({ sheet, name });
          continue;
        }
        let i: EntryInput = { ...cur.input, activities: cur.input.activities.map((a) => ({ ...a })), overwrite: cur.inExcel || cur.input.overwrite, acknowledged: [] };
        const tin = i.time_in, tout = i.time_out;
        if (v === "SET") {
          const f = cmd.fields;
          if (f.in !== undefined || f.out !== undefined) {
            const nin = f.in ?? tin;
            const nout = f.out ?? (tout === null ? null : tout >= 24 ? tout - 24 : tout);
            if (nin === null || nout === null) { skip("has no times to change", `${name} on ${sheet}`); continue; }
            i = withTimes(i, nin, shiftOut(nin, nout));
          }
          if (f.code) {
            const coded = i.activities.filter((a) => a.code);
            const total = coded.reduce((s, a) => s + (a.hours ?? 0), 0) || workedOf(i) || null;
            i.activities = f.code.length === 1 ? [{ code: f.code[0], hours: total }] : f.code.map((c, n) => ({ code: c, hours: total === null ? null : splitHours(total, f.code!.length)[n] }));
          }
          if (f.hours !== undefined) {
            if (i.activities.filter((a) => a.code).length > 1) { skip("has several activities: HOURS not set", `${name} on ${sheet}`); continue; }
            i.activities = i.activities.length ? [{ ...i.activities[0], hours: f.hours }] : [{ code: null, hours: f.hours }];
          }
          if (f.additional !== undefined) i.additional = f.additional;
          if (f.remark !== undefined) i.remark = f.remark || null;
        } else if (v === "SHIFT" || v === "ROUND") {
          if (tin === null || tout === null) { skip("has no times", `${name} on ${sheet}`); continue; }
          const which = cmd.target === "in" || cmd.target === "out" ? cmd.target : "times";
          const op = (t: number) => (v === "SHIFT" ? t + cmd.amount! : Math.round(t * 4) / 4);
          const nin = which === "out" ? tin : op(tin);
          const nout = which === "in" ? tout : op(tout);
          if (nin < 0 || nout <= nin || nout > nin + 24) { skip("would get impossible times", `${name} on ${sheet}`); continue; }
          if (nin === tin && nout === tout) continue;
          i = withTimes(i, nin, nout);
        } else if (v === "REPLACE") {
          const r = cmd.replace!;
          if (cmd.target === "code") {
            if (!i.activities.some((a) => (a.code ?? "").toUpperCase() === r.old)) continue;
            i.activities = i.activities.map((a) => ((a.code ?? "").toUpperCase() === r.old ? { ...a, code: String(r.new) } : a));
          } else if (cmd.target === "in" || cmd.target === "out") {
            const now = cmd.target === "in" ? tin : tout === null ? null : tout >= 24 ? tout - 24 : tout;
            if (now === null || Math.abs(now - Number(r.old)) > 1e-6) continue;
            const nin = cmd.target === "in" ? Number(r.new) : tin!;
            const nout = cmd.target === "out" ? shiftOut(tin!, Number(r.new)) : shiftOut(Number(r.new), tout!);
            i = withTimes(i, nin, nout);
          } else throw new CommandError("REPLACE works on code, in or out.");
        }
        res.inputs.push(i);
      }
    const n = res.inputs.length + res.removeQueued.length;
    const touched = [...new Set([...res.inputs, ...res.removeQueued.map((r) => ({ calling_name: r.name }))].map((x) => x.calling_name))];
    const what = v === "SET" ? Object.entries(cmd.fields).map(([k, val]) => `${k.toUpperCase()} ${k === "in" || k === "out" ? formatClock(val as number) : Array.isArray(val) ? val.join(" + ") : val}`).join(", ")
      : v === "SHIFT" ? `${cmd.target} ${cmd.amount! > 0 ? "+" : ""}${fmtHours(cmd.amount!)} h` : v === "ROUND" ? `${cmd.target} to 15 minutes` : v === "REPLACE" ? `${cmd.target} ${cmd.replace!.old} → ${cmd.replace!.new}` : "";
    res.summary = `${v}${what ? ` ${what}` : ""}: ${n} entr${n === 1 ? "y" : "ies"} (${describeWorkers(touched)}) on ${describeDays(cmd.days!)}${cmd.conds.length ? " that match" : ""}.`;
  }
  if (res.inputs.length + res.removeQueued.length > MAX_CHANGES) throw new CommandError(`That would change ${res.inputs.length} entries: more than ${MAX_CHANGES} at once. Narrow the workers or days.`);
  if (!res.inputs.length && !res.removeQueued.length && !res.notes.length) res.notes.push("Nothing matches: no entry changes.");
  for (const [why, what] of Object.entries(skipped)) res.notes.push(`${what.length} skipped (${why}): ${what.slice(0, 8).join(", ")}${what.length > 8 ? " …" : ""}`);
  return res;
}

function whoOnAll(ctx: CommandContext, sheet: string): string[] {
  const names = new Set<string>();
  for (const e of ctx.month[sheet]?.entries ?? []) if (e.entry.calling_name) names.add(e.entry.calling_name);
  for (const q of ctx.queued) if (q.sheet === sheet) names.add(q.calling_name);
  return [...names];
}

// --- help while typing --------------------------------------------------------------------------

/** The card for a word: a command ("insert" -> ADD), keyword, field, operator, worker, day or code.
 * ``prev`` (the words before it) tells a value from a day: in "where out = 19", 19 is a time. */
export function explain(word: string, ctx: CommandContext, prev: string[] = []): WordInfo | null {
  const low = word.toLowerCase().replace(/^["']|["']$/g, "");
  if (!low) return null;
  const p1 = prev[prev.length - 1]?.toLowerCase();
  const p2 = prev[prev.length - 2]?.toLowerCase();
  const valueOf = fieldOf(p1) ?? (p1 && (OPERATORS[p1] || OP_SYNONYMS[p1]) ? fieldOf(p2) : null);
  const shiftAmount = verbOf(prev[0]) === "SHIFT" && (keywordOf(p1) === "BY" || ["in", "out", "times"].includes(fieldOf(p1) ?? ""));
  if (shiftAmount && parseAmount(low) !== null) {
    const a = parseAmount(low)!;
    return { name: `${a > 0 ? "+" : ""}${fmtHours(a)} h`, kind: "field", text: `Moves the time ${a >= 0 ? "later" : "earlier"} by ${fmtHours(Math.abs(a))} hour${Math.abs(a) === 1 ? "" : "s"} (${Math.round(Math.abs(a) * 60)} minutes).`, synonyms: [] };
  }
  if ((valueOf === "in" || valueOf === "out") && parseClock(low) !== null)
    return { name: formatClock(parseClock(low)), kind: "field", text: `A time for ${valueOf.toUpperCase()}: ${formatClock(parseClock(low))}.`, synonyms: [] };
  if ((valueOf === "hours" || valueOf === "additional" || valueOf === "worked") && !Number.isNaN(Number(low)))
    return { name: `${low} h`, kind: "field", text: `${low} hours for ${valueOf.toUpperCase()}.`, synonyms: [] };
  const hit = lookup.get(low);
  if (hit?.kind === "command") {
    const info = VERB_INFO[hit.key as Verb];
    return { name: hit.key, kind: "command", ...info, text: low !== hit.key.toLowerCase() ? `"${word}" means ${hit.key}. ${info.text}` : info.text };
  }
  if (hit?.kind === "keyword") {
    const k = KEYWORDS[hit.key];
    return { name: k.name, kind: "keyword", text: low !== k.name.toLowerCase() ? `"${word}" means ${k.name}. ${k.text}` : k.text, synonyms: k.synonyms };
  }
  if (hit?.kind === "field") {
    const f = FIELDS[hit.key as Field];
    return { name: hit.key.toUpperCase(), kind: "field", text: low !== hit.key ? `"${word}" means ${hit.key.toUpperCase()}. ${f.text}` : f.text, synonyms: f.synonyms };
  }
  const op = OPERATORS[OP_SYNONYMS[low] ?? low];
  if (op) return { name: op.name, kind: "operator", text: op.text, synonyms: Object.entries(OP_SYNONYMS).filter(([, v]) => v === (OP_SYNONYMS[low] ?? low)).map(([k]) => k) };
  const w = ctx.workers.find((x) => x.calling_name.toLowerCase() === low);
  if (w) return { name: w.calling_name, kind: "workers", text: `Worker ${w.calling_name}${w.name ? `, ${String(w.name)}` : ""}${w.trade_group ? ` (${String(w.trade_group)})` : ""}.`, synonyms: [] };
  if (/^\d+$/.test(low) && ctx.sheets.includes(low)) {
    const d = dateOf(ctx, low);
    return { name: `Day ${low}`, kind: "days", text: d ? `Sheet ${low}: ${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}.` : `Sheet ${low}.`, synonyms: [] };
  }
  const code = ctx.activities.find((a) => a.toLowerCase() === low);
  if (code) return { name: code, kind: "field", text: "An activity code from the list in Labour Detail.", synonyms: [] };
  return null;
}

export interface Suggestion {
  insert: string; // the word to put in
  label: string;
  detail: string;
}

/** What could come next where the cursor is: completes the word being typed. */
export function suggest(src: string, cursor: number, ctx: CommandContext, limit = 8): { from: number; items: Suggestion[] } {
  const before = src.slice(0, cursor);
  const m = before.match(/[^\s,]*$/);
  const partial = (m?.[0] ?? "").toLowerCase();
  const from = cursor - partial.length;
  const done = tokenize(before.slice(0, from)).map((t) => t.text.toLowerCase());
  const pick = (cands: Suggestion[]) => cands.filter((c) => c.insert.toLowerCase().startsWith(partial) && c.insert.toLowerCase() !== partial).slice(0, limit);
  const verb = verbOf(done[0]);
  if (!done.length) {
    const verbs: Suggestion[] = [];
    for (const [word, v] of lookup) if (v.kind === "command") verbs.push({ insert: word, label: word === v.key.toLowerCase() ? v.key.toLowerCase() : `${word} → ${v.key}`, detail: VERB_INFO[v.key as Verb].text.split(".")[0] });
    const canon = verbs.filter((s) => !s.label.includes("→"));
    return { from, items: pick(partial ? [...canon, ...verbs.filter((s) => s.label.includes("→"))] : canon) };
  }
  const last = done[done.length - 1];
  const lastKw = keywordOf(last);
  const lastField = fieldOf(last);
  // the clause we are in
  let clause: "workers" | "days" | "where" | "none" = "workers";
  for (const t of done.slice(1)) {
    const k = keywordOf(t);
    if (k === "FOR" || k === "EXCEPT") clause = "workers";
    else if (k === "ON" || k === "FROM" || k === "TO" || k === "BETWEEN") clause = "days";
    else if (k === "WHERE") clause = "where";
  }
  const kw = (names: string[]): Suggestion[] => names.map((n) => ({ insert: n, label: n, detail: KEYWORDS[keywordOf(n) ?? ""]?.text.split(".")[0] ?? "" }));
  const fieldsS = (names: Field[]): Suggestion[] => names.map((n) => ({ insert: n, label: n, detail: FIELDS[n].text.split(".")[0] }));
  const workerS = (): Suggestion[] => [
    ...kw(["all", "crew", "trade"]),
    ...[...new Set(ctx.workers.map((w) => w.calling_name.match(/^[A-Za-z]+/)?.[0]).filter(Boolean) as string[])].map((p) => ({ insert: p, label: p, detail: `every ${p}-.. worker` })),
    ...ctx.workers.map((w) => ({ insert: w.calling_name.includes(" ") ? w.calling_name.split(" ")[0] : w.calling_name, label: w.calling_name, detail: `${String(w.name ?? "")} ${w.trade_group ? `· ${String(w.trade_group)}` : ""}`.trim() })),
  ];
  const dayS = (): Suggestion[] => [
    ...ctx.sheets.map((s) => {
      const d = dateOf(ctx, s);
      return { insert: s, label: s, detail: d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : `sheet ${s}` };
    }),
    ...["all", "weekdays", "saturdays", "sundays", "holidays", "today", "yesterday"].map((w) => ({ insert: w, label: w, detail: "days" })),
  ];
  const next = (): Suggestion[] => {
    const v = verb ?? "SET";
    const tail: Record<Verb, string[]> = {
      SET: ["for", "on", "where", "in", "out", "code", "hours", "additional", "remark"],
      SHIFT: ["for", "on", "where"], ROUND: ["for", "on", "where"], REPLACE: ["for", "on", "where"],
      ADD: ["on", "in", "out", "code", "hours", "additional", "remark", "overwrite"],
      COPY: ["from", "to", "where", "overwrite"], FILL: ["from", "to"], MOVE: ["from", "to", "overwrite"],
      SWAP: ["between", "and", "for"], CLEAR: ["for", "on", "where"], SHOW: ["for", "on", "where"],
    };
    return [...kw(tail[v].filter((t) => keywordOf(t))), ...fieldsS(tail[v].filter((t) => fieldOf(t) && !keywordOf(t)) as Field[])];
  };

  if (done.length === 1 && verb && (verb === "SHIFT" || verb === "ROUND" || verb === "REPLACE")) return { from, items: pick([...fieldsS(verb === "REPLACE" ? ["code", "in", "out"] : ["in", "out", "times"]), ...workerS()]) };
  if (done.length === 1 && verb === "SET") return { from, items: pick(fieldsS(["in", "out", "code", "hours", "additional", "remark"])) };
  if (lastField === "code" && clause !== "where") return { from, items: pick(ctx.activities.map((a) => ({ insert: a, label: a, detail: "activity code" }))) };
  if ((lastField === "in" || lastField === "out") && clause !== "where" && verb !== "SHIFT" && verb !== "ROUND")
    return { from, items: pick(["7", "7.30", "8", "16", "17", "19", "20", "21", "22"].map((t) => ({ insert: t, label: formatClock(parseClock(t)), detail: lastField === "in" ? "Time In" : "Time Out" }))) };
  if (clause === "where") {
    if (lastKw === "WHERE" || lastKw === "AND") return { from, items: pick(fieldsS(["in", "out", "code", "hours", "worked", "additional", "remark"])) };
    if (lastField) return { from, items: pick(Object.keys(OPERATORS).map((o) => ({ insert: o, label: OPERATORS[o].name, detail: OPERATORS[o].text }))) };
    return { from, items: pick([...kw(["and"]), ...(done[done.length - 3] && fieldOf(done[done.length - 3]) === "code" || (lastField === null && fieldOf(done[done.length - 2]) === "code") ? ctx.activities.map((a) => ({ insert: a, label: a, detail: "activity code" })) : [])]) };
  }
  if (lastKw === "ON" || lastKw === "FROM" || lastKw === "TO" || lastKw === "BETWEEN" || (clause === "days" && /^\d/.test(partial))) return { from, items: pick(dayS()) };
  if (lastKw === "FOR" || lastKw === "EXCEPT" || (done.length === 1 && verb)) return { from, items: pick([...workerS(), ...next()]) };
  if (lastKw === "CREW") return { from, items: pick([{ insert: "of", label: "of", detail: "crew of <worker>" }]) };
  if (last === "of" || last === "crew") return { from, items: pick(workerS().filter((s) => !["all", "crew", "trade"].includes(s.insert))) };
  if (lastKw === "TRADE") return { from, items: pick([...new Set(ctx.workers.map((w) => String(w.trade_group ?? "").trim()).filter(Boolean))].map((t) => ({ insert: t.includes(" ") ? `"${t}"` : t, label: t, detail: "trade group" }))) };
  return { from, items: pick([...next(), ...(clause === "workers" ? workerS() : dayS())]) };
}
