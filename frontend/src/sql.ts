// SQL in the command box: SELECT (with WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, aggregates),
// INSERT, UPDATE and DELETE over the month as tables. Like the commands, nothing is written:
// SELECT lists, INSERT/UPDATE/DELETE produce ordinary queue entries (checked, shown on the
// manpower sheet, pushed as one undoable batch). Column names are forgiving: `in times`,
// InTime and in_time are all IN; ZIDAL is the employee code.
import type { ActivityInput, EntryInput } from "./api";
import { CommandError, current, dateOf, didYouMean, whoOnAll, type CommandContext, type CommandResult, type Suggestion, type Token, type WordInfo } from "./commands";
import { placeName } from "./codes";
import { clearInput, withTimes } from "./form";
import { effectiveHours, formatClock, parseClock } from "./time";

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
];
const TABLES: TableDef[] = [
  { name: "entries", writable: true, help: "One row per worker per day: what is in Excel plus what waits in the queue. INSERT, UPDATE and DELETE go to the queue.", aliases: ["entry", "labor", "labour", "labors", "labours", "work", "records", "record", "timesheet", "timesheets", "attendance", "manpower"], cols: ENTRY_COLS },
  { name: "activities", help: "One row per activity line (for sums of hours by code).", aliases: ["activity", "lines", "activitylines", "allocations"], cols: [ENTRY_COLS[0], ENTRY_COLS[1], ENTRY_COLS[2], ENTRY_COLS[3], ENTRY_COLS[5], col("code", "text", "Activity code.", ["activitycode", "activity", "wbs", "act", "task"]), ENTRY_COLS[9], col("hours", "number", "Hours on this line.", ["hour", "hrs"]), ENTRY_COLS[18]] },
  { name: "workers", help: "Labour Detail: every calling name with its worker.", aliases: ["worker", "employees", "employee", "staff", "people", "labourdetail", "labordetail", "master"], cols: [ENTRY_COLS[2], ENTRY_COLS[3], ENTRY_COLS[4], ENTRY_COLS[5], col("code_status", "text", "valid, missing, error (#N/A), zero or invalid.", ["codestatus", "employeecodestatus"]), col("row", "number", "Row in Labour Detail.", ["rowno", "line"]), col("days_worked", "number", "Days with an entry this month.", ["daysworked", "days", "attendance"])] },
  { name: "codes", help: "The activity list in Labour Detail.", aliases: ["code", "activitycodes", "activitycode", "wbs", "activitylist", "wbscodes"], cols: [col("code", "text", "Activity code.", ["activitycode", "wbs"]), ENTRY_COLS[9], col("lines", "number", "Activity lines with this code this month.", ["used", "uses", "count"])] },
  { name: "days", help: "The day sheets.", aliases: ["day", "sheets", "sheet", "dates", "calendar"], cols: [ENTRY_COLS[0], ENTRY_COLS[1], col("weekday", "text", "Monday … Sunday.", ["dow", "dayname"]), ENTRY_COLS[17], col("workers", "number", "Workers with an entry that day.", ["count", "people", "headcount"])] },
];

const norm = (id: string) => {
  let t = id.toLowerCase().replace(/^[`"[]|[`"\]]$/g, "").replace(/[\s_\-.]+/g, "");
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t;
};
const tableIndex = new Map<string, TableDef>();
for (const t of TABLES) for (const a of [t.name, ...t.aliases]) tableIndex.set(norm(a), t);
function findTable(name: string): TableDef {
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
        },
      });
    }
  }
  return out;
}

function tableRows(t: TableDef, ctx: CommandContext): Row[] {
  if (t.name === "entries") return entryRows(ctx).map((r) => r.row);
  if (t.name === "activities")
    return entryRows(ctx).flatMap(({ row, input }) =>
      input.activities.filter((a) => a.code || a.hours !== null).map((a) => ({ day: row.day, date: row.date, calling_name: row.calling_name, full_name: row.full_name, employee_code: row.employee_code, code: a.code, place: a.code ? placeName(a.code, ctx.places) : null, hours: a.hours, source: row.source })),
    );
  if (t.name === "workers") {
    const days = new Map<string, number>();
    for (const r of entryRows(ctx)) days.set(String(r.row.calling_name), (days.get(String(r.row.calling_name)) ?? 0) + 1);
    return ctx.workers.map((w) => ({ calling_name: w.calling_name, full_name: w.name == null ? null : String(w.name), trade: w.trade_group == null ? null : String(w.trade_group), employee_code: w.employee_code == null ? null : String(w.employee_code), code_status: w.code_status, row: w.row, days_worked: days.get(w.calling_name) ?? 0 }));
  }
  if (t.name === "codes") {
    const used = new Map<string, number>();
    for (const r of entryRows(ctx)) for (const a of r.input.activities) if (a.code) used.set(a.code.toUpperCase(), (used.get(a.code.toUpperCase()) ?? 0) + 1);
    return ctx.activities.map((c) => ({ code: c, place: placeName(c, ctx.places), lines: used.get(c.toUpperCase()) ?? 0 }));
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
  | { k: "col"; name: string; raw: string }
  | { k: "star" }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "not"; e: Expr }
  | { k: "neg"; e: Expr }
  | { k: "fn"; name: string; args: Expr[]; distinct: boolean }
  | { k: "in"; e: Expr; list: Expr[]; neg: boolean }
  | { k: "between"; e: Expr; lo: Expr; hi: Expr; neg: boolean }
  | { k: "like"; e: Expr; pat: Expr; neg: boolean }
  | { k: "isnull"; e: Expr; neg: boolean };

interface Select {
  kind: "select";
  table: string;
  distinct: boolean;
  items: { e: Expr; alias: string | null; text: string }[] | "*";
  where: Expr | null;
  group: Expr[];
  having: Expr | null;
  order: { e: Expr; desc: boolean }[];
  limit: number | null;
  offset: number;
}
interface Insert { kind: "insert"; table: string; cols: string[] | null; rows: Expr[][] }
interface Update { kind: "update"; table: string; sets: { col: string; e: Expr }[]; where: Expr | null }
interface Delete { kind: "delete"; table: string; where: Expr | null }
export type Statement = Select | Insert | Update | Delete;

const SQL_START = /^\s*(select\b[\s\S]*\bfrom\b|select\s+(count|sum|avg|min|max|\*)|insert\s+into\b|update\s+[`"\w]+\s+set\b|delete\s+from\b)/i;
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

const KW = new Set(["select", "distinct", "from", "where", "group", "by", "having", "order", "asc", "desc", "limit", "offset", "insert", "into", "values", "update", "set", "delete", "and", "or", "not", "like", "in", "between", "is", "null", "as", "true", "false"]);
const AGG = new Set(["count", "sum", "avg", "min", "max"]);
const FNS = new Set([...AGG, "round", "upper", "lower", "length", "len", "coalesce", "ifnull", "abs", "trim"]);

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
    if (/^[A-Za-z_]/.test(t.text) && (!KW.has(t.text.toLowerCase()) || isInColumn)) {
      i++;
      // a bare name of several words (`in times` without quotes): join until a keyword or symbol
      let name = t.text;
      while (peek() && /^[A-Za-z_]/.test(peek()!.text) && !KW.has(low()!) && !FNS.has(low()!) && peek(1)?.text !== "(" && peek()!.start === tokens[i - 1].end + 1 && name.split(" ").length < 3 && looksLikeContinuation(name, peek()!.text)) {
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
    if (FNS.has(l) && peek(1)?.text === "(") {
      i += 2;
      const distinct = accept("distinct");
      const args: Expr[] = [];
      if (peek()?.text !== ")") { args.push(expr()); while (accept(",")) args.push(expr()); }
      eat(")");
      return { k: "fn", name: l === "len" ? "length" : l === "ifnull" ? "coalesce" : l, args, distinct };
    }
    if (t.text.startsWith('"') && !/^"[A-Za-z_ ]+"$/.test(t.text)) { i++; return { k: "lit", v: t.text.slice(1, -1) }; }
    let name = ident();
    if (peek()?.text === ".") { i++; name = ident(); } // table.column
    return { k: "col", name, raw: name };
  };
  const unary = (): Expr => primary();
  const mul = (): Expr => { let e = unary(); while (["*", "/"].includes(peek()?.text ?? "")) { const op = tokens[i++].text; e = { k: "bin", op, l: e, r: unary() }; } return e; };
  const add = (): Expr => { let e = mul(); while (["+", "-", "||"].includes(peek()?.text ?? "")) { const op = tokens[i++].text; e = { k: "bin", op, l: e, r: mul() }; } return e; };
  const cmp = (): Expr => {
    const e = add();
    const neg = low() === "not" && ["like", "in", "between"].includes(low(1) ?? "") ? (i++, true) : false;
    if (accept("like")) return { k: "like", e, pat: add(), neg };
    if (accept("in")) { eat("("); const list = [expr()]; while (accept(",")) list.push(expr()); eat(")"); return { k: "in", e, list, neg }; }
    if (accept("between")) { const lo = add(); eat("and"); return { k: "between", e, lo, hi: add(), neg }; }
    if (accept("is")) { const n = accept("not"); eat("null"); return { k: "isnull", e, neg: n }; }
    const op = peek()?.text;
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
    eat("from");
    const table = ident();
    const where = accept("where") ? expr() : null;
    const group: Expr[] = [];
    if (accept("group")) { eat("by"); do group.push(expr()); while (accept(",")); }
    const having = accept("having") ? expr() : null;
    const order: Select["order"] = [];
    if (accept("order")) { eat("by"); do { const e = expr(); const desc = accept("desc"); if (!desc) accept("asc"); order.push({ e, desc }); } while (accept(",")); }
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
    const table = ident();
    eat("set");
    const sets: Update["sets"] = [];
    do { const c = ident(); if (!accept("=")) eat("="); sets.push({ col: c, e: expr() }); } while (accept(","));
    st = { kind: "update", table, sets, where: accept("where") ? expr() : null };
  } else if (first === "delete") {
    i++; eat("from");
    st = { kind: "delete", table: ident(), where: accept("where") ? expr() : null };
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
      if (e.op === "||") return `${a ?? ""}${b ?? ""}`;
      if (a === null || b === null) return null;
      const x = Number(a), y = Number(b);
      return e.op === "+" ? x + y : e.op === "-" ? x - y : e.op === "*" ? x * y : y === 0 ? null : x / y;
    }
    case "fn": {
      if (AGG.has(e.name)) {
        const rows = env.group ?? [env.row];
        const vals = e.args[0]?.k === "star" || !e.args.length ? rows.map(() => 1) : rows.map((r) => evaluate(e.args[0], { ...env, row: r, group: null })).filter((v) => v !== null && v !== "");
        const list = e.distinct ? [...new Set(vals.map(String))].map((v) => (Number.isNaN(Number(v)) ? v : Number(v))) : vals;
        if (e.name === "count") return list.length;
        if (!list.length) return null;
        const nums = list.map(Number);
        if (e.name === "sum") return Math.round(nums.reduce((s, v) => s + v, 0) * 100) / 100;
        if (e.name === "avg") return Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 100) / 100;
        const cmpv = (a: Val, b: Val) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)));
        return [...list].sort(cmpv)[e.name === "min" ? 0 : list.length - 1] as Val;
      }
      const args = e.args.map((a) => evaluate(a, env));
      switch (e.name) {
        case "round": return args[0] === null ? null : Math.round(Number(args[0]) * 10 ** Number(args[1] ?? 0)) / 10 ** Number(args[1] ?? 0);
        case "upper": return args[0] === null ? null : String(args[0]).toUpperCase();
        case "lower": return args[0] === null ? null : String(args[0]).toLowerCase();
        case "trim": return args[0] === null ? null : String(args[0]).trim();
        case "length": return args[0] === null ? null : String(args[0]).length;
        case "abs": return args[0] === null ? null : Math.abs(Number(args[0]));
        case "coalesce": return args.find((a) => a !== null && a !== "") ?? null;
      }
      throw new CommandError(`Unknown function ${e.name.toUpperCase()}.`);
    }
  }
}
const truthy = (v: Val) => v !== null && v !== 0 && v !== "" && v !== "0";

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
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "" && !Number.isNaN(Number(b))) b = Number(b);
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && !Number.isNaN(Number(a))) a = Number(a);
  const c = typeof a === "number" && typeof b === "number" ? (Math.abs(a - b) < 1e-6 ? 0 : a - b) : String(a).toUpperCase().localeCompare(String(b).toUpperCase());
  return op === "=" ? c === 0 : op === "!=" ? c !== 0 : op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
}

const hasAgg = (e: Expr): boolean =>
  e.k === "fn" ? AGG.has(e.name) || e.args.some(hasAgg) : e.k === "bin" ? hasAgg(e.l) || hasAgg(e.r) : e.k === "not" || e.k === "neg" ? hasAgg(e.e) : false;

function display(v: Val, c: ColDef | null): string | number | null {
  if (v === null) return null;
  if (c?.type === "time" && typeof v === "number") return `${formatClock(v)}${v >= 24 ? " (+1)" : ""}`;
  if (typeof v === "number") return Number.isInteger(v) ? v : Math.round(v * 100) / 100;
  return v;
}

// --- running -------------------------------------------------------------------------------------

export function parseSql(src: string, ctx: CommandContext): Statement {
  const st = parseStatement(src);
  const t = findTable(st.table);
  // resolve every column now, so a wrong name is reported before anything runs
  const walk = (e: Expr | null): void => {
    if (!e) return;
    if (e.k === "col") findCol(t, e.name);
    else if (e.k === "bin") { walk(e.l); walk(e.r); }
    else if (e.k === "not" || e.k === "neg") walk(e.e);
    else if (e.k === "fn") e.args.forEach(walk);
    else if (e.k === "in") { walk(e.e); e.list.forEach(walk); }
    else if (e.k === "between") { walk(e.e); walk(e.lo); walk(e.hi); }
    else if (e.k === "like") { walk(e.e); walk(e.pat); }
    else if (e.k === "isnull") walk(e.e);
  };
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
    let out: Out[];
    if (grouped) {
      const groups = new Map<string, Row[]>();
      for (const row of rows) {
        const key = JSON.stringify(st.group.map((g) => evaluate(g, { t, row, group: null })));
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      if (!groups.size && !st.group.length) groups.set("[]", []);
      out = [...groups.values()].map((g) => {
        const env: Env = { t, row: g[0] ?? {}, group: g };
        return { vals: items.map((x) => evaluate(x.e, env)), env };
      });
      if (st.having) out = out.filter((o) => truthy(evaluate(st.having!, o.env)));
    } else out = rows.map((row) => { const env: Env = { t, row, group: null }; return { vals: items.map((x) => evaluate(x.e, env)), env }; });
    if (st.order.length) {
      const keyOf = (o: Out, e: Expr): Val => {
        if (e.k === "lit" && typeof e.v === "number") return o.vals[e.v - 1] ?? null; // ORDER BY 2
        if (e.k === "col") { const ix = items.findIndex((x) => x.alias?.toLowerCase() === e.name.toLowerCase()); if (ix >= 0) return o.vals[ix]; }
        return evaluate(e, o.env);
      };
      out.sort((a, b) => {
        for (const ob of st.order) {
          const x = keyOf(a, ob.e), y = keyOf(b, ob.e);
          if (x === y) continue;
          if (x === null) return 1;
          if (y === null) return -1;
          const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
          if (c) return ob.desc ? -c : c;
        }
        return 0;
      });
    }
    let table = out.map((o) => o.vals.map((v, n) => display(v, items[n].e.k === "col" ? findCol(t, (items[n].e as { name: string }).name) : null)));
    if (st.distinct) { const seen = new Set<string>(); table = table.filter((r) => { const k = JSON.stringify(r); return seen.has(k) ? false : (seen.add(k), true); }); }
    if (st.offset) table = table.slice(st.offset);
    if (st.limit !== null) table = table.slice(0, st.limit);
    res.table = { columns: items.map((x) => x.alias ?? (x.e.k === "col" ? findCol(t, x.e.name).name : x.text)), rows: table };
    res.summary = `${table.length} row${table.length === 1 ? "" : "s"} from ${t.name}. Nothing is changed.`;
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
    if (!WRITABLE.has(c.name)) throw new CommandError(`${c.name} cannot be changed (it comes from Labour Detail or the sheet). Columns you can SET: ${[...WRITABLE].join(", ")}.`);
  }
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
        const unknown = codes.filter((x) => !ctx.activities.some((a) => a.toUpperCase() === x));
        if (unknown.length && ctx.withActivities) throw new CommandError(`${unknown.join(", ")} is not in the activity list.`);
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
  return res;
}

// --- help while typing -------------------------------------------------------------------------

const SQL_WORDS: Record<string, string> = {
  SELECT: "Lists columns of a table: SELECT calling_name, hours FROM entries WHERE … Nothing is changed.",
  FROM: "The table to read: entries (labor), activities, workers, codes, days.",
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
  const fns = () => kw(["COUNT(*)", "SUM(", "AVG(", "MIN(", "MAX(", "ROUND("]).map((x) => ({ ...x, detail: SQL_WORDS[x.label.replace(/[(*)]/g, "")]?.split(".")[0] ?? "" }));
  let items: Suggestion[];
  if (["from", "into", "update"].includes(last)) items = tables();
  else if (["select", ",", "(", "by", "where", "and", "or", "set", "not", "distinct", "having"].includes(last)) items = [...cols(), ...(["select", ",", "having"].includes(last) ? fns() : [])];
  else if (["=", "!=", "<>", "like", "in"].includes(last) && words[words.length - 2] && /code/.test(words[words.length - 2])) items = ctx.activities.map((a) => ({ insert: `'${a}'`, label: a, detail: "activity code" }));
  else if (!words.length) items = kw(["SELECT", "INSERT", "UPDATE", "DELETE"]);
  else items = kw(["FROM", "WHERE", "AND", "OR", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "DESC", "AS", "LIKE", "IN", "BETWEEN", "IS NULL", "SET", "VALUES"]);
  const p = partial.toLowerCase();
  return { from, items: items.filter((s) => s.insert.toLowerCase().startsWith(p) && s.insert.toLowerCase() !== p).slice(0, limit) };
}

export const SQL_TABLES = TABLES.map((t) => ({ name: t.name, help: t.help, cols: t.cols.map((c) => c.name), aliases: t.aliases }));
