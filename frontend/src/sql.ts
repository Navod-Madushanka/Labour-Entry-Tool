// SQL in the command box: SELECT (with WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, aggregates),
// INSERT, UPDATE and DELETE over the month as tables. Like the commands, nothing is written:
// SELECT lists, INSERT/UPDATE/DELETE produce ordinary queue entries (checked, shown on the
// manpower sheet, pushed as one undoable batch). Column names are forgiving: `in times`,
// InTime and in_time are all IN; ZIDAL is the employee code.
import type { ActivityInput, EntryInput } from "./api";
import { codeKey, mergeSameCodes, CommandError, current, dateOf, didYouMean, whoOnAll, type CommandContext, type CommandResult, type Suggestion, type Token, type WordInfo } from "./commands";
import { describe, placeName } from "./codes";
import { clearInput, withTimes } from "./form";
import { effectiveHours, formatClock, parseClock } from "./time";
import { aggregate, AGGREGATES, callScalar, dateArith, fnName, FUNCTIONS, functionInfo, intervalText, isFunction, isUnitWord, NO_PARENS, SqlFnError, WINDOW_ONLY } from "./sqlfuncs";

// --- tables and columns --------------------------------------------------------------------------

type ColType = "text" | "number" | "time" | "date";
interface ColDef {
  name: string;
  type: ColType;
  aliases: string[];
  help: string;
}
interface TableDef {
  name: string;
  aliases: string[];
  help: string;
  cols: ColDef[];
  writable?: boolean;
}
type Row = Record<string, string | number | null>;

const col = (name: string, type: ColType, help: string, aliases: string[] = []): ColDef => ({ name, type, help, aliases });
const ENTRY_COLS: ColDef[] = [
  col("day", "number", "Sheet number (day of the month).", ["sheet", "sheetno", "dayno"]),
  col("date", "date", "The day's date, YYYY-MM-DD.", ["workdate", "entrydate"]),
  col("calling_name", "text", "Calling name, e.g. INB-01.", ["name", "callingname", "calling", "worker", "labor", "labour", "labourer", "employee_name", "emp_name"]),
  col("full_name", "text", "The worker's name in Labour Detail.", ["fullname", "personname", "workername", "realname"]),
  col("trade", "text", "Trade group from Labour Detail.", ["tradegroup", "designation", "group"]),
  col("employee_code", "text", "Employee code (ERP), e.g. X10001. ZIDAL works too.", ["employeecode", "empcode", "empno", "employeeno", "employeeid", "empid", "emp", "zidal", "erpcode", "code_no"]),
  col("in", "time", "Time In: 07:00. With a date ('2026-10-01 07:00:00') the date picks the day.", ["intime", "timein", "start", "starttime", "clockin", "begin"]),
  col("out", "time", "Time Out; past midnight it is the next morning.", ["outtime", "timeout", "end", "endtime", "clockout", "finish"]),
  col("code", "text", "Activity code (several lines: joined with +).", ["activitycode", "activity", "wbs", "wbscode", "act", "task"]),
  col("place", "text", "The place named for the code's ending (Place names).", ["location", "site", "area"]),
  col("hours", "number", "Hours on the activity lines (together).", ["hour", "hrs", "activityhours", "workhours"]),
  col("worked", "number", "Worked hours after lunch/dinner deductions.", ["effective", "workedhours", "effectivehours", "normalplusot"]),
  col("ot", "number", "Overtime hours (worked over 8 on a normal day, 5.5 on Saturday, all on Sunday/holiday).", ["othours", "overtime", "overtimehours", "extrahours"]),
  col("normal", "number", "Normal hours: worked minus OT.", ["normalhours", "regular", "regularhours"]),
  col("total", "number", "Out minus In, before deductions.", ["totalhours", "span", "duration"]),
  col("additional", "number", "Additional hours (e.g. -1).", ["additionalhours", "addhours", "adjustment"]),
  col("remark", "text", "Remark.", ["remarks", "note", "notes", "comment", "comments"]),
  col("day_type", "text", "Normal Day, Saturday, Sunday or Holiday (sheet header).", ["daytype", "typeofday"]),
  col("source", "text", "Excel, or queue (waiting to be pushed).", ["origin", "status"]),
  col("supervisor", "text", "Whose manpower sheet the entry was pushed from (Supervisors page); empty when typed straight in. Not SET here: a correction keeps it.", ["foreman", "owner", "sheetowner", "pushedby", "supervisorname"]),
];
const SUPERVISOR = ENTRY_COLS[19];
const TABLES: TableDef[] = [
  { name: "entries", writable: true, help: "One row per worker per day: what is in Excel plus what waits in the queue. INSERT, UPDATE and DELETE go to the queue.", aliases: ["entry", "labor", "labour", "labors", "labours", "work", "records", "record", "timesheet", "timesheets", "attendance", "manpower"], cols: ENTRY_COLS },
  { name: "activities", help: "One row per activity line (for sums of hours by code).", aliases: ["activity", "lines", "activitylines", "allocations"], cols: [ENTRY_COLS[0], ENTRY_COLS[1], ENTRY_COLS[2], ENTRY_COLS[3], ENTRY_COLS[5], col("code", "text", "Activity code.", ["activitycode", "activity", "wbs", "act", "task"]), ENTRY_COLS[9], col("hours", "number", "Hours on this line.", ["hour", "hrs"]), ENTRY_COLS[18], SUPERVISOR] },
  { name: "workers", help: "Labour Detail: every calling name with its worker.", aliases: ["worker", "employees", "employee", "staff", "people", "labourdetail", "labordetail", "master"], cols: [ENTRY_COLS[2], ENTRY_COLS[3], ENTRY_COLS[4], ENTRY_COLS[5], col("code_status", "text", "valid, missing, error (#N/A), zero or invalid.", ["codestatus", "employeecodestatus"]), col("row", "number", "Row in Labour Detail.", ["rowno", "line"]), col("days_worked", "number", "Days with an entry this month.", ["daysworked", "days", "attendance"])] },
  { name: "codes", help: "The activity list in Labour Detail.", aliases: ["code", "activitycodes", "activitycode", "wbs", "activitylist", "wbscodes"], cols: [col("code", "text", "Activity code.", ["activitycode", "wbs"]), col("description", "text", "What the code is: the office's description or the MasterFormat title.", ["desc", "title", "name", "activityname"]), ENTRY_COLS[9], col("lines", "number", "Activity lines with this code this month.", ["used", "uses", "count"])] },
  { name: "supervisors", help: "Each supervisor with the entries pushed from their manpower sheets this month.", aliases: ["foremen", "foreman", "sheetowners", "owners"], cols: [
    col("supervisor", "text", "The supervisor's name as chosen at push.", ["name", "foreman", "owner"]),
    col("days", "number", "Day sheets with entries from this supervisor.", ["sheets", "daycount"]),
    col("entries", "number", "Worker-days pushed from this supervisor's sheets.", ["workerdays", "rows", "count"]),
    col("workers", "number", "Different calling names on their sheets.", ["people", "headcount"]),
    col("hours", "number", "Worked hours on those entries.", ["worked", "workedhours"]),
    col("first_day", "number", "First day sheet with their entries.", ["firstday", "from"]),
    col("last_day", "number", "Last day sheet with their entries.", ["lastday", "to"]),
  ] },
  { name: "days", help: "The day sheets.", aliases: ["day", "sheets", "sheet", "dates", "calendar"], cols: [ENTRY_COLS[0], ENTRY_COLS[1], col("weekday", "text", "Monday … Sunday.", ["dow", "dayname"]), ENTRY_COLS[17], col("workers", "number", "Workers with an entry that day.", ["count", "people", "headcount"])] },
];

const norm = (id: string) => {
  let t = id.toLowerCase().replace(/^[`"[]|[`"\]]$/g, "").replace(/[\s_\-.]+/g, "");
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t;
};
const tableIndex = new Map<string, TableDef>();
for (const t of TABLES) for (const a of [t.name, ...t.aliases]) tableIndex.set(norm(a), t);
/** SELECT with no FROM (or FROM dual, as in Oracle and MySQL): one empty row. */
const DUAL: TableDef = { name: "dual", aliases: [], help: "No table: one row, for trying functions (SELECT UPPER('abc')).", cols: [] };
function findTable(name: string): TableDef {
  if (norm(name) === "dual") return DUAL;
  const t = tableIndex.get(norm(name));
  if (t) return t;
  const hint = didYouMean(name, TABLES.flatMap((x) => [x.name, ...x.aliases]));
  throw new CommandError(`There is no table "${name}". Tables: ${TABLES.map((x) => x.name).join(", ")}${hint ? `. Did you mean ${tableIndex.get(norm(hint))!.name}?` : "."}`);
}
function findCol(t: TableDef, name: string): ColDef {
  const n = norm(name);
  const c = t.cols.find((x) => norm(x.name) === n || x.aliases.some((a) => norm(a) === n));
  if (c) return c;
  const hint = didYouMean(name, t.cols.flatMap((x) => [x.name, ...x.aliases]));
  throw new CommandError(`${t.name} has no column "${name}"${hint ? `. Did you mean ${findCol(t, hint).name}?` : `. Columns: ${t.cols.map((x) => x.name).join(", ")}.`}`);
}

// --- the month as rows ---------------------------------------------------------------------------

const OT_FROM: Record<string, number> = { "normal day": 8, saturday: 5.5, sunday: 0, holiday: 0 };
const iso = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null);

function entryRows(ctx: CommandContext): { row: Row; input: EntryInput; inExcel: boolean }[] {
  const byName = new Map(ctx.workers.map((w) => [w.calling_name, w]));
  const out: { row: Row; input: EntryInput; inExcel: boolean }[] = [];
  for (const sheet of ctx.sheets) {
    const dayType = String(ctx.month[sheet]?.header.day_type ?? "").trim();
    for (const name of whoOnAll(ctx, sheet)) {
      const cur = current(ctx, name, sheet);
      if (!cur) continue;
      const i = cur.input;
      const w = byName.get(name);
      const worked = i.time_in !== null && i.time_out !== null ? effectiveHours(i.time_in, i.time_out, i.additional ?? 0) : null;
      const limit = OT_FROM[dayType.toLowerCase()] ?? 8;
      const ot = worked === null ? null : Math.max(0, Math.round((worked - limit) * 100) / 100);
      const codes = i.activities.map((a) => a.code).filter((c): c is string => Boolean(c));
      out.push({
        input: i,
        inExcel: cur.inExcel,
        row: {
          day: Number(sheet), date: iso(dateOf(ctx, sheet)), calling_name: name, full_name: w?.name == null ? null : String(w.name),
          trade: w?.trade_group == null ? null : String(w.trade_group), employee_code: w?.employee_code == null ? null : String(w.employee_code),
          in: i.time_in, out: i.time_out, code: codes.join("+") || null, place: codes.map((c) => placeName(c, ctx.places)).filter(Boolean).join("+") || null,
          hours: i.activities.reduce((s, a) => s + (a.hours ?? 0), 0), worked, ot, normal: worked === null || ot === null ? null : worked - ot,
          total: i.time_in !== null && i.time_out !== null ? i.time_out - i.time_in : null, additional: i.additional, remark: i.remark, day_type: dayType || null,
          source: cur.source === "excel" ? "Excel" : "queue",
          supervisor: ctx.owners?.get(`${sheet}|${name}`) ?? null,
        },
      });
    }
  }
  return out;
}

function tableRows(t: TableDef, ctx: CommandContext): Row[] {
  if (t === DUAL) return [{}];
  if (t.name === "entries") return entryRows(ctx).map((r) => r.row);
  if (t.name === "activities")
    return entryRows(ctx).flatMap(({ row, input }) =>
      input.activities.filter((a) => a.code || a.hours !== null).map((a) => ({ day: row.day, date: row.date, calling_name: row.calling_name, full_name: row.full_name, employee_code: row.employee_code, code: a.code, place: a.code ? placeName(a.code, ctx.places) : null, hours: a.hours, source: row.source, supervisor: row.supervisor })),
    );
  if (t.name === "workers") {
    const days = new Map<string, number>();
    for (const r of entryRows(ctx)) days.set(String(r.row.calling_name), (days.get(String(r.row.calling_name)) ?? 0) + 1);
    return ctx.workers.map((w) => ({ calling_name: w.calling_name, full_name: w.name == null ? null : String(w.name), trade: w.trade_group == null ? null : String(w.trade_group), employee_code: w.employee_code == null ? null : String(w.employee_code), code_status: w.code_status, row: w.row, days_worked: days.get(w.calling_name) ?? 0 }));
  }
  if (t.name === "codes") {
    const used = new Map<string, number>();
    for (const r of entryRows(ctx)) for (const a of r.input.activities) if (a.code) used.set(a.code.toUpperCase(), (used.get(a.code.toUpperCase()) ?? 0) + 1);
    return ctx.activities.map((c) => ({ code: c, description: describe(c, ctx.descriptions), place: placeName(c, ctx.places), lines: used.get(c.toUpperCase()) ?? 0 }));
  }
  if (t.name === "supervisors") {
    const by = new Map<string, { days: Set<number>; entries: number; workers: Set<string>; hours: number }>();
    for (const { row } of entryRows(ctx)) {
      if (!row.supervisor) continue;
      const k = String(row.supervisor);
      const g = by.get(k) ?? { days: new Set(), entries: 0, workers: new Set(), hours: 0 };
      g.days.add(Number(row.day));
      g.entries += 1;
      g.workers.add(String(row.calling_name));
      g.hours += Number(row.worked ?? 0);
      by.set(k, g);
    }
    return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([supervisor, g]) => ({
      supervisor, days: g.days.size, entries: g.entries, workers: g.workers.size, hours: Math.round(g.hours * 100) / 100,
      first_day: Math.min(...g.days), last_day: Math.max(...g.days),
    }));
  }
  const counts = new Map<number, number>();
  for (const r of entryRows(ctx)) counts.set(Number(r.row.day), (counts.get(Number(r.row.day)) ?? 0) + 1);
  return ctx.sheets.map((s) => {
    const d = dateOf(ctx, s);
    return { day: Number(s), date: iso(d), weekday: d ? d.toLocaleDateString("en-GB", { weekday: "long" }) : null, day_type: ctx.month[s]?.header.day_type == null ? null : String(ctx.month[s].header.day_type), workers: counts.get(Number(s)) ?? 0 };
  });
}

// --- tokens and parsing ----------------------------------------------------------------------------

type Expr =
  | { k: "lit"; v: string | number | null }
  | { k: "col"; name: string; raw: string; quoted?: boolean }
  | { k: "star" }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "not"; e: Expr }
  | { k: "neg"; e: Expr }
  | { k: "fn"; name: string; args: Expr[]; distinct: boolean; order?: OrderBy[]; sep?: Expr; filter?: Expr; within?: OrderBy[]; over?: Win }
  | { k: "in"; e: Expr; list: Expr[]; neg: boolean }
  | { k: "between"; e: Expr; lo: Expr; hi: Expr; neg: boolean }
  | { k: "like"; e: Expr; pat: Expr; neg: boolean }
  | { k: "isnull"; e: Expr; neg: boolean }
  | { k: "case"; base: Expr | null; whens: [Expr, Expr][]; else: Expr | null }
  | { k: "regexp"; e: Expr; pat: Expr; neg: boolean }
  | { k: "distinctfrom"; l: Expr; r: Expr; neg: boolean };
interface OrderBy { e: Expr; desc: boolean; nulls?: "first" | "last" }
interface Bound { k: "unbounded" | "current" | "preceding" | "following"; n: number }
interface Win { partition: Expr[]; order: OrderBy[]; frame: { rows: boolean; start: Bound; end: Bound } | null }

interface Select {
  kind: "select";
  table: string;
  distinct: boolean;
  items: { e: Expr; alias: string | null; text: string }[] | "*";
  where: Expr | null;
  group: Expr[];
  having: Expr | null;
  order: OrderBy[];
  limit: number | null;
  offset: number;
}
interface Insert { kind: "insert"; table: string; cols: string[] | null; rows: Expr[][] }
interface Update { kind: "update"; table: string; sets: { col: string; e: Expr }[]; where: Expr | null }
interface Delete { kind: "delete"; table: string; where: Expr | null }
export type Statement = Select | Insert | Update | Delete;

// SELECT … FROM; or SELECT with no FROM that starts with a function, CASE, a text or a number
// (SELECT UPPER('abc'), SELECT NOW()); never "select all on 3" (the SHOW command)
const SQL_START = /^\s*(select\b[\s\S]*\bfrom\b|select\s+(count|sum|avg|min|max|\*)|select\s+(distinct\s+)?([A-Za-z_]\w*\s*\(|case\b|'|-?\d|current_(date|time|timestamp)\b)|insert\s+into\b|update\s+[`"\w]+\s+set\b|delete\s+from\b)/i;
/** True when the text is SQL rather than one of the plain commands (which share some verbs). */
export const isSql = (src: string) => SQL_START.test(src);
/** SQL while it is still being typed (before FROM / INTO / SET): a capital first word, or SQL
 * symbols right after it. Plain commands are typed in small letters ("select all on 3"). */
export const looksSql = (src: string) =>
  isSql(src) || /^\s*(SELECT|INSERT|UPDATE|DELETE)\b/.test(src) || /^\s*select\s+(\*|distinct\b|count\s*\(|sum\s*\(|avg\s*\(|min\s*\(|max\s*\()/i.test(src) || /^\s*(insert\s+into|delete\s+from)\b/i.test(src);

export function sqlTokens(src: string): Token[] {
  const out: Token[] = [];
  const re = /'(?:[^']|'')*'?|`[^`]*`?|"[^"]*"?|\[[^\]]*\]?|\d+(?:\.\d+)?|<=|>=|<>|!=|==|\|\||[=<>+\-*/(),;.%]|[A-Za-z_][A-Za-z0-9_\-]*(?:-\d+)*|\S/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

const KW = new Set(["select", "distinct", "from", "where", "group", "by", "having", "order", "asc", "desc", "limit", "offset", "insert", "into", "values", "update", "set", "delete", "and", "or", "not", "like", "in", "between", "is", "null", "as", "true", "false", "case", "interval", "over", "partition", "within", "separator", "regexp", "rlike", "ilike", "div", "mod", "nulls", "escape", "similar"]);
// words that end a CASE's parts: keywords only inside a CASE ("end" is also a name for out)
const CASE_WORDS = new Set(["when", "then", "else", "end"]);
/** Functions whose first value is a date part written bare: DATEADD(day, 1, date). */
const UNIT_FIRST = new Set(["dateadd", "datediff", "datediff_big", "datepart", "datename", "datetrunc", "timestampdiff", "timestampadd", "date_part", "date_trunc", "trunc"]);
const isAggName = (name: string) => AGGREGATES.has(fnName(name) ?? "");

function parseStatement(src: string): Statement {
  const tokens = sqlTokens(src).filter((t, i, all) => !(t.text === ";" && i === all.length - 1));
  if (tokens.some((t) => t.text === ";")) throw new CommandError("One statement at a time: run them one after the other.");
  let i = 0;
  const peek = (o = 0) => tokens[i + o];
  const low = (o = 0) => peek(o)?.text.toLowerCase();
  const at = () => peek() ?? tokens[tokens.length - 1];
  const eat = (word: string) => {
    if (low() !== word) throw new CommandError(`Expected ${word.toUpperCase()}${peek() ? ` before "${peek()!.text}"` : " at the end"}.`, at());
    i++;
  };
  const accept = (word: string) => (low() === word ? (i++, true) : false);
  const ident = (): string => {
    const t = peek();
    if (!t) throw new CommandError("A name is missing at the end.");
    if (/^[`"[]/.test(t.text)) { i++; return t.text.slice(1, -1); }
    const isInColumn = t.text.toLowerCase() === "in" && peek(1)?.text !== "(";
    const caseWord = caseDepth > 0 && CASE_WORDS.has(t.text.toLowerCase());
    if (/^[A-Za-z_]/.test(t.text) && (!KW.has(t.text.toLowerCase()) || isInColumn) && !caseWord) {
      i++;
      // a bare name of several words (`in times` without quotes): join until a keyword or symbol
      let name = t.text;
      while (peek() && /^[A-Za-z_]/.test(peek()!.text) && !KW.has(low()!) && !(caseDepth > 0 && CASE_WORDS.has(low()!)) && !isFunction(low()!) && peek(1)?.text !== "(" && peek()!.start === tokens[i - 1].end + 1 && name.split(" ").length < 3 && looksLikeContinuation(name, peek()!.text)) {
        name += ` ${peek()!.text}`;
        i++;
      }
      return name;
    }
    throw new CommandError(`"${t.text}" is not a name here.`, t);
  };
  const looksLikeContinuation = (a: string, b: string) => ["time", "times", "hours", "hour", "code", "codes", "name", "names", "type", "status", "no"].includes(b.toLowerCase()) && a.length < 20;

  const primary = (): Expr => {
    const t = peek();
    if (!t) throw new CommandError("The statement stops too early.");
    if (t.text === "(") { i++; const e = expr(); eat(")"); return e; }
    if (t.text === "*") { i++; return { k: "star" }; }
    if (t.text === "-") { i++; return { k: "neg", e: primary() }; }
    if (/^\d/.test(t.text)) { i++; return { k: "lit", v: Number(t.text) }; }
    if (t.text.startsWith("'")) { i++; return { k: "lit", v: t.text.slice(1, -1).replace(/''/g, "'") }; }
    const l = t.text.toLowerCase();
    if (l === "null") { i++; return { k: "lit", v: null }; }
    if (l === "true" || l === "false") { i++; return { k: "lit", v: l === "true" ? 1 : 0 }; }
    if (l === "case") return caseExpr();
    if (l === "interval") { // INTERVAL 7 DAY · INTERVAL '7' DAY · INTERVAL '7 days'
      i++;
      const v = peek();
      if (!v) throw new CommandError("INTERVAL needs a number and a unit, e.g. INTERVAL 7 DAY.");
      i++;
      const raw = v.text.replace(/^'|'$/g, "");
      const both = raw.match(/^\s*(-?[\d.]+)\s+([A-Za-z]+)\s*$/);
      if (both) return { k: "lit", v: intervalText(Number(both[1]), both[2].replace(/s$/i, "")) };
      const unit = peek();
      if (!unit || !isUnitWord(unit.text.replace(/s$/i, ""))) throw new CommandError(`INTERVAL ${raw} needs a unit: DAY, MONTH, YEAR, HOUR, MINUTE…`, unit ?? v);
      i++;
      return { k: "lit", v: intervalText(Number(raw), unit.text.replace(/s$/i, "")) };
    }
    if (NO_PARENS.has(l) && peek(1)?.text !== "(" && !(tableCols?.has(l))) { i++; return { k: "fn", name: l, args: [], distinct: false }; }
    if (/^[A-Za-z_@][\w@]*$/.test(t.text) && peek(1)?.text === "(" && (!KW.has(l) || isFunction(l))) {
      if (!isFunction(l)) {
        const hint = didYouMean(l, FUNCTIONS.flatMap((f) => [f.name, ...f.aliases]));
        throw new CommandError(`${t.text.toUpperCase()} is not a function here${hint ? `. Did you mean ${hint.toUpperCase()}?` : "."} The Functions list in the panel has them all.`, t);
      }
      return call(l);
    }
    if (t.text.startsWith('"') && !/^"[A-Za-z_ ]+"$/.test(t.text)) { i++; return { k: "lit", v: t.text.slice(1, -1) }; }
    const quoted = t.text.startsWith('"');
    let name = ident();
    if (peek()?.text === ".") { i++; name = ident(); } // table.column
    return { k: "col", name, raw: name, quoted };
  };
  const unary = (): Expr => {
    if (peek()?.text === "+") { i++; return unary(); }
    let e = primary();
    // PostgreSQL: value::type
    while (peek()?.text === ":" && peek(1)?.text === ":" && peek(1)!.start === peek()!.end) { i += 2; e = { k: "fn", name: "cast", args: [e, { k: "lit", v: typeName() }], distinct: false }; }
    return e;
  };
  /** A type as written: INT, DECIMAL(10, 2), VARCHAR(20), DOUBLE PRECISION, TIMESTAMP WITH TIME ZONE. */
  const typeName = (): string => {
    const parts: string[] = [];
    while (peek() && /^[A-Za-z_]/.test(peek()!.text) && !["as", "from", "where", "and", "or", "using"].includes(low()!) && !(caseDepth > 0 && CASE_WORDS.has(low()!))) {
      parts.push(tokens[i++].text);
      if (peek()?.text === "(") { let d = 0; let txt = ""; do { const x = tokens[i++]; if (x.text === "(") d++; if (x.text === ")") d--; txt += x.text; } while (d > 0 && i < tokens.length); parts[parts.length - 1] += txt; }
    }
    if (!parts.length) throw new CommandError("A type is missing, e.g. INT, DECIMAL(10,2), VARCHAR(20), DATE.", at());
    return parts.join(" ");
  };
  let caseDepth = 0;
  /** CASE WHEN c THEN v … [ELSE v] END · CASE x WHEN a THEN v … END */
  const caseExpr = (): Expr => {
    i++;
    caseDepth++;
    try {
      const base = low() === "when" ? null : expr();
      const whens: [Expr, Expr][] = [];
      while (accept("when")) { const w = expr(); eat("then"); whens.push([w, expr()]); }
      if (!whens.length) throw new CommandError("CASE needs at least one WHEN … THEN …", at());
      const otherwise = accept("else") ? expr() : null;
      eat("end");
      return { k: "case", base, whens, else: otherwise };
    } finally {
      caseDepth--;
    }
  };
  const orderList = (): OrderBy[] => {
    const out: OrderBy[] = [];
    do {
      const e = expr();
      const desc = accept("desc");
      if (!desc) accept("asc");
      let nulls: OrderBy["nulls"];
      if (accept("nulls")) { const w = low(); if (w !== "first" && w !== "last") throw new CommandError("NULLS FIRST or NULLS LAST.", at()); i++; nulls = w; }
      out.push({ e, desc, nulls });
    } while (accept(","));
    return out;
  };
  const bound = (): Bound => {
    if (accept("unbounded")) { const w = low(); i++; return { k: "unbounded", n: w === "following" ? 1 : -1 }; }
    if (low() === "current") { i++; if (low() === "row") i++; return { k: "current", n: 0 }; }
    const t = peek();
    if (!t || !/^\d/.test(t.text)) throw new CommandError("A window frame bound: UNBOUNDED PRECEDING, n PRECEDING, CURRENT ROW, n FOLLOWING, UNBOUNDED FOLLOWING.", at());
    i++;
    const w = low();
    if (w !== "preceding" && w !== "following") throw new CommandError("After the number: PRECEDING or FOLLOWING.", at());
    i++;
    return { k: w, n: Number(t.text) };
  };
  /** f( … ) [WITHIN GROUP (ORDER BY …)] [FILTER (WHERE …)] [OVER (PARTITION BY … ORDER BY … [ROWS …])] */
  const call = (name: string): Expr => {
    const nameTok = peek()!;
    i += 2;
    const canon = fnName(name)!;
    let e: Extract<Expr, { k: "fn" }>;
    if (canon === "cast" || (canon === "convert" && !isTypeAhead())) {
      // CAST(x AS type) · TRY_CAST · MySQL CONVERT(x, type) / CONVERT(x USING utf8)
      const x = expr();
      let type = "varchar";
      if (canon === "cast") { eat("as"); type = typeName(); }
      else if (accept(",")) type = typeName();
      else if (accept("using")) { i++; type = "varchar"; }
      eat(")");
      e = { k: "fn", name: canon, args: [x, { k: "lit", v: type }, ...(canon === "convert" ? [{ k: "lit", v: null } as Expr] : []), ...(/^(try|safe)_/i.test(name) ? [{ k: "lit", v: "try" } as Expr] : [])], distinct: false };
      if (canon === "cast" && !/^(try|safe)_/i.test(name)) e.args = e.args.slice(0, 2);
    } else if (canon === "convert") {
      // SQL Server CONVERT(type, x [, style])
      const type = typeName();
      eat(",");
      const x = expr();
      const style = accept(",") ? expr() : ({ k: "lit", v: null } as Expr);
      eat(")");
      e = { k: "fn", name: canon, args: [x, { k: "lit", v: type }, style, ...(/^try_/i.test(name) ? [{ k: "lit", v: "try" } as Expr] : [])], distinct: false };
    } else if (canon === "extract") {
      const unit = tokens[i++]?.text ?? "";
      eat("from");
      const x = expr();
      eat(")");
      e = { k: "fn", name: canon, args: [{ k: "lit", v: unit.replace(/^'|'$/g, "") }, x], distinct: false };
    } else if (canon === "position" && !listHasComma()) {
      const needle = add();
      eat("in");
      const hay = expr();
      eat(")");
      e = { k: "fn", name: canon, args: [needle, hay], distinct: false };
    } else if (name.toLowerCase() === "strpos") {
      // STRPOS(text, needle): the other way round from POSITION
      const hay = expr(); eat(","); const needle = expr(); eat(")");
      e = { k: "fn", name: "position", args: [needle, hay], distinct: false };
    } else if (canon === "substring" && !listHasComma() && hasFromAhead()) {
      const x = expr();
      const args: Expr[] = [x];
      if (accept("from")) args.push(expr()); else args.push({ k: "lit", v: 1 });
      if (accept("for")) args.push(expr());
      eat(")");
      e = { k: "fn", name: canon, args, distinct: false };
    } else if (canon === "trim" && ["leading", "trailing", "both"].includes(low() ?? "") || (canon === "trim" && !listHasComma() && hasFromAhead())) {
      // TRIM([LEADING|TRAILING|BOTH] [chars] FROM text)
      const where = ["leading", "trailing", "both"].includes(low() ?? "") ? tokens[i++].text.toLowerCase() : "both";
      const chars = low() === "from" ? ({ k: "lit", v: null } as Expr) : expr();
      eat("from");
      const x = expr();
      eat(")");
      e = { k: "fn", name: canon, args: [x, chars, { k: "lit", v: where }], distinct: false };
    } else if (canon === "overlay" && !listHasComma()) {
      const x = expr(); eat("placing"); const ins = expr(); eat("from"); const st = expr();
      const args = [x, ins, st];
      if (accept("for")) args.push(expr());
      eat(")");
      e = { k: "fn", name: canon, args, distinct: false };
    } else {
      const distinct = accept("distinct");
      if (!distinct) accept("all");
      const args: Expr[] = [];
      if (peek()?.text !== ")" && low() !== "order") {
        do {
          // a bare date part first: DATEADD(day, 1, date), DATEDIFF(month, a, b)
          if (!args.length && UNIT_FIRST.has(canon) && peek() && isUnitWord(peek()!.text) && peek(1)?.text === "," && !(canon === "datediff" && countArgs() === 2) && !(canon === "trunc")) { args.push({ k: "lit", v: tokens[i++].text }); continue; }
          if (!args.length && UNIT_FIRST.has(canon) && peek() && isUnitWord(peek()!.text) && peek(1)?.text === ")" && canon === "trunc") { args.push({ k: "lit", v: tokens[i++].text }); continue; }
          if (!args.length && UNIT_FIRST.has(canon) && canon !== "trunc" && peek() && /^[A-Za-z_]\w*$/.test(peek()!.text) && peek(1)?.text === "," && !isUnitWord(peek()!.text) && !(tableCols as Set<string> | null)?.has(low()!))
            throw new CommandError(`${canon.toUpperCase()}: "${peek()!.text}" is not a date part (year, quarter, month, week, day, hour, minute, second).`, peek());
          args.push(expr());
        } while (accept(","));
      }
      const fe: Extract<Expr, { k: "fn" }> = { k: "fn", name: canon, args, distinct };
      if (accept("order")) { eat("by"); fe.order = orderList(); }
      if (accept("separator")) fe.sep = expr();
      eat(")");
      e = fe;
    }
    if (low() === "within" && low(1) === "group") { i += 2; eat("("); eat("order"); eat("by"); e.within = orderList(); eat(")"); }
    if (low() === "filter" && peek(1)?.text === "(") { i += 2; eat("where"); e.filter = expr(); eat(")"); }
    if (accept("over")) {
      eat("(");
      const w: Win = { partition: [], order: [], frame: null };
      if (accept("partition")) { eat("by"); do w.partition.push(expr()); while (accept(",")); }
      if (accept("order")) { eat("by"); w.order = orderList(); }
      if (low() === "rows" || low() === "range" || low() === "groups") {
        const rows = low() !== "range";
        i++;
        if (accept("between")) { const start = bound(); eat("and"); w.frame = { rows, start, end: bound() }; }
        else w.frame = { rows, start: bound(), end: { k: "current", n: 0 } };
      }
      eat(")");
      e.over = w;
    } else if (WINDOW_ONLY.has(e.name)) throw new CommandError(`${e.name.toUpperCase()}() needs OVER (…), e.g. ${functionInfo(e.name)?.sig}.`, nameTok);
    return e;
  };
  // look-aheads inside a call's brackets (i is just past "(")
  const scanCall = () => {
    let d = 0, commas = 0, from = false;
    for (let j = i; j < tokens.length; j++) {
      const x = tokens[j].text.toLowerCase();
      if (x === "(") d++;
      else if (x === ")") { if (!d) break; d--; }
      else if (!d && x === ",") commas++;
      else if (!d && x === "from") from = true;
    }
    return { commas, from };
  };
  const listHasComma = () => scanCall().commas > 0;
  const hasFromAhead = () => scanCall().from;
  const countArgs = () => scanCall().commas + 1;
  const isTypeAhead = () => {
    const w = low();
    return Boolean(w && /^(n?var)?char|varchar2|nvarchar|text|int|integer|bigint|smallint|tinyint|decimal|numeric|float|real|double|money|date|datetime2?|smalldatetime|time|timestamp|bit|bool(ean)?|signed|unsigned|binary|varbinary|uniqueidentifier$/.test(w) && (peek(1)?.text === "," || peek(1)?.text === "("));
  };
  // the table named so far (FROM / UPDATE / DELETE FROM come before WHERE): its column names
  let tableCols: Set<string> | null = null;
  const knowTable = (name: string) => {
    try { tableCols = new Set(findTable(name).cols.map((c) => c.name.toLowerCase())); } catch { tableCols = null; }
  };
  /** One value of a list: (INB-01, 'INB-02', 26). A bare word that is not a column of the table is
   * taken as text as typed, up to the next comma: names need no quotes in a list. */
  const listItem = (): Expr => {
    const t = peek();
    if (t && /^[A-Za-z]/.test(t.text) && !(isFunction(t.text) && peek(1)?.text === "(")) {
      let j = i, depth = 0;
      while (j < tokens.length && !(depth === 0 && (tokens[j].text === "," || tokens[j].text === ")"))) {
        if (tokens[j].text === "(") depth++;
        if (tokens[j].text === ")") depth--;
        j++;
      }
      const raw = src.slice(t.start, tokens[j - 1].end).trim();
      const asCol = raw.toLowerCase().replace(/\s+/g, "_");
      if (!tableCols || !(tableCols.has(asCol) || tableCols.has(raw.toLowerCase()))) { i = j; return { k: "lit", v: raw }; }
    }
    return expr();
  };
  const list = (): Expr[] => { eat("("); const l = [listItem()]; while (accept(",")) l.push(listItem()); eat(")"); return l; };
  /** "( a, b )" coming: a list (a comma at its own level), not a bracketed expression. */
  const listAhead = (): boolean => {
    if (peek()?.text !== "(") return false;
    let depth = 0;
    for (let j = i; j < tokens.length; j++) {
      const x = tokens[j].text;
      if (x === "(") depth++;
      else if (x === ")") { depth--; if (!depth) return false; }
      else if (x === "," && depth === 1) return true;
    }
    return false;
  };
  const mul = (): Expr => {
    let e = unary();
    while (["*", "/", "%"].includes(peek()?.text ?? "") || low() === "div" || (low() === "mod" && peek(1)?.text !== "(")) {
      const op = tokens[i++].text.toLowerCase();
      e = op === "mod" || op === "%" ? { k: "fn", name: "mod", args: [e, unary()], distinct: false } : op === "div" ? { k: "fn", name: "div", args: [e, unary()], distinct: false } : { k: "bin", op, l: e, r: unary() };
    }
    return e;
  };
  const add = (): Expr => { let e = mul(); while (["+", "-", "||"].includes(peek()?.text ?? "")) { const op = tokens[i++].text; e = { k: "bin", op, l: e, r: mul() }; } return e; };
  const cmp = (): Expr => {
    const e = add();
    const neg = low() === "not" && ["like", "in", "between", "regexp", "rlike", "ilike", "similar"].includes(low(1) ?? "") ? (i++, true) : false;
    if (accept("like") || accept("ilike")) { const pat = add(); if (accept("escape")) i++; return { k: "like", e, pat, neg }; }
    if (accept("regexp") || accept("rlike")) return { k: "regexp", e, pat: add(), neg };
    if (accept("similar")) { eat("to"); const pat = add(); return { k: "regexp", e, pat: { k: "fn", name: "similar_to_regex", args: [pat], distinct: false }, neg }; }
    if (peek()?.text === "~" || (peek()?.text === "!" && peek(1)?.text === "~")) {
      const not = peek()!.text === "!"; if (not) i++; i++;
      const ci = peek()?.text === "*" ? (i++, true) : false;
      const pat = add();
      return { k: "regexp", e, pat: ci ? pat : { k: "fn", name: "regex_case", args: [pat], distinct: false }, neg: not };
    }
    if (low() === "is" && (low(1) === "distinct" || (low(1) === "not" && low(2) === "distinct"))) {
      i++; const n = accept("not"); eat("distinct"); eat("from");
      return { k: "distinctfrom", l: e, r: add(), neg: n };
    }
    if (low() === "is" && (["true", "false"].includes(low(1) ?? "") || (low(1) === "not" && ["true", "false"].includes(low(2) ?? "")))) {
      i++; const n = accept("not"); const want = low() === "true"; i++;
      const test: Expr = { k: "bin", op: "=", l: { k: "fn", name: "if", args: [e, { k: "lit", v: 1 }, { k: "lit", v: 0 }], distinct: false }, r: { k: "lit", v: want ? 1 : 0 } };
      return n ? { k: "not", e: test } : test;
    }
    if (peek()?.text === "<=" && peek(1)?.text === ">" && peek(1)!.start === peek()!.end) { i += 2; return { k: "distinctfrom", l: e, r: add(), neg: true }; }
    if (accept("in")) return { k: "in", e, list: list(), neg };
    if (accept("between")) { const lo = add(); eat("and"); return { k: "between", e, lo, hi: add(), neg }; }
    if (accept("is")) { const n = accept("not"); eat("null"); return { k: "isnull", e, neg: n }; }
    const op = peek()?.text;
    // "calling_name = (INB-01, INB-02)": the same as IN (…)
    if (op && ["=", "==", "!=", "<>"].includes(op) && (i++, listAhead())) return { k: "in", e, list: list(), neg: op === "!=" || op === "<>" };
    if (op && ["=", "==", "!=", "<>"].includes(op)) i--;
    if (op && ["=", "==", "!=", "<>", "<", ">", "<=", ">="].includes(op)) { i++; return { k: "bin", op: op === "==" ? "=" : op === "<>" ? "!=" : op, l: e, r: add() }; }
    return e;
  };
  const not = (): Expr => (accept("not") ? { k: "not", e: not() } : cmp());
  const and = (): Expr => { let e = not(); while (accept("and")) e = { k: "bin", op: "and", l: e, r: not() }; return e; };
  const expr = (): Expr => { let e = and(); while (accept("or")) e = { k: "bin", op: "or", l: e, r: and() }; return e; };

  const first = low();
  let st: Statement;
  if (first === "select") {
    i++;
    const distinct = accept("distinct");
    let items: Select["items"];
    if (peek()?.text === "*" && (low(1) === "from" || !peek(1))) { i++; items = "*"; }
    else {
      items = [];
      do {
        const start = peek()!.start;
        const e = expr();
        const text = src.slice(start, tokens[i - 1].end).trim();
        let alias: string | null = null;
        if (accept("as")) alias = /^['"`[]/.test(peek()?.text ?? "") ? tokens[i++].text.slice(1, -1) : ident();
        else if (peek() && /^[A-Za-z_`"[]/.test(peek()!.text) && !KW.has(low()!)) alias = /^['"`[]/.test(peek()!.text) ? tokens[i++].text.slice(1, -1) : ident();
        items.push({ e, alias, text });
      } while (accept(","));
    }
    // SELECT UPPER('abc') with no FROM (or FROM dual): one row to try functions on
    const table = accept("from") ? ident() : "dual";
    knowTable(table);
    const where = accept("where") ? expr() : null;
    const group: Expr[] = [];
    if (accept("group")) { eat("by"); do group.push(expr()); while (accept(",")); }
    const having = accept("having") ? expr() : null;
    const order: Select["order"] = [];
    if (accept("order")) { eat("by"); order.push(...orderList()); }
    let limit: number | null = null, offset = 0;
    if (accept("limit")) { limit = Number(tokens[i++]?.text); if (accept(",")) { offset = limit; limit = Number(tokens[i++]?.text); } if (accept("offset")) offset = Number(tokens[i++]?.text); }
    st = { kind: "select", table, distinct, items, where, group, having, order, limit, offset };
  } else if (first === "insert") {
    i++; eat("into");
    const table = ident();
    let cols: string[] | null = null;
    if (accept("(")) { cols = [ident()]; while (accept(",")) cols.push(ident()); eat(")"); }
    eat("values");
    const rows: Expr[][] = [];
    do { eat("("); const r = [expr()]; while (accept(",")) r.push(expr()); eat(")"); rows.push(r); } while (accept(","));
    st = { kind: "insert", table, cols, rows };
  } else if (first === "update") {
    i++;
    // "UPDATE code = 'X' FROM entries WHERE …" (or without SET): say the right order with their words
    const fromAt = src.search(/\bfrom\s+[`"\w]+/i);
    if (!/^\s*update\s+[`"\w]+\s+set\b/i.test(src) && fromAt > 0) {
      const table = src.slice(fromAt).match(/^from\s+([`"\w]+)/i)![1];
      const setPart = src.replace(/^\s*update\s+(set\s+)?/i, "").slice(0, src.slice(0, fromAt).replace(/^\s*update\s+(set\s+)?/i, "").length).trim();
      const rest = src.slice(fromAt).replace(/^from\s+[`"\w]+\s*/i, "").trim();
      throw new CommandError(`UPDATE has no FROM: the table comes right after UPDATE, then SET. Write: UPDATE ${table} SET ${setPart}${rest ? ` ${rest}` : ""}`);
    }
    const table = ident();
    if (low() !== "set") {
      const name = src.match(/^\s*update\s+([`"\w]+)/i)?.[1] ?? table;
      throw new CommandError(`After UPDATE ${name} comes SET, e.g. UPDATE ${name} SET out = '20:00' WHERE calling_name = 'INB-01'.`);
    }
    eat("set");
    knowTable(table);
    const sets: Update["sets"] = [];
    do { const c = ident(); if (!accept("=")) eat("="); sets.push({ col: c, e: expr() }); } while (accept(","));
    st = { kind: "update", table, sets, where: accept("where") ? expr() : null };
  } else if (first === "delete") {
    i++; eat("from");
    const table = ident();
    knowTable(table);
    st = { kind: "delete", table, where: accept("where") ? expr() : null };
  } else throw new CommandError(`"${peek()?.text}" does not start an SQL statement: use SELECT, INSERT, UPDATE or DELETE.`, peek());
  if (i < tokens.length) throw new CommandError(`"${tokens[i].text}" is not understood here.`, tokens[i]);
  return st;
}

// --- evaluating --------------------------------------------------------------------------------

type Val = string | number | null;

const timeText = (h: number) => `${String(Math.floor((h % 24) + 1e-9)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}:00`;
function rowDateTime(row: Row, h: number): string {
  const day = h >= 24 ? new Date(`${row.date}T00:00:00`) : null;
  if (day) day.setDate(day.getDate() + 1);
  return `${day ? iso(day) : row.date} ${timeText(h)}`;
}
/** '2026-10-01 07:30:00' -> {date, hours}; '07:30' / 7.5 -> {hours}. */
function timeLiteral(v: Val): { date: string | null; hours: number } | null {
  if (typeof v === "number") return { date: null, hours: v };
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return { date: m[1], hours: m[2] !== undefined ? Number(m[2]) + Number(m[3]) / 60 : 0 };
  const h = parseClock(v);
  return h === null ? null : { date: null, hours: h };
}

interface Env {
  t: TableDef;
  row: Row;
  group: Row[] | null;
  idx?: number; // this row's place among the rows windows run over
  wins?: Map<Expr, Val[]>; // window function values, by expression
}

function colOf(env: Env, e: Expr): ColDef | null {
  return e.k === "col" ? findCol(env.t, e.name) : null;
}

function evaluate(e: Expr, env: Env): Val {
  switch (e.k) {
    case "lit": return e.v;
    case "star": return 1;
    case "col": return env.row[findCol(env.t, e.name).name] ?? null;
    case "neg": { const v = evaluate(e.e, env); return v === null ? null : -Number(v); }
    case "not": return truthy(evaluate(e.e, env)) ? 0 : 1;
    case "isnull": { const v = evaluate(e.e, env); return (v === null || v === "") !== e.neg ? 1 : 0; }
    case "in": return e.list.some((x) => compare(e.e, x, "=", env)) !== e.neg ? 1 : 0;
    case "between": return (compare(e.e, e.lo, ">=", env) && compare(e.e, e.hi, "<=", env)) !== e.neg ? 1 : 0;
    case "like": {
      const c = colOf(env, e.e);
      let v = evaluate(e.e, env);
      const p = String(evaluate(e.pat, env) ?? "");
      if (c?.type === "time" && typeof v === "number") v = /^\d{4}-/.test(p) ? rowDateTime(env.row, v) : formatClock(v);
      if (v === null) return 0;
      const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\*]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
      return re.test(String(v)) !== e.neg ? 1 : 0;
    }
    case "bin": {
      if (e.op === "and") return truthy(evaluate(e.l, env)) && truthy(evaluate(e.r, env)) ? 1 : 0;
      if (e.op === "or") return truthy(evaluate(e.l, env)) || truthy(evaluate(e.r, env)) ? 1 : 0;
      if (["=", "!=", "<", ">", "<=", ">="].includes(e.op)) return compare(e.l, e.r, e.op, env) ? 1 : 0;
      const a = evaluate(e.l, env), b = evaluate(e.r, env);
      if (e.op === "||") return a === null || b === null ? null : `${a}${b}`;
      if (a === null || b === null) return null;
      if (e.op === "+" || e.op === "-") {
        try {
          const d = dateArith(a, b, e.op);
          if (d !== undefined) return d;
        } catch (err) {
          if (err instanceof SqlFnError) throw new CommandError(err.message);
          throw err;
        }
        const isDate = (v: Val) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
        if (isDate(a) && typeof b === "number") return callScalar("date_add", [a, intervalText(e.op === "+" ? b : -b, "day")]); // date + 7: a week later
        if (e.op === "-" && isDate(a) && isDate(b)) return callScalar("datediff", [a, b]); // date - date: days
        // SQL Server: 'a' + 'b' joins texts
        if (e.op === "+" && typeof a === "string" && typeof b === "string" && (Number.isNaN(Number(a)) || Number.isNaN(Number(b)) || a.trim() === "" || b.trim() === "")) return a + b;
      }
      const x = Number(a), y = Number(b);
      if (Number.isNaN(x) || Number.isNaN(y)) throw new CommandError(`"${Number.isNaN(x) ? a : b}" is not a number (${e.op}).`);
      return e.op === "+" ? x + y : e.op === "-" ? x - y : e.op === "*" ? x * y : y === 0 ? null : x / y;
    }
    case "fn": {
      if (e.over) {
        const vals = env.wins?.get(e);
        if (!vals || env.idx === undefined) throw new CommandError(`${e.name.toUpperCase()} … OVER (…) works in the SELECT list and ORDER BY, not in WHERE (filter on it with a sub-step: not available here).`);
        return vals[env.idx];
      }
      if (e.name === "__envval") { const m = (env.row as unknown as { __env?: number }).__env; return evaluate(e.args[0], m === undefined ? env : windowEnvs[m]); }
      if (isAggName(e.name)) return aggregateOver(e, env.group ?? [env.row], env);
      try {
        return callScalar(e.name, e.args.map((a) => evaluate(a, env)));
      } catch (err) {
        if (err instanceof SqlFnError) throw new CommandError(err.message);
        throw err;
      }
    }
    case "case": {
      if (e.base) {
        for (const [w, v] of e.whens) if (compare(e.base, w, "=", env)) return evaluate(v, env);
      } else for (const [w, v] of e.whens) if (truthy(evaluate(w, env))) return evaluate(v, env);
      return e.else ? evaluate(e.else, env) : null;
    }
    case "regexp": {
      const v = evaluate(e.e, env);
      if (v === null) return null;
      let flags = "i", pat: Expr = e.pat;
      if (pat.k === "fn" && pat.name === "regex_case") { flags = ""; pat = pat.args[0]; }
      let p = String(evaluate(pat.k === "fn" && pat.name === "similar_to_regex" ? pat.args[0] : pat, env) ?? "");
      if (pat.k === "fn" && pat.name === "similar_to_regex") p = `^(?:${p.replace(/[.^$\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")})$`;
      let re: RegExp;
      try { re = new RegExp(p, flags); } catch { throw new CommandError(`"${p}" is not a valid regular expression.`); }
      return re.test(typeof v === "number" ? String(v) : v) !== e.neg ? 1 : 0;
    }
    case "distinctfrom": {
      const a = evaluate(e.l, env), b = evaluate(e.r, env);
      const same = a === null || b === null ? a === b : compare(e.l, e.r, "=", env);
      return (same ? e.neg : !e.neg) ? 1 : 0; // IS NOT DISTINCT FROM / <=> : 1 when the same
    }
  }
}
const truthy = (v: Val) => v !== null && v !== 0 && v !== "" && v !== "0";

/** Sort helper shared by ORDER BY and windows: numbers as numbers, text with numbers in order;
 * NULLs last ascending (first descending) unless NULLS FIRST / LAST says otherwise. */
function compareVals(x: Val, y: Val, desc: boolean, nulls?: "first" | "last"): number {
  if (x === y) return 0;
  const nullsFirst = nulls ? nulls === "first" : desc;
  if (x === null) return nullsFirst ? -1 : 1;
  if (y === null) return nullsFirst ? 1 : -1;
  const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
  return desc ? -c : c;
}
const sortEnvs = <T,>(list: T[], order: OrderBy[], envOf: (x: T) => Env): T[] =>
  order.length
    ? list.map((x) => ({ x, keys: order.map((o) => evaluate(o.e, envOf(x))) })).sort((a, b) => { for (let k = 0; k < order.length; k++) { const c = compareVals(a.keys[k], b.keys[k], order[k].desc, order[k].nulls); if (c) return c; } return 0; }).map((o) => o.x)
    : list;

/** An aggregate over rows (a group, or a window frame), with DISTINCT, ORDER BY, SEPARATOR,
 * WITHIN GROUP and FILTER. */
function aggregateOver(e: Extract<Expr, { k: "fn" }>, rows: Row[], env: Env): Val {
  const sub = (row: Row): Env => ({ ...env, row, group: null, idx: undefined });
  let list = e.filter ? rows.filter((r) => truthy(evaluate(e.filter!, sub(r)))) : rows;
  if (e.order?.length) list = sortEnvs(list, e.order, sub);
  const name = e.name;
  const star = !e.args.length || e.args[0]?.k === "star";
  try {
    if (e.within) {
      // PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY x), MODE() WITHIN GROUP, LISTAGG(x, ', ') WITHIN GROUP (ORDER BY …)
      list = sortEnvs(list, e.within, sub);
      if (name === "listagg") return aggregate(name, list.map((r) => evaluate(e.args[0], sub(r))), { distinct: e.distinct, sep: e.args[1] ? String(evaluate(e.args[1], env) ?? "") : "" });
      const param = e.args[0] ? evaluate(e.args[0], env) : null;
      const vals = list.map((r) => evaluate(e.within![0].e, sub(r)));
      return aggregate(name, e.within[0].desc && name.startsWith("percentile") ? [...vals].reverse() : vals, { param });
    }
    const vals = star ? list.map(() => 1 as Val) : list.map((r) => evaluate(e.args[0], sub(r)));
    const sep = e.sep ? String(evaluate(e.sep, env) ?? "") : ["string_agg", "listagg"].includes(name) && e.args[1] ? String(evaluate(e.args[1], env) ?? "") : undefined;
    const xs = ["corr", "covar_pop", "covar_samp", "regr_slope", "regr_intercept", "regr_count", "regr_r2"].includes(name) ? list.map((r) => evaluate(e.args[1] ?? e.args[0], sub(r))) : undefined;
    const param = ["percentile_cont", "percentile_disc"].includes(name) ? (e.args[1] ? evaluate(e.args[1], env) : null) : undefined;
    return aggregate(name, vals, { star, rows: list.length, distinct: e.distinct, sep, xs, param });
  } catch (err) {
    if (err instanceof SqlFnError) throw new CommandError(err.message);
    throw err;
  }
}

/** Every window function in these expressions, worked out over the rows (row envs, or group envs
 * after GROUP BY): partitions, order, frames. */
function computeWindows(exprs: Expr[], envs: Env[]): void {
  const wins: Extract<Expr, { k: "fn" }>[] = [];
  const walk = (e: Expr | null | undefined): void => {
    if (!e) return;
    if (e.k === "fn") { if (e.over) wins.push(e); else e.args.forEach(walk); }
    else if (e.k === "bin" || e.k === "distinctfrom") { walk(e.l); walk(e.r); }
    else if (e.k === "not" || e.k === "neg") walk(e.e);
    else if (e.k === "case") { walk(e.base); e.whens.forEach(([a, b]) => { walk(a); walk(b); }); walk(e.else); }
    else if (e.k === "in") { walk(e.e); e.list.forEach(walk); }
    else if (e.k === "between") { walk(e.e); walk(e.lo); walk(e.hi); }
    else if (e.k === "like" || e.k === "regexp") { walk(e.e); walk(e.pat); }
    else if (e.k === "isnull") walk(e.e);
  };
  exprs.forEach(walk);
  if (!wins.length) return;
  const map = new Map<Expr, Val[]>();
  envs.forEach((env, n) => { env.idx = n; env.wins = map; });
  windowEnvs = envs;
  for (const w of wins) {
    const out: Val[] = Array(envs.length).fill(null);
    const parts = new Map<string, number[]>();
    envs.forEach((env, n) => {
      const key = JSON.stringify(w.over!.partition.map((p) => evaluate(p, env)));
      parts.set(key, [...(parts.get(key) ?? []), n]);
    });
    const order = w.over!.order;
    for (const idxs of parts.values()) {
      const sorted = sortEnvs(idxs, order, (n) => envs[n]);
      const keys = sorted.map((n) => JSON.stringify(order.map((o) => evaluate(o.e, envs[n]))));
      const N = sorted.length;
      // peers: rows with the same ORDER BY values
      const peerEnd = (p: number) => { let q = p; while (q + 1 < N && keys[q + 1] === keys[p]) q++; return q; };
      const peerStart = (p: number) => { let q = p; while (q > 0 && keys[q - 1] === keys[p]) q--; return q; };
      const frameOf = (p: number): [number, number] => {
        const f = w.over!.frame;
        if (!f) return order.length ? [0, peerEnd(p)] : [0, N - 1]; // default: up to this row's peers, or the whole partition
        const at = (b: Bound, isStart: boolean) =>
          b.k === "unbounded" ? (b.n < 0 ? 0 : N - 1) : b.k === "current" ? (f.rows ? p : isStart ? peerStart(p) : peerEnd(p)) : b.k === "preceding" ? p - b.n : p + b.n;
        return [Math.max(0, at(f.start, true)), Math.min(N - 1, at(f.end, false))];
      };
      const arg = (k: number, n: number) => (w.args[k] ? evaluate(w.args[k], envs[n]) : null);
      sorted.forEach((n, p) => {
        let v: Val = null;
        switch (w.name) {
          case "row_number": v = p + 1; break;
          case "rank": v = peerStart(p) + 1; break;
          case "dense_rank": v = new Set(keys.slice(0, p + 1)).size; break;
          case "percent_rank": v = N > 1 ? Math.round((peerStart(p) / (N - 1)) * 1e6) / 1e6 : 0; break;
          case "cume_dist": v = Math.round(((peerEnd(p) + 1) / N) * 1e6) / 1e6; break;
          case "ntile": {
            const b = Math.max(1, Math.trunc(Number(arg(0, n) ?? 1))), q = Math.floor(N / b), r = N % b;
            v = p < r * (q + 1) ? Math.floor(p / (q + 1)) + 1 : r + Math.floor((p - r * (q + 1)) / Math.max(q, 1)) + 1;
            break;
          }
          case "lag": case "lead": {
            const off = w.args[1] ? Math.trunc(Number(evaluate(w.args[1], envs[n]))) : 1;
            const t = w.name === "lag" ? p - off : p + off;
            v = t >= 0 && t < N ? evaluate(w.args[0], envs[sorted[t]]) : w.args[2] ? evaluate(w.args[2], envs[n]) : null;
            break;
          }
          case "first_value": case "last_value": case "nth_value": {
            const [a, b] = frameOf(p);
            const k = w.name === "first_value" ? a : w.name === "last_value" ? b : a + Math.trunc(Number(arg(1, n) ?? 1)) - 1;
            v = k >= a && k <= b ? evaluate(w.args[0], envs[sorted[k]]) : null;
            break;
          }
          default: {
            if (!isAggName(w.name)) throw new CommandError(`${w.name.toUpperCase()} cannot be used with OVER (…).`);
            const [a, b] = frameOf(p);
            const frame = sorted.slice(a, b + 1);
            const plain: Extract<Expr, { k: "fn" }> = { ...w, over: undefined };
            if (envs[n].group) {
              // after GROUP BY each row is a group: SUM(SUM(hours)) OVER (…) runs over the groups' values
              const rowsOf = frame.map((m) => ({ __env: m } as unknown as Row));
              const wrap = (x: Expr): Expr => ({ k: "fn", name: "__envval", args: [x], distinct: false });
              v = aggregateOver({ ...plain, args: plain.args.map(wrap), filter: plain.filter && wrap(plain.filter) }, rowsOf, { ...envs[n], group: null });
            } else v = aggregateOver(plain, frame.map((m) => envs[m].row), { ...envs[n], group: null });
          }
        }
        out[n] = v;
      });
    }
    map.set(w, out);
  }
}
/** The envs the current window aggregate runs over (rows carry an index into them). */
let windowEnvs: Env[] = [];

function compare(l: Expr, r: Expr, op: string, env: Env): boolean {
  const lc = colOf(env, l), rc = colOf(env, r);
  let a = evaluate(l, env), b = evaluate(r, env);
  if (a === null || b === null) return op === "!=" ? a !== b : false;
  const timeSide = lc?.type === "time" ? "l" : rc?.type === "time" ? "r" : null;
  if (timeSide) {
    // a time column against '2026-10-01 07:00:00' (date and time) or '07:00' / 7
    const colVal = (timeSide === "l" ? a : b) as number;
    const lit = timeLiteral(timeSide === "l" ? b : a);
    if (!lit) throw new CommandError(`"${timeSide === "l" ? b : a}" is not a time.`);
    let x: Val = colVal, y: Val = lit.hours;
    if (lit.date) { x = rowDateTime(env.row, colVal); y = `${lit.date} ${timeText(lit.hours)}`; }
    else if (colVal >= 24 && lit.hours < 24) x = colVal - 24; // an overnight Out compared by its clock time
    [a, b] = timeSide === "l" ? [x, y] : [y, x];
  }
  // entries.code is all of a worker's codes for the day joined with "+": = finds the worker when
  // the code is one of them, != when it is none of them
  if ((op === "=" || op === "!=") && (lc?.name === "code" || rc?.name === "code") && typeof a === "string" && typeof b === "string") {
    const [cell, want] = lc?.name === "code" ? [a, b] : [b, a];
    if (cell.includes("+") && !want.includes("+")) {
      const hit = cell.split("+").some((p) => codeKey(p) === codeKey(want));
      return op === "=" ? hit : !hit;
    }
  }
  // a code compares as a code: case, spaces and look-alike dashes in the sheet ignored
  if ((lc?.name === "code" || rc?.name === "code") && typeof a === "string" && typeof b === "string") [a, b] = [codeKey(a), codeKey(b)];
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "" && !Number.isNaN(Number(b))) b = Number(b);
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && !Number.isNaN(Number(a))) a = Number(a);
  const c = typeof a === "number" && typeof b === "number" ? (Math.abs(a - b) < 1e-6 ? 0 : a - b) : String(a).toUpperCase().localeCompare(String(b).toUpperCase());
  return op === "=" ? c === 0 : op === "!=" ? c !== 0 : op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
}

const hasAgg = (e: Expr | null | undefined): boolean => {
  if (!e) return false;
  switch (e.k) {
    case "fn": return (isAggName(e.name) && !e.over) || e.args.some(hasAgg);
    case "bin": case "distinctfrom": return hasAgg(e.l) || hasAgg(e.r);
    case "not": case "neg": case "isnull": return hasAgg(e.e);
    case "case": return hasAgg(e.base) || e.whens.some(([a, b]) => hasAgg(a) || hasAgg(b)) || hasAgg(e.else);
    case "in": return hasAgg(e.e) || e.list.some(hasAgg);
    case "between": return hasAgg(e.e) || hasAgg(e.lo) || hasAgg(e.hi);
    case "like": case "regexp": return hasAgg(e.e) || hasAgg(e.pat);
    default: return false;
  }
};

function display(v: Val, c: ColDef | null): string | number | null {
  if (v === null) return null;
  if (c?.type === "time" && typeof v === "number") return `${formatClock(v)}${v >= 24 ? " (+1)" : ""}`;
  // a column's hours to 2 decimals; a worked-out value as the expression says (float noise trimmed)
  if (typeof v === "number") return Number.isInteger(v) ? v : c ? Math.round(v * 100) / 100 : Math.round(v * 1e10) / 1e10;
  return v;
}

// --- running -------------------------------------------------------------------------------------

/** Text pasted from a chat, Word or a web page: curly quotes, look-alike dashes and odd spaces
 * made plain (one character for one, so error positions still point at the right place). A code
 * typed with a non-breaking hyphen looks the same but matches nothing. */
export function cleanPasted(src: string): string {
  return src
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212\ufe63\uff0d]/g, "-")
    .replace(/[\u00a0\u2007\u202f\u2009\u200a]/g, " ")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, " ");
}

/** Names in a WHERE (calling_name = 'X' / IN (…)) that are no worker in Labour Detail: said, with
 * the workers they start, so "AAW" does not quietly match nothing. */
function unknownNameNotes(where: Expr | null, ctx: CommandContext): string[] {
  const names: string[] = [];
  const isName = (e: Expr) => e.k === "col" && ["calling_name", "calling name"].includes(e.name.toLowerCase());
  const lit = (e: Expr) => (e.k === "lit" && typeof e.v === "string" ? e.v : null);
  const walk = (e: Expr | null): void => {
    if (!e) return;
    if (e.k === "bin" && (e.op === "and" || e.op === "or")) { walk(e.l); walk(e.r); }
    else if (e.k === "bin" && e.op === "=" && isName(e.l) && lit(e.r)) names.push(lit(e.r)!);
    else if (e.k === "in" && !e.neg && isName(e.e)) e.list.forEach((x) => lit(x) && names.push(lit(x)!));
  };
  walk(where);
  const known = new Set(ctx.workers.map((w) => w.calling_name.toUpperCase()));
  return names
    .filter((n) => !known.has(n.trim().toUpperCase()))
    .map((n) => {
      const starts = ctx.workers.filter((w) => w.calling_name.toUpperCase().startsWith(n.trim().toUpperCase())).map((w) => w.calling_name);
      const hint = didYouMean(n.trim().toUpperCase(), known);
      return starts.length
        ? `"${n}" is not a calling name: ${starts.length} start with it (${starts.slice(0, 5).join(", ")}${starts.length > 5 ? " …" : ""}). For all of them: calling_name LIKE '${n.trim()}%'.`
        : `"${n}" is not a calling name in Labour Detail${hint ? ` (did you mean ${hint}?)` : ""}.`;
    });
}

/** The supervisors with entries this month, A–Z. */
function supervisorNames(ctx: CommandContext): string[] {
  return [...new Set(ctx.owners?.values() ?? [])].sort((a, b) => a.localeCompare(b));
}

/** supervisor = 'Kamall' (or no supervisor pushed yet): say who there is. */
function unknownSupervisorNotes(where: Expr | null, ctx: CommandContext): string[] {
  const asked: string[] = [];
  const isSup = (e: Expr) => e.k === "col" && norm(e.name) !== "" && SUPERVISOR.aliases.concat("supervisor").some((a) => norm(a) === norm(e.name));
  const lit = (e: Expr) => (e.k === "lit" && typeof e.v === "string" ? e.v : null);
  const walk = (e: Expr | null): void => {
    if (!e) return;
    if (e.k === "bin" && (e.op === "and" || e.op === "or")) { walk(e.l); walk(e.r); }
    else if (e.k === "bin" && e.op === "=" && isSup(e.l) && lit(e.r)) asked.push(lit(e.r)!);
    else if (e.k === "in" && !e.neg && isSup(e.e)) e.list.forEach((x) => lit(x) && asked.push(lit(x)!));
  };
  walk(where);
  if (!asked.length) return [];
  const names = supervisorNames(ctx);
  if (!names.length) return ["No entries this month were pushed with a supervisor yet: the supervisor column is empty until a manpower sheet is pushed with one (Entry → Push)."];
  const known = new Set(names.map((n) => n.toUpperCase()));
  return asked
    .filter((n) => !known.has(n.trim().toUpperCase()))
    .map((n) => {
      const part = names.filter((x) => x.toUpperCase().includes(n.trim().toUpperCase()));
      const hint = didYouMean(n.trim(), names);
      return part.length
        ? `No supervisor is called "${n}" exactly: ${part.slice(0, 5).join(", ")} ${part.length === 1 ? "contains" : "contain"} it. For all of them: supervisor LIKE '%${n.trim()}%'.`
        : `"${n}" has no entries this month${hint ? ` (did you mean ${hint}?)` : ""}. Supervisors: ${names.slice(0, 8).join(", ")}${names.length > 8 ? " …" : ""}.`;
    });
}

/** The codes a WHERE asks for (code = 'X', code IN (…), code LIKE 'X%'; not under NOT), as tests
 * on one activity line's code. */
function codeMatchers(where: Expr | null): ((code: string) => boolean)[] {
  const out: ((code: string) => boolean)[] = [];
  const isCode = (e: Expr) => e.k === "col" && e.name.toLowerCase() === "code";
  const lit = (e: Expr) => (e.k === "lit" && typeof e.v === "string" ? e.v : null);
  const eq = (v: string) => (c: string) => codeKey(c) === codeKey(v);
  const walk = (e: Expr | null): void => {
    if (!e) return;
    if (e.k === "bin" && (e.op === "and" || e.op === "or")) { walk(e.l); walk(e.r); }
    else if (e.k === "bin" && e.op === "=") {
      const v = isCode(e.l) ? lit(e.r) : isCode(e.r) ? lit(e.l) : null;
      if (v) out.push(eq(v));
    } else if (e.k === "in" && !e.neg && isCode(e.e)) e.list.forEach((x) => { const v = lit(x); if (v) out.push(eq(v)); });
    else if (e.k === "like" && !e.neg && isCode(e.e) && lit(e.pat)) {
      const re = new RegExp(`^${lit(e.pat)!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
      out.push((c) => re.test(c.trim()));
    }
  };
  walk(where);
  return out;
}

/** A SELECT on a code found nothing: the codes in this workbook that look like the one asked for,
 * and why "=" may have missed them. */
function emptyCodeNotes(where: Expr, tableName: string, ctx: CommandContext): string[] {
  const asked: string[] = [];
  const isCode = (e: Expr) => e.k === "col" && e.name.toLowerCase() === "code";
  const lit = (e: Expr) => (e.k === "lit" && typeof e.v === "string" ? e.v : null);
  const walk = (e: Expr | null): void => {
    if (!e) return;
    if (e.k === "bin") {
      if (e.op === "=" && isCode(e.l) && lit(e.r)) asked.push(lit(e.r)!);
      else if (e.op === "=" && isCode(e.r) && lit(e.l)) asked.push(lit(e.l)!);
      else { walk(e.l); walk(e.r); }
    } else if (e.k === "like" && isCode(e.e) && lit(e.pat)) asked.push(lit(e.pat)!);
    else if (e.k === "in" && isCode(e.e)) e.list.forEach((x) => lit(x) && asked.push(lit(x)!));
    else if (e.k === "not") walk(e.e);
  };
  walk(where);
  if (!asked.length) return [];
  const used = new Map<string, number>();
  for (const r of entryRows(ctx)) for (const a of r.input.activities) if (a.code) used.set(a.code.trim(), (used.get(a.code.trim()) ?? 0) + 1);
  for (const c of ctx.activities) if (!used.has(c)) used.set(c, 0);
  const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const notes: string[] = [];
  for (const q of [...new Set(asked)]) {
    const key = norm(q.replace(/[%_]/g, ""));
    if (!key) continue;
    const like = [...used].filter(([c]) => norm(c).includes(key) || (norm(c).length >= 6 && key.includes(norm(c)))).sort((a, b) => b[1] - a[1]);
    if (!like.length) {
      notes.push(`No code like "${q}" is used or listed in this workbook (${used.size} codes). Check the code, or that the right workbook is open.`);
      continue;
    }
    const shown = like.slice(0, 6).map(([c, n]) => `${c} (${n ? `${n} line${n === 1 ? "" : "s"}` : "listed, not used yet"})`).join(", ");
    notes.push(`Codes like "${q}" in this workbook: ${shown}${like.length > 6 ? ", …" : ""}.`);
    if (tableName === "entries")
      notes.push(`In entries, "code" holds all of a worker's codes for the day joined with "+" (e.g. "${like[0][0]}+…"), so "=" only finds workers with that one code. Use the activities table (one row per code), or LIKE '%${q.replace(/[%_]/g, "")}%'.`);
    else if (!q.includes("%")) notes.push(`"=" needs the whole code, place ending too: LIKE '${q}%' also finds ${like[0][0]}.`);
  }
  return notes;
}

/** "Kamal" in double quotes where a value goes (after =, in IN (…), LIKE, BETWEEN, SET x =): a
 * text value, as MySQL reads it, unless it is exactly a column's name. */
function quotedValues(st: Statement, t: TableDef): void {
  const own = new Set(t.cols.map((c) => norm(c.name)));
  const isCol = (e: Expr) => {
    if (e.k !== "col") return false;
    try { findCol(t, e.name); return true; } catch { return false; }
  };
  const asValue = (e: Expr): void => {
    if (e.k === "col" && e.quoted && !own.has(norm(e.name))) Object.assign(e, { k: "lit", v: e.name });
  };
  const walk = (e: Expr | null): void => {
    if (!e) return;
    if (e.k === "bin") {
      // the side that is a column makes the other side a value: supervisor = "Kamal", "supervisor" = "Kamal"
      if (["=", "!=", "<>", "<", ">", "<=", ">="].includes(e.op)) { if (isCol(e.l)) asValue(e.r); else if (isCol(e.r)) asValue(e.l); }
      walk(e.l); walk(e.r);
    } else if (e.k === "in") { e.list.forEach(asValue); walk(e.e); }
    else if (e.k === "like") { asValue(e.pat); walk(e.e); }
    else if (e.k === "between") { asValue(e.lo); asValue(e.hi); walk(e.e); }
    else if (e.k === "not" || e.k === "neg") walk(e.e);
    else if (e.k === "fn") e.args.forEach(walk);
    else if (e.k === "case") { if (e.base) walk(e.base); e.whens.forEach(([a, b]) => { walk(a); asValue(b); walk(b); }); if (e.else) { asValue(e.else); walk(e.else); } }
  };
  if (st.kind === "select") { walk(st.where); walk(st.having); if (st.items !== "*") st.items.forEach((x) => walk(x.e)); }
  else if (st.kind === "update") { st.sets.forEach((x) => asValue(x.e)); walk(st.where); }
  else if (st.kind === "delete") walk(st.where);
  else st.rows.forEach((r) => r.forEach(asValue));
}

export function parseSql(src: string, ctx: CommandContext): Statement {
  const st = parseStatement(cleanPasted(src));
  const t = findTable(st.table);
  quotedValues(st, t);
  // resolve every column now, so a wrong name is reported before anything runs
  const walk = (e: Expr | null): void => {
    if (!e) return;
    if (e.k === "col") findCol(t, e.name);
    else if (e.k === "bin" || e.k === "distinctfrom") { walk(e.l); walk(e.r); }
    else if (e.k === "not" || e.k === "neg") walk(e.e);
    else if (e.k === "fn") {
      e.args.forEach(walk);
      [...(e.order ?? []), ...(e.within ?? []), ...(e.over?.order ?? [])].forEach((o) => walk(o.e));
      e.over?.partition.forEach(walk);
      walk(e.filter ?? null); walk(e.sep ?? null);
    }
    else if (e.k === "case") { walk(e.base); e.whens.forEach(([a, b]) => { walk(a); walk(b); }); walk(e.else); }
    else if (e.k === "in") { walk(e.e); e.list.forEach(walk); }
    else if (e.k === "between") { walk(e.e); walk(e.lo); walk(e.hi); }
    else if (e.k === "like" || e.k === "regexp") { walk(e.e); walk(e.pat); }
    else if (e.k === "isnull") walk(e.e);
  };
  const hasWin = (e: Expr | null): boolean => !!e && JSON.stringify(e).includes('"over":{');
  if (st.kind === "select" && (hasWin(st.where) || st.group.some(hasWin) || hasWin(st.having)))
    throw new CommandError("Window functions (… OVER (…)) belong in the SELECT list or ORDER BY, not in WHERE, GROUP BY or HAVING.");
  if (st.kind !== "select" && (hasWin(st.kind === "update" ? st.where : st.kind === "delete" ? st.where : null) || (st.kind === "update" && st.sets.some((x) => hasWin(x.e)))))
    throw new CommandError("Window functions (… OVER (…)) work in SELECT only.");
  if (st.kind === "select") {
    const aliases = new Set(st.items === "*" ? [] : st.items.map((x) => x.alias?.toLowerCase()).filter(Boolean));
    if (st.items !== "*") st.items.forEach((x) => walk(x.e));
    walk(st.where); st.group.forEach(walk); walk(st.having);
    st.order.forEach((o) => { if (!(o.e.k === "col" && aliases.has(o.e.name.toLowerCase())) && o.e.k !== "lit") walk(o.e); });
  } else if (st.kind === "update") { st.sets.forEach((s) => { findCol(t, s.col); walk(s.e); }); walk(st.where); }
  else if (st.kind === "delete") walk(st.where);
  else st.cols?.forEach((c) => findCol(t, c));
  void ctx;
  return st;
}

const WRITABLE = new Set(["in", "out", "code", "hours", "additional", "remark"]);
const COMPUTED_WHY: Record<string, string> = {
  ot: "OT is worked out by Excel from the times and the day type: change OUT (or IN) instead.",
  worked: "Worked hours follow from IN, OUT and additional hours: change those instead.",
  normal: "Normal hours follow from the times: change IN or OUT instead.",
  total: "Total follows from IN and OUT.",
};

export function runSql(st: Statement, ctx: CommandContext): CommandResult {
  const t = findTable(st.table);
  const res: CommandResult = { verb: st.kind.toUpperCase() as CommandResult["verb"], inputs: [], removeQueued: [], rows: null, summary: "", notes: [] };

  if (st.kind === "select") {
    let rows = tableRows(t, ctx);
    if (st.where) rows = rows.filter((row) => truthy(evaluate(st.where!, { t, row, group: null })));
    const items = st.items === "*" ? t.cols.map((c) => ({ e: { k: "col", name: c.name, raw: c.name } as Expr, alias: null, text: c.name })) : st.items;
    const grouped = st.group.length > 0 || items.some((x) => hasAgg(x.e)) || (st.having !== null);
    type Out = { vals: Val[]; env: Env };
    let envs: Env[];
    if (grouped) {
      const groups = new Map<string, Row[]>();
      for (const row of rows) {
        const key = JSON.stringify(st.group.map((g) => evaluate(g, { t, row, group: null })));
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      if (!groups.size && !st.group.length) groups.set("[]", []);
      envs = [...groups.values()].map((g) => ({ t, row: g[0] ?? {}, group: g }));
      if (st.having) envs = envs.filter((env) => truthy(evaluate(st.having!, env)));
    } else envs = rows.map((row) => ({ t, row, group: null }));
    // window functions (… OVER (…)) run over these rows, before the SELECT list is worked out
    computeWindows([...items.map((x) => x.e), ...st.order.map((o) => o.e)], envs);
    let out: Out[] = envs.map((env) => ({ vals: items.map((x) => evaluate(x.e, env)), env }));
    if (st.order.length) {
      const keyOf = (o: Out, e: Expr): Val => {
        if (e.k === "lit" && typeof e.v === "number") return o.vals[e.v - 1] ?? null; // ORDER BY 2
        if (e.k === "col") { const ix = items.findIndex((x) => x.alias?.toLowerCase() === e.name.toLowerCase()); if (ix >= 0) return o.vals[ix]; }
        return evaluate(e, o.env);
      };
      const keyed = out.map((o) => ({ o, keys: st.order.map((ob) => keyOf(o, ob.e)) }));
      keyed.sort((a, b) => {
        for (let k = 0; k < st.order.length; k++) {
          const ob = st.order[k];
          // (kept: NULLs last whichever way, as before, unless NULLS FIRST / LAST is written)
          const c = compareVals(a.keys[k], b.keys[k], ob.desc, ob.nulls ?? "last");
          if (c) return c;
        }
        return 0;
      });
      out = keyed.map((x) => x.o);
    }
    let table = out.map((o) => o.vals.map((v, n) => display(v, items[n].e.k === "col" ? findCol(t, (items[n].e as { name: string }).name) : null)));
    if (st.distinct) { const seen = new Set<string>(); table = table.filter((r) => { const k = JSON.stringify(r); return seen.has(k) ? false : (seen.add(k), true); }); }
    if (st.offset) table = table.slice(st.offset);
    if (st.limit !== null) table = table.slice(0, st.limit);
    res.table = { columns: items.map((x) => x.alias ?? (x.e.k === "col" ? findCol(t, x.e.name).name : x.text)), rows: table };
    res.summary = `${table.length} row${table.length === 1 ? "" : "s"} from ${t.name}. Nothing is changed.`;
    if (!table.length && st.where) res.notes.push(...emptyCodeNotes(st.where, t.name, ctx));
    res.notes.push(...unknownNameNotes(st.where, ctx), ...unknownSupervisorNotes(st.where, ctx));
    return res;
  }

  if (!t.writable) throw new CommandError(`${t.name} cannot be changed with SQL: only entries (the day sheets) can. ${t.name === "codes" ? "New codes: Activity codes on this tab." : ""}`.trim());

  if (st.kind === "insert") {
    const cols = st.cols ?? ["calling_name", "day", "in", "out", "code", "hours"];
    for (const rowExprs of st.rows) {
      if (rowExprs.length !== cols.length) throw new CommandError(`${cols.length} columns but ${rowExprs.length} values in one row.`);
      const vals: Record<string, Val> = {};
      cols.forEach((c, n) => (vals[findCol(t, c).name] = evaluate(rowExprs[n], { t, row: {}, group: null })));
      for (const k of Object.keys(vals)) if (COMPUTED_WHY[k]) { res.notes.push(`${k.toUpperCase()} ignored: ${COMPUTED_WHY[k]}`); delete vals[k]; }
      // the worker: calling name, or the employee code (ZIDAL)
      let name = vals.calling_name ? String(vals.calling_name) : null;
      if (!name && vals.employee_code) {
        const hits = ctx.workers.filter((w) => String(w.employee_code ?? "").toUpperCase() === String(vals.employee_code).toUpperCase());
        if (hits.length !== 1) throw new CommandError(hits.length ? `Employee code ${vals.employee_code} belongs to ${hits.map((w) => w.calling_name).join(", ")}: give calling_name.` : `No worker has employee code ${vals.employee_code}.`);
        name = hits[0].calling_name;
      }
      const w = name ? ctx.workers.find((x) => x.calling_name.toUpperCase() === name!.toUpperCase()) : undefined;
      if (!w) throw new CommandError(name ? `${name} is not a worker in Labour Detail.` : "INSERT needs calling_name (or employee_code).");
      const tin = timeLiteral(vals.in), tout = timeLiteral(vals.out);
      const day = vals.day ?? (vals.date ? Number(String(vals.date).slice(8, 10)) : tin?.date ? Number(tin.date.slice(8, 10)) : null);
      const dateText = (vals.date as string | null) ?? tin?.date ?? null;
      if (dateText && dateText.slice(0, 7) !== ctx.monthIso) throw new CommandError(`${dateText} is not in this workbook's month (${ctx.monthIso}).`);
      if (day === null || !ctx.sheets.includes(String(day))) throw new CommandError(`Say the day: a day column (1-31), a date, or a date in the time ('${ctx.monthIso}-01 07:00:00').`);
      if (!tin || !tout) throw new CommandError("INSERT needs in and out times.");
      let out = tout.hours;
      if ((tout.date && tin.date && tout.date > tin.date) || out <= tin.hours) out += 24;
      const codes = vals.code ? String(vals.code).split(/[+,]/).map((c) => c.trim().toUpperCase()).filter(Boolean) : [];
      if (ctx.withActivities && !codes.length) throw new CommandError("INSERT needs an activity code (code).");
      const unknown = codes.filter((c) => !ctx.activities.some((a) => a.toUpperCase() === c));
      if (unknown.length && ctx.withActivities) throw new CommandError(`${unknown.join(", ")} is not in the activity list.`);
      const worked = effectiveHours(tin.hours, out, Number(vals.additional ?? 0));
      const hours = vals.hours !== undefined && vals.hours !== null && codes.length === 1 ? [Number(vals.hours)] : codes.map((_, n) => (n < codes.length - 1 ? Math.floor((worked / codes.length) * 4) / 4 : worked - Math.floor((worked / codes.length) * 4) / 4 * (codes.length - 1)));
      const inExcel = Boolean(ctx.month[String(day)]?.entries.some((e) => e.entry.calling_name === w.calling_name));
      if (inExcel) res.notes.push(`${w.calling_name} on day ${day} is already in Excel: press Replace in the queue to overwrite.`);
      const activities: ActivityInput[] = codes.map((code, n) => ({ code, hours: hours[n] }));
      res.inputs.push({ sheet: String(day), calling_name: w.calling_name, time_in: tin.hours, time_out: out, activities, additional: vals.additional === undefined || vals.additional === null ? null : Number(vals.additional), remark: vals.remark == null ? null : String(vals.remark), overwrite: false, acknowledged: [] });
    }
    res.summary = `INSERT ${res.inputs.length} entr${res.inputs.length === 1 ? "y" : "ies"} into the queue.`;
    return res;
  }

  if (!st.where) throw new CommandError(`${st.kind.toUpperCase()} without WHERE would change every entry of the month. Add a WHERE (WHERE 1 = 1 if you really mean all).`);
  const matched = entryRows(ctx).filter(({ row }) => truthy(evaluate(st.where!, { t, row, group: null })));
  if (st.kind === "delete") {
    for (const { row, inExcel } of matched) {
      if (inExcel) res.inputs.push(clearInput(String(row.day), String(row.calling_name)));
      else res.removeQueued.push({ sheet: String(row.day), name: String(row.calling_name) });
    }
    res.summary = `DELETE: ${matched.length} entr${matched.length === 1 ? "y" : "ies"} cleared (in the queue, to push).`;
    return res;
  }
  for (const s of st.sets) {
    const c = findCol(t, s.col);
    if (COMPUTED_WHY[c.name]) throw new CommandError(`${c.name.toUpperCase()} cannot be set: ${COMPUTED_WHY[c.name]}`);
    if (c.name === "supervisor") throw new CommandError("SUPERVISOR cannot be set here: it is whose paper the entries came from, and a correction keeps it. To give entries to another supervisor, use Supervisors → the sheet → Reassign.");
    if (!WRITABLE.has(c.name)) throw new CommandError(`${c.name} cannot be changed (it comes from Labour Detail or the sheet). Columns you can SET: ${[...WRITABLE].join(", ")}.`);
  }
  const whereCodes = codeMatchers(st.where);
  for (const { row, input, inExcel } of matched) {
    let i: EntryInput = { ...input, activities: input.activities.map((a) => ({ ...a })), overwrite: inExcel || input.overwrite, acknowledged: [] };
    const env: Env = { t, row, group: null };
    let tin = i.time_in, tout = i.time_out;
    let timesChanged = false;
    for (const s of st.sets) {
      const name = findCol(t, s.col).name;
      const v = evaluate(s.e, env);
      if (name === "in" || name === "out") {
        const lit = timeLiteral(v);
        if (!lit) throw new CommandError(`"${v}" is not a time for ${name.toUpperCase()}.`);
        let h = lit.hours;
        if (lit.date && row.date && lit.date > String(row.date)) h += 24; // the next morning
        if (name === "in") tin = h; else tout = h;
        timesChanged = true;
      } else if (name === "code") {
        const codes = String(v ?? "").split(/[+,]/).map((x) => x.trim().toUpperCase()).filter(Boolean);
        const unknown = codes.filter((x) => !ctx.activities.some((a) => codeKey(a) === codeKey(x)));
        if (unknown.length && ctx.withActivities) throw new CommandError(`${unknown.join(", ")} is not in the activity list.`);
        // WHERE code = 'old' (or IN / LIKE) and one new code: only those lines change; the
        // worker's other codes and every line's hours stay
        const hits = codes.length === 1 && whereCodes.length ? i.activities.filter((a) => a.code && whereCodes.some((m) => m(a.code!))) : [];
        if (hits.length) {
          i.activities = mergeSameCodes(i.activities.map((a) => (hits.includes(a) ? { ...a, code: codes[0] } : a)));
          continue;
        }
        const total = i.activities.reduce((sum, a) => sum + (a.hours ?? 0), 0) || null;
        i.activities = codes.length === 1 ? [{ code: codes[0], hours: total }] : codes.map((x) => ({ code: x, hours: total === null ? null : Math.round((total / codes.length) * 4) / 4 }));
      } else if (name === "hours") {
        if (i.activities.filter((a) => a.code).length > 1) { res.notes.push(`${row.calling_name} on ${row.day} has several activities: HOURS not set.`); continue; }
        i.activities = i.activities.length ? [{ ...i.activities[0], hours: v === null ? null : Number(v) }] : [{ code: null, hours: Number(v) }];
      } else if (name === "additional") i.additional = v === null ? null : Number(v);
      else if (name === "remark") i.remark = v === null ? null : String(v);
    }
    if (timesChanged) {
      if (tin === null || tout === null) { res.notes.push(`${row.calling_name} on ${row.day} has no times.`); continue; }
      if (tout <= tin) tout += 24;
      const hoursSet = st.sets.some((x) => findCol(t, x.col).name === "hours");
      const hoursNow = i.activities.map((a) => a.hours);
      i = withTimes(i, tin, tout);
      if (hoursSet) i.activities = i.activities.map((a, n) => ({ ...a, hours: hoursNow[n] })); // SET hours wins
    }
    res.inputs.push(i);
  }
  res.summary = `UPDATE: ${res.inputs.length} entr${res.inputs.length === 1 ? "y" : "ies"} changed (in the queue, to push).`;
  if (!matched.length) res.notes.push("No entry matches the WHERE.");
  res.notes.push(...unknownNameNotes(st.where, ctx), ...unknownSupervisorNotes(st.where, ctx));
  return res;
}

// --- help while typing -------------------------------------------------------------------------

const SQL_WORDS: Record<string, string> = {
  CASE: "CASE WHEN condition THEN value … ELSE value END, or CASE x WHEN a THEN … END: a value chosen by conditions.",
  WHEN: "Part of CASE: WHEN condition THEN value.", THEN: "Part of CASE: the value when the WHEN holds.", ELSE: "Part of CASE: the value when no WHEN holds.", END: "Ends a CASE.",
  OVER: "Makes a window function: SUM(hours) OVER (PARTITION BY calling_name ORDER BY day) is a running total per worker.",
  PARTITION: "PARTITION BY in OVER (…): the window restarts for each value.",
  WITHIN: "WITHIN GROUP (ORDER BY x): the order for PERCENTILE_CONT, MODE, LISTAGG.",
  INTERVAL: "A length of time: INTERVAL 7 DAY, INTERVAL '2' MONTH. date + INTERVAL 7 DAY is a week later.",
  CAST: "CAST(value AS type): INT, DECIMAL(10,2), VARCHAR(20), DATE, DATETIME, TIME, BOOLEAN. value::type works too.",
  REGEXP: "text REGEXP 'pattern': a regular expression match (also RLIKE, ~, ~*, SIMILAR TO).",
  ILIKE: "LIKE ignoring case (LIKE here ignores case anyway).",
  DIV: "Whole-number division: 7 DIV 2 = 3.", MOD: "Remainder: 7 MOD 2 = 1 (also 7 % 2, MOD(7, 2)).",
  NULLS: "ORDER BY x NULLS FIRST / NULLS LAST.",
  SELECT: "Lists columns of a table: SELECT calling_name, hours FROM entries WHERE … Nothing is changed.",
  FROM: "The table to read: entries (labor), activities, workers, codes, supervisors, days. Leave FROM out to try functions: SELECT UPPER('abc').",
  WHERE: "Only rows that match: =, !=, <, >, <=, >=, LIKE 'B%', IN (…), BETWEEN a AND b, IS NULL; join with AND / OR / NOT.",
  "GROUP BY": "One row per group, with COUNT, SUM, AVG, MIN, MAX: SELECT code, SUM(hours) FROM entries GROUP BY code.",
  GROUP: "GROUP BY: one row per group, with COUNT, SUM, AVG, MIN, MAX.",
  HAVING: "Like WHERE, but on the groups: … GROUP BY code HAVING SUM(hours) > 100.",
  ORDER: "ORDER BY: sort by columns, ASC (default) or DESC: ORDER BY hours DESC.",
  BY: "After GROUP or ORDER.",
  LIMIT: "Only the first N rows: LIMIT 10 (LIMIT 10 OFFSET 20 skips 20 first).",
  DISTINCT: "Each different row once: SELECT DISTINCT code FROM entries.",
  AS: "A name for a column in the result: SUM(hours) AS total_hours.",
  INSERT: "INSERT INTO entries (calling_name, day, in, out, code) VALUES (…): new entries, into the queue (nothing written until you push).",
  INTO: "The table to add to (entries).",
  VALUES: "The values of the new rows, in the order of the columns: VALUES ('INB-01', 21, '07:00', '19:00', '03-11-00-00').",
  UPDATE: "UPDATE entries SET out = '20:00' WHERE …: changes matching entries, into the queue. WHERE is required.",
  SET: "What to change: in, out, code, hours, additional, remark. Values can use columns: SET out = out + 1.",
  DELETE: "DELETE FROM entries WHERE …: clears matching entries, into the queue. WHERE is required.",
  AND: "Both conditions must hold.", OR: "Either condition.", NOT: "The opposite: NOT LIKE, NOT IN, NOT BETWEEN.",
  LIKE: "Text pattern: % = any text, _ = one character. calling_name LIKE 'B%' starts with B; LIKE '%S' ends with S.",
  IN: "One of a list: code IN ('03-11-00-00', '03-20-00-00').", BETWEEN: "In a range, both ends included: day BETWEEN 1 AND 10.",
  IS: "IS NULL / IS NOT NULL: empty or not.", NULL: "No value (an empty cell).",
  ASC: "Smallest first (the default).", DESC: "Largest first.", OFFSET: "Skip rows before LIMIT.",
  COUNT: "COUNT(*) rows; COUNT(col) rows with a value; COUNT(DISTINCT col) different values.",
  SUM: "Total of a column.", AVG: "Average of a column.", MIN: "Smallest value.", MAX: "Largest value.",
  ROUND: "ROUND(x, 2): round to 2 decimals.", UPPER: "Text in capitals.", LOWER: "Text in small letters.", LENGTH: "Number of characters.",
  COALESCE: "The first value that is not empty: COALESCE(remark, '-').", TRIM: "Without spaces at the ends.", ABS: "Without the minus sign.",
};

export function explainSql(word: string, src: string, ctx: CommandContext): WordInfo | null {
  const w = word.replace(/^[`"'[]|[`"'\]]$/g, "");
  const up = w.toUpperCase();
  if (SQL_WORDS[up]) return { name: up, kind: "keyword", text: SQL_WORDS[up], synonyms: [] };
  const table = tableIndex.get(norm(w));
  if (table) return { name: table.name, kind: "keyword", text: `Table ${table.name}${norm(w) !== norm(table.name) ? ` ("${w}")` : ""}: ${table.help} Columns: ${table.cols.map((c) => c.name).join(", ")}.`, synonyms: table.aliases };
  const from = src.match(/\b(?:from|into|update)\s+([`"\w]+)/i)?.[1];
  const t = from ? tableIndex.get(norm(from)) : TABLES[0];
  if (t) {
    try {
      const c = findCol(t, w);
      return { name: c.name, kind: "field", text: `${norm(w) !== norm(c.name) ? `"${w}" means ${c.name}. ` : ""}${c.help} (${c.type}${t.writable && WRITABLE.has(c.name) ? ", can be SET" : COMPUTED_WHY[c.name] ? ", worked out by Excel" : ""})`, synonyms: c.aliases };
    } catch {
      /* not a column */
    }
  }
  const fi = functionInfo(w);
  if (fi) return { name: fi.name, kind: "keyword", text: `${fi.sig} — ${fi.help}${fi.aliases.length ? ` Also written: ${fi.aliases.join(", ")}.` : ""} (${fi.cat} function)`, synonyms: fi.aliases };
  const lit = timeLiteral(w);
  if (lit?.date) return { name: w, kind: "days", text: `${lit.date}${lit.hours ? ` at ${formatClock(lit.hours)}` : ""}: day ${Number(lit.date.slice(8, 10))} of the month.`, synonyms: [] };
  void ctx;
  return null;
}

export function suggestSql(src: string, cursor: number, ctx: CommandContext, limit = 10): { from: number; items: Suggestion[] } {
  const before = src.slice(0, cursor);
  const partial = (before.match(/[`\w]*$/)?.[0] ?? "").replace(/^`/, "");
  const from = cursor - partial.length;
  const words = sqlTokens(before.slice(0, from)).map((t) => t.text.toLowerCase());
  const last = words[words.length - 1] ?? "";
  const tableName = src.match(/\b(?:from|into|update)\s+([`"\w]+)/i)?.[1];
  const t = (tableName && tableIndex.get(norm(tableName))) || TABLES[0];
  const kw = (list: string[]) => list.map((k) => ({ insert: k, label: k, detail: (SQL_WORDS[k.toUpperCase()] ?? "").split(":")[0].split(".")[0] }));
  const cols = () => t.cols.map((c) => ({ insert: c.name, label: c.name, detail: `${t.name}: ${c.help.split(".")[0]}` }));
  const tables = () => [
    ...TABLES.map((x) => ({ insert: x.name, label: x.name, detail: x.help.split(".")[0] })),
    ...TABLES.flatMap((x) => x.aliases.map((a) => ({ insert: a, label: `${a} → ${x.name}`, detail: x.help.split(".")[0] }))),
  ];
  const fns = () => [
    ...kw(["COUNT(*)", "SUM(", "AVG(", "MIN(", "MAX(", "ROUND("]).map((x) => ({ ...x, detail: SQL_WORDS[x.label.replace(/[(*)]/g, "")]?.split(".")[0] ?? "" })),
    ...FUNCTIONS.flatMap((f) => [f.name, ...f.aliases].map((n) => ({ insert: `${n}(`, label: n === f.name ? f.sig.split(" · ")[0] : `${n} → ${f.name}`, detail: f.help.split(/[.:]/)[0] }))),
  ];
  let items: Suggestion[];
  if (["from", "into", "update"].includes(last)) items = tables();
  else if (["select", ",", "(", "by", "where", "and", "or", "set", "not", "distinct", "having", "+", "-", "*", "/", "when", "then", "else", "case"].includes(last)) items = [...cols(), ...(partial ? fns() : ["select", ",", "having"].includes(last) ? fns().slice(0, 6) : [])];
  else if (["=", "!=", "<>", "like", "in"].includes(last) && words[words.length - 2] && /code/.test(words[words.length - 2])) items = ctx.activities.map((a) => ({ insert: `'${a}'`, label: a, detail: "activity code" }));
  else if (["=", "!=", "<>", "like", "in"].includes(last) && words[words.length - 2] && /supervisor|foreman|owner/.test(words[words.length - 2]))
    items = supervisorNames(ctx).map((n) => ({ insert: `'${n.replace(/'/g, "''")}'`, label: n, detail: "supervisor" }));
  else if (!words.length) items = kw(["SELECT", "INSERT", "UPDATE", "DELETE"]);
  else items = kw(["FROM", "WHERE", "AND", "OR", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "DESC", "AS", "LIKE", "IN", "BETWEEN", "IS NULL", "SET", "VALUES"]);
  const p = partial.toLowerCase();
  return { from, items: items.filter((s) => s.insert.toLowerCase().startsWith(p) && s.insert.toLowerCase() !== p).slice(0, limit) };
}

export const SQL_TABLES = TABLES.map((t) => ({ name: t.name, help: t.help, cols: t.cols.map((c) => c.name), aliases: t.aliases }));

/** The tables with their columns and types, for the SQL panel's tree. */
export const SQL_SCHEMA = TABLES.map((t) => ({
  name: t.name,
  help: t.help,
  writable: Boolean(t.writable),
  aliases: t.aliases,
  cols: t.cols.map((c) => ({ name: c.name, type: c.type, help: c.help, writable: Boolean(t.writable) && WRITABLE.has(c.name) })),
}));

/** Rows per table now (the tree shows them, like a database browser). */
export function sqlRowCounts(ctx: CommandContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t.name] = tableRows(t, ctx).length;
  return out;
}

/** Split a script into statements on ";" outside quotes, with "--" comments removed; each with
 * its start and end in the text (the panel runs the one under the cursor). */
export function splitSql(src: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  let quote: string | null = null, start = 0, buf = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      buf += ch;
    } else if (ch === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") i++;
      buf += "\n";
    } else if (ch === ";") {
      if (buf.trim()) out.push({ text: buf.trim(), start, end: i });
      buf = "";
      start = i + 1;
    } else buf += ch;
  }
  if (buf.trim()) out.push({ text: buf.trim(), start, end: src.length });
  return out;
}
