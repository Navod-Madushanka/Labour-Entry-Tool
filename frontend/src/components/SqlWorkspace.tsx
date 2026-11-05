// SQL panel (like a database browser): the tables and their columns on the left, an editor with
// line numbers, colours and completion, the result as a grid, a Data tab to browse a table with a
// WHERE filter, and changes shown old -> new before anything goes to the waiting list. Runs on the
// month as loaded (src/sql.ts); nothing is written to Excel from here.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type EntryInput } from "../api";
import { CommandError, current, explain, parse, run as runCommand, suggest, tokenize, type CommandContext, type CommandResult } from "../commands";
import { cleanPasted, explainSql, isSql, looksSql, parseSql, runSql, splitSql, sqlRowCounts, SQL_SCHEMA, suggestSql } from "../sql";
import { formatClock } from "../time";
import { store } from "../store";

const HISTORY = "labour.sql.history";
const SHOWN_ROWS = 1000; // a grid of thousands of rows is slow on the office PCs; export has all
const EXAMPLES: [string, string][] = [
  ["Workers whose name starts with BCC- and ends with S, on day 26", "SELECT calling_name, in, out, code, hours, worked, ot\nFROM entries\nWHERE calling_name LIKE 'BCC-% S' AND day = 26"],
  ["Hours and overtime per activity code", "SELECT code, SUM(hours) AS total_hours, SUM(ot) AS total_ot\nFROM entries\nGROUP BY code\nORDER BY total_hours DESC"],
  ["Headcount per day", "SELECT day, COUNT(*) AS workers\nFROM entries\nGROUP BY day\nORDER BY day"],
  ["Who worked past 22:00", "SELECT day, calling_name, in, out\nFROM entries\nWHERE out > '22:00'\nORDER BY day"],
  ["Workers without a valid employee code", "SELECT calling_name, full_name, code_status\nFROM workers\nWHERE code_status <> 'valid'"],
  ["Change Time Out to 20:00 for one worker on days 1-10", "UPDATE entries SET out = '20:00'\nWHERE calling_name = 'INB-01' AND day BETWEEN 1 AND 10"],
  ["Command: copy two workers from day 26 to day 21", "copy INB-01, INB-02 from 26 to 21"],
  ["Command: fill a crew from day 20 into days 21-24", "fill crew of INB-03 from 20 to 21-24"],
  ["Command: move everyone from day 8 to day 9", "move all from 8 to 9"],
  ["Command: show who left after 19:00 on day 12", "show all on 12 where out > 19"],
];
/** SQL, or one of the plain commands (set, copy, fill, move, swap, clear, …) that share some words. */
const sqlStatement = (src: string) => isSql(src) || /^\s*update\b[\s\S]*\b(set|from)\b/i.test(src);
const sqlTyping = (src: string) => sqlStatement(src) || looksSql(src);
const KEYWORDS = /^(shift|copy|fill|move|swap|clear|replace|show|for|on|to|except|crew|of|trade|code|all|select|distinct|from|where|group|by|having|order|asc|desc|limit|offset|insert|into|values|update|set|delete|and|or|not|like|in|between|is|null|as|true|false|count|sum|avg|min|max|round|upper|lower|length|len|coalesce|ifnull|abs|trim)$/i;
const TABLE_NAMES = new Set(SQL_SCHEMA.flatMap((t) => [t.name, ...t.aliases]).map((n) => n.toLowerCase()));
const COL_NAMES = new Set(SQL_SCHEMA.flatMap((t) => t.cols.map((c) => c.name.toLowerCase())));

type Cell = string | number | null;
interface Grid { columns: string[]; rows: Cell[][] }
interface Change { kind: "insert" | "update" | "delete" | "unqueue"; sheet: string; name: string; fields: { label: string; before: string; after: string }[] }
interface Pending { sql: string; result: CommandResult; changes: Change[]; cell?: string }

const readHistory = (): string[] => {
  try {
    return JSON.parse(store.get(HISTORY) ?? "[]");
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------- old -> new

const linesText = (i: EntryInput | null) => (i ? i.activities.filter((a) => a.code || a.hours !== null).map((a) => `${a.code ?? "?"}${a.hours === null ? "" : ` (${a.hours})`}`).join(", ") : "");
const t = (v: number | null | undefined) => (v === null || v === undefined ? "" : `${formatClock(v)}${v >= 24 ? " +1" : ""}`);

/** What a write would change, entry by entry, against what is there now (Excel or the queue). */
export function changesOf(res: CommandResult, ctx: CommandContext): Change[] {
  const out: Change[] = [];
  for (const inp of res.inputs) {
    const before = current(ctx, inp.calling_name, inp.sheet)?.input ?? null;
    const cleared = inp.time_in === null && inp.time_out === null && !inp.activities.length;
    const f = (label: string, b: string, a: string) => ({ label, before: b, after: a });
    const all = [
      f("In", t(before?.time_in), t(inp.time_in)),
      f("Out", t(before?.time_out), t(inp.time_out)),
      f("Activities", linesText(before), linesText(inp)),
      f("Additional", before?.additional == null ? "" : String(before.additional), inp.additional == null ? "" : String(inp.additional)),
      f("Remark", before?.remark ?? "", inp.remark ?? ""),
    ];
    out.push({
      kind: cleared ? "delete" : before ? "update" : "insert",
      sheet: inp.sheet,
      name: inp.calling_name,
      fields: cleared ? all.filter((x) => x.before) : before ? all.filter((x) => x.before !== x.after) : all.filter((x) => x.after),
    });
  }
  for (const r of res.removeQueued) out.push({ kind: "unqueue", sheet: r.sheet, name: r.name, fields: [] });
  return out;
}

// ---------------------------------------------------------------------------------- panel

interface Props {
  ctx: CommandContext;
  onApply: (result: CommandResult) => void;
  waiting: number;
  onReview: () => void;
  focusToken: number; // Ctrl+K from any tab: open the panel, cursor in the editor
}

let handledFocus = 0;

export function SqlWorkspace({ ctx, onApply, waiting, onReview, focusToken }: Props) {
  const [open, setOpen] = useState(() => store.get("labour.sql.open") !== "0");
  const [tab, setTab] = useState<"query" | "data">("query");
  const [text, setText] = useState(() => store.get("labour.sql.text") ?? EXAMPLES[0][1]);
  const [cursor, setCursor] = useState(0);
  const [result, setResult] = useState<{ grid: Grid | null; summary: string; notes: string[]; ms: number; sql: string } | null>(null);
  const [error, setError] = useState<{ message: string; at?: number } | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ entries: true });
  const [dataTable, setDataTable] = useState("entries");
  const [dataFilter, setDataFilter] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => store.set("labour.sql.text", text), [text]);
  useEffect(() => {
    if (!focusToken || focusToken === handledFocus) return;
    handledFocus = focusToken;
    setOpen(true);
    setTab("query");
    setTimeout(() => {
      editor.current?.focus();
      editor.current?.scrollIntoView({ block: "center" });
    }, 0);
  }, [focusToken]);
  useEffect(() => store.set("labour.sql.open", open ? "1" : "0"), [open]);
  const counts = useMemo(() => (open ? sqlRowCounts(ctx) : {}), [ctx, open]);

  const insertAtCursor = (word: string) => {
    const el = editor.current;
    const at = el ? el.selectionStart : text.length;
    const before = text.slice(0, at);
    const sep = before && !/[\s(,]$/.test(before) ? " " : "";
    const next = `${before}${sep}${word}${text.slice(at)}`;
    setText(next);
    setTab("query");
    const pos = at + sep.length + word.length;
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(pos, pos);
      setCursor(pos);
    });
  };

  /** Run one statement: SELECT -> grid; INSERT/UPDATE/DELETE -> pending changes to look at. */
  const runOne = (typed: string, cell?: string): boolean => {
    const sql = cleanPasted(typed); // pasted from a chat or Word: curly quotes, look-alike dashes
    const started = performance.now();
    try {
      const res = sqlStatement(sql) ? runSql(parseSql(sql, ctx), ctx) : runCommand(parse(sql, ctx), ctx);
      const ms = Math.round(performance.now() - started);
      if (res.verb === "SELECT" || res.verb === "SHOW") {
        const grid = res.table ?? (res.rows
          ? { columns: ["day", "worker", "times", "codes", "hours", "worked", "source"],
              rows: res.rows.map((r) => [Number(r.sheet), r.name, r.times, r.codes, r.hours, r.worked, r.source]) }
          : null); // prettier-ignore
        setResult({ grid, summary: res.summary, notes: res.notes, ms, sql });
      } else {
        const changes = changesOf(res, ctx);
        setPending((p) => [...p.filter((x) => !cell || x.cell !== cell), { sql, result: res, changes, cell }]);
        // from a Data grid edit the grid stays (the cell shows its new value); from the editor the
        // result line says what is waiting
        if (!cell) setResult({ grid: null, summary: `${res.summary} Look at the changes below, then add them to the waiting list.`, notes: res.notes, ms, sql });
      }
      setError(null);
      const h = [sql, ...readHistory().filter((x) => x !== sql)].slice(0, 40);
      store.set(HISTORY, JSON.stringify(h));
      return true;
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e), at: e instanceof CommandError ? e.at?.start : undefined });
      return false;
    }
  };

  /** Run the selection, else the statement under the cursor (statements end with ";"). */
  const run = () => {
    const el = editor.current;
    // the box itself, not the last render's copy: Ctrl+Enter right after typing must run all of it
    const now = el?.value ?? text;
    const sel = el && el.selectionEnd > el.selectionStart ? now.slice(el.selectionStart, el.selectionEnd) : null;
    const parts = splitSql(sel ?? now);
    if (!parts.length) return;
    const at = el?.selectionStart ?? 0;
    const one = sel ? parts : [parts.find((p) => at >= p.start && at <= p.end + 1) ?? parts[parts.length - 1]];
    for (const p of one) if (!runOne(p.text)) break;
    setApplied(null);
  };

  const runData = (table = dataTable, filter = dataFilter) => {
    setDataTable(table);
    setDataFilter(filter);
    setTab("data");
    const sql = `SELECT * FROM ${table}${filter.trim() ? ` WHERE ${filter.trim()}` : ""}`;
    const started = performance.now();
    try {
      const res = runSql(parseSql(sql, ctx), ctx);
      setResult({ grid: res.table ?? null, summary: res.summary, notes: res.notes, ms: Math.round(performance.now() - started), sql });
      setError(null);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e) });
    }
  };

  /** A cell changed in the Data grid: the UPDATE it means goes to the pending changes. */
  const editCell = (row: Cell[], columns: string[], col: string, value: string) => {
    const name = row[columns.indexOf("calling_name")];
    const day = row[columns.indexOf("day")];
    if (name === null || day === null) return;
    const v = value.trim() === "" ? "NULL" : col === "hours" || col === "additional" ? value.trim() : `'${value.trim().replace(/'/g, "''")}'`;
    const sql = `UPDATE entries SET ${col} = ${v} WHERE calling_name = '${String(name).replace(/'/g, "''")}' AND day = ${day}`;
    runOne(sql, `${name}|${day}|${col}|${value.trim()}`);
  };

  const applyAll = () => {
    const n = pending.reduce((s, p) => s + p.changes.length, 0);
    for (const p of pending) onApply(p.result);
    setPending([]);
    setApplied(`${n} change${n === 1 ? "" : "s"} added to the waiting list. Check them on the manpower sheet, then push.`);
  };

  // Ctrl+Enter or F9 runs from anywhere in the panel
  const onPanelKey = (e: React.KeyboardEvent) => {
    if ((e.key === "Enter" && (e.ctrlKey || e.metaKey)) || e.key === "F9") {
      e.preventDefault();
      if (tab === "data") runData();
      else run();
    }
  };

  if (!open)
    return (
      <section className="sqlws closed">
        <button className="link" onClick={() => setOpen(true)}>▸ SQL panel</button>{" "}
        <span className="muted small">SQL and commands: tables, query editor and result grid</span>
      </section>
    );

  return (
    <section className="sqlws" onKeyDown={onPanelKey}>
      <div className="sqlws-head">
        <h2>
          <button className="link" onClick={() => setOpen(false)} aria-expanded="true">▾ SQL panel</button>{" "}
          <span className="muted small">SQL or a command (copy, fill, move, set, …) · Ctrl+Enter or F9 runs · Ctrl+K from any tab · changes wait for you below</span>
        </h2>
      </div>
      <div className="sqlws-body">
        <aside className="sqlws-tree" aria-label="Tables">
          <div className="tree-title">Tables <span className="muted small">(this month)</span></div>
          {SQL_SCHEMA.map((tb) => (
            <div key={tb.name} className="tree-table">
              <div className="tree-row">
                <button className="tree-toggle" aria-label={`${expanded[tb.name] ? "Hide" : "Show"} columns of ${tb.name}`} onClick={() => setExpanded((x) => ({ ...x, [tb.name]: !x[tb.name] }))}>
                  {expanded[tb.name] ? "▾" : "▸"}
                </button>
                <button className="tree-name" title={`${tb.help}\nClick: browse it in the Data tab`} onClick={() => runData(tb.name, "")}>
                  ▦ {tb.name}
                </button>
                <span className="tree-count">{(counts[tb.name] ?? 0).toLocaleString()}</span>
              </div>
              {expanded[tb.name] && (
                <ul className="tree-cols">
                  {tb.cols.map((c) => (
                    <li key={c.name}>
                      <button className="tree-col" title={`${c.help}${c.writable ? "\nCan be changed with UPDATE." : ""}\nClick: insert into the query`} onClick={() => insertAtCursor(c.name)}>
                        <span className={`type t-${c.type}`}>{c.type === "number" ? "#" : c.type === "time" ? "⏱" : c.type === "date" ? "📅" : "A"}</span> {c.name}
                        {c.writable && <span className="tree-w" aria-label="can be changed">✎</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </aside>

        <div className="sqlws-main">
          <div className="sqlws-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "query"} className={tab === "query" ? "active" : ""} onClick={() => setTab("query")}>Query</button>
            <button role="tab" aria-selected={tab === "data"} className={tab === "data" ? "active" : ""} onClick={() => runData()}>Data: {dataTable}</button>
          </div>

          {tab === "query" ? (
            <>
              <div className="sqlws-toolbar">
                <button className="primary small" onClick={run} title="Run the selection, or the statement under the cursor (Ctrl+Enter / F9)">▶ Run</button>
                <select aria-label="Examples" value="" onChange={(e) => e.target.value && (setText(e.target.value), setTab("query"))}>
                  <option value="">Examples…</option>
                  {EXAMPLES.map(([label, sql]) => <option key={label} value={sql}>{label}</option>)}
                </select>
                <select aria-label="History" value="" onChange={(e) => e.target.value && setText(e.target.value)}>
                  <option value="">History…</option>
                  {readHistory().map((h, i) => <option key={i} value={h}>{h.replace(/\s+/g, " ").slice(0, 90)}</option>)}
                </select>
                <button className="link small" onClick={() => setText("")}>Clear</button>
              </div>
              <Editor taRef={editor} text={text} setText={setText} cursor={cursor} setCursor={setCursor} ctx={ctx} errorAt={error?.at} onRun={run} />
              <WordHelp text={text} cursor={cursor} ctx={ctx} />
            </>
          ) : (
            <div className="sqlws-toolbar data-filter">
              <span className="muted small">SELECT * FROM <b>{dataTable}</b> WHERE</span>
              <input
                aria-label="Filter"
                placeholder="e.g. day = 26 AND calling_name LIKE 'BCC%'   (empty: every row)"
                value={dataFilter}
                onChange={(e) => setDataFilter(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runData()}
              />
              <button className="primary small" onClick={() => runData()}>Filter</button>
              {dataFilter && <button className="link small" onClick={() => runData(dataTable, "")}>Clear</button>}
            </div>
          )}

          {error && (
            <div className="sqlws-error" role="alert">
              <b>Error</b> {error.message}
            </div>
          )}
          {result && !error && (
            <ResultGrid
              key={result.sql}
              result={result}
              editable={tab === "data" && dataTable === "entries"}
              onEdit={editCell}
              edits={pending.filter((x) => x.cell).map((x) => x.cell!)}
            />
          )}
          {pending.length > 0 && (
            <PendingChanges pending={pending} onDiscard={(i) => setPending((p) => p.filter((_, n) => n !== i))} onApply={applyAll} onClear={() => setPending([])} />
          )}
          {applied && (
            <p className="ok-text small">
              ✓ {applied}{" "}
              <button className="link small" onClick={onReview}>To the manpower sheet ({waiting}) →</button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------------- editor

function highlight(src: string, errorAt?: number): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(--[^\n]*)|('(?:[^']|'')*'?|"[^"]*"?|`[^`]*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)|(\s+)|([^\sA-Za-z_\d'"`]+)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(src))) {
    const [tok] = m;
    const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "n" : m[4] ? (KEYWORDS.test(tok) ? "k" : TABLE_NAMES.has(tok.toLowerCase()) ? "tb" : COL_NAMES.has(tok.toLowerCase()) ? "col" : "id") : m[6] ? "op" : "";
    const err = errorAt !== undefined && errorAt >= m.index && errorAt < m.index + tok.length;
    out.push(cls || err ? <span key={i++} className={`${cls}${err ? " err" : ""}`}>{tok}</span> : tok);
  }
  out.push("\n"); // keeps the last line's height
  return out;
}

const LINE = 20; // px, matches the CSS
const PAD = 8;

function Editor({ taRef: ref, text, setText, cursor, setCursor, ctx, errorAt, onRun }: {
  taRef: React.RefObject<HTMLTextAreaElement>;
  text: string;
  setText: (t: string) => void;
  cursor: number;
  setCursor: (n: number) => void;
  ctx: CommandContext;
  errorAt?: number;
  onRun: () => void;
}) {
  const back = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState(false);
  const [pick, setPick] = useState(0);
  const [charW, setCharW] = useState(7.8);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const probe = document.createElement("span");
    probe.className = "sqlws-probe";
    probe.textContent = "M".repeat(50);
    document.body.appendChild(probe);
    setCharW(probe.getBoundingClientRect().width / 50 || 7.8);
    probe.remove();
  }, []);
  const lines = text.split("\n").length;
  const sugg = useMemo(
    () => (!pop ? { from: cursor, items: [] } : sqlTyping(text) ? suggestSql(text, cursor, ctx, 12) : suggest(text, cursor, ctx, 12)),
    [pop, text, cursor, ctx],
  );
  const lineNo = text.slice(0, sugg.from).split("\n").length - 1;
  const col = sugg.from - (text.lastIndexOf("\n", sugg.from - 1) + 1);

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    if (back.current) {
      back.current.scrollTop = el.scrollTop;
      back.current.scrollLeft = el.scrollLeft;
    }
    if (gutter.current) gutter.current.scrollTop = el.scrollTop;
    setScroll({ top: el.scrollTop, left: el.scrollLeft });
  };
  // Put text into the box at once, cursor and all, from what is in the box now (not the last
  // render's copy): keys typed right after Tab must land after the completed word, in order.
  const put = (next: string, pos: number) => {
    const el = ref.current;
    if (el) {
      el.value = next;
      el.setSelectionRange(pos, pos);
    }
    setText(next);
    setCursor(pos);
  };
  const accept = (word: string) => {
    const el = ref.current;
    const now = el?.value ?? text;
    const caret = el?.selectionStart ?? cursor;
    setPop(false);
    put(`${now.slice(0, sugg.from)}${word}${now.slice(caret)}`, sugg.from + word.length);
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const items = pop ? sugg.items : [];
    if ((e.key === "Enter" && (e.ctrlKey || e.metaKey)) || e.key === "F9") {
      e.preventDefault();
      e.stopPropagation();
      setPop(false);
      onRun();
    } else if (e.key === " " && e.ctrlKey) {
      e.preventDefault();
      setPop(true);
      setPick(0);
    } else if (items.length && e.key === "ArrowDown") {
      e.preventDefault();
      setPick((p) => Math.min(p + 1, items.length - 1));
    } else if (items.length && e.key === "ArrowUp") {
      e.preventDefault();
      setPick((p) => Math.max(p - 1, 0));
    } else if (items.length && (e.key === "Tab" || e.key === "Enter")) {
      e.preventDefault();
      accept(items[Math.min(pick, items.length - 1)].insert);
    } else if (e.key === "Escape") {
      setPop(false);
    } else if (e.key === "Tab") {
      e.preventDefault(); // a tab in the editor is two spaces
      const el = e.currentTarget;
      const at = el.selectionStart;
      put(`${el.value.slice(0, at)}  ${el.value.slice(el.selectionEnd)}`, at + 2);
    }
  };
  return (
    <div className="sqlws-editor">
      <div className="gutter" ref={gutter} aria-hidden>
        {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <div className="code">
        <pre ref={back} className="hl" aria-hidden>{highlight(text, errorAt)}</pre>
        <textarea
          ref={ref}
          aria-label="SQL query"
          spellCheck={false}
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCursor(e.target.selectionStart);
            const typed = e.target.value.slice(0, e.target.selectionStart);
            setPop(/[A-Za-z_]$/.test(typed));
            setPick(0);
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onClick={() => setPop(false)}
          onBlur={() => setTimeout(() => setPop(false), 150)}
          onScroll={sync}
          onKeyDown={onKey}
        />
        {pop && sugg.items.length > 0 && (
          <ul className="sqlws-pop" role="listbox" style={{ top: PAD + (lineNo + 1) * LINE - scroll.top, left: PAD + col * charW - scroll.left }}>
            {sugg.items.map((s, i) => (
              <li key={s.insert + i} role="option" aria-selected={i === pick} className={i === pick ? "active" : ""} onMouseDown={(e) => { e.preventDefault(); accept(s.insert); }}>
                <b>{s.label}</b> <span className="muted small">{s.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The word under the cursor, explained (what a keyword does, what a column holds). */
function WordHelp({ text, cursor, ctx }: { text: string; cursor: number; ctx: CommandContext }) {
  const word = useMemo(() => {
    const left = text.slice(0, cursor).match(/[\w`'"]*$/)?.[0] ?? "";
    const right = text.slice(cursor).match(/^[\w`'"]*/)?.[0] ?? "";
    return left + right;
  }, [text, cursor]);
  const info = !word
    ? null
    : sqlTyping(text)
      ? explainSql(word, text, ctx)
      : explain(word, ctx, tokenize(text.slice(0, cursor)).map((t) => t.text).slice(0, -1));
  return (
    <div className="sqlws-help small">
      {info ? (
        <>
          <b>{info.name}</b> <span className="muted">{info.kind}</span> · {info.text}
        </>
      ) : (
        <span className="muted">SQL (SELECT … FROM entries) or a command (copy INB-01 from 26 to 21) · Ctrl+Space: suggestions · statements end with ; and Run takes the one under the cursor · -- starts a comment</span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------ result grid

function ResultGrid({ result, editable, onEdit, edits = [] }: {
  result: { grid: Grid | null; summary: string; notes: string[]; ms: number; sql: string };
  editable: boolean;
  onEdit: (row: Cell[], columns: string[], col: string, value: string) => void;
  edits?: string[]; // "name|day|col|new value" of cells changed in this grid, still waiting
}) {
  const editMap = useMemo(() => new Map(edits.map((e) => { const [n, d, c, ...v] = e.split("|"); return [`${n}|${d}|${c}`, v.join("|")]; })), [edits]);
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; v: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const g = result.grid;
  const rows = useMemo(() => {
    if (!g) return [];
    const list = g.rows.map((r, i) => ({ r, i }));
    if (sort)
      list.sort((a, b) => {
        const x = a.r[sort.col], y = b.r[sort.col];
        if (x === y) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
        return sort.desc ? -c : c;
      });
    return list;
  }, [g, sort]);
  const numeric = useMemo(() => (g ? g.columns.map((_, c) => g.rows.some((r) => typeof r[c] === "number")) : []), [g]);
  const canEdit = (col: string) => editable && ["in", "out", "code", "hours", "additional", "remark"].includes(col);

  const copyCsv = () => {
    if (!g) return;
    const esc = (v: Cell) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [g.columns, ...g.rows].map((r) => r.map(esc).join(",")).join("\n");
    navigator.clipboard?.writeText(csv).catch(() => undefined);
  };
  const exportXlsx = async () => {
    if (!g) return;
    setExporting(true);
    try {
      const blob = await api.exportAnalysis("SQL result", [{ name: "Result", note: result.sql.replace(/\s+/g, " "), columns: g.columns, rows: g.rows }]);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "SQL result.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="sqlws-result">
      <div className="sqlws-status small">
        <span>{result.summary}</span>
        <span className="muted"> · {result.ms} ms</span>
        {g && g.rows.length > 0 && (
          <>
            <button className="link small" onClick={copyCsv}>Copy</button>
            <button className="link small" onClick={exportXlsx} disabled={exporting}>{exporting ? "Exporting…" : "Export to Excel"}</button>
          </>
        )}
      </div>
      {result.notes.map((n) => <p key={n} className="warn-text small">{n}</p>)}
      {g && (
        <div className="sqlws-grid-wrap">
          <table className="sqlws-grid">
            <thead>
              <tr>
                <th className="rn">#</th>
                {g.columns.map((c, i) => (
                  <th key={i} className={numeric[i] ? "num" : ""}>
                    <button className="sort" onClick={() => setSort((s) => ({ col: i, desc: s?.col === i ? !s.desc : false }))}>
                      {c}{sort?.col === i ? (sort.desc ? " ▾" : " ▴") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, SHOWN_ROWS).map(({ r, i }, n) => (
                <tr key={i}>
                  <td className="rn">{n + 1}</td>
                  {r.map((v, c) => {
                    const col = g.columns[c];
                    const isEditing = editing && editing.r === i && editing.c === c;
                    const changed = editable ? editMap.get(`${r[g.columns.indexOf("calling_name")]}|${r[g.columns.indexOf("day")]}|${col}`) : undefined;
                    return (
                      <td
                        key={c}
                        className={`${numeric[c] ? "num" : ""}${v === null && changed === undefined ? " null" : ""}${canEdit(col) ? " editable" : ""}${changed !== undefined ? " changed" : ""}`}
                        onDoubleClick={() => canEdit(col) && setEditing({ r: i, c, v: v === null ? "" : String(v) })}
                        title={canEdit(col) ? "Double-click to change" : undefined}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            aria-label={`New ${col}`}
                            value={editing.v}
                            onChange={(e) => setEditing({ ...editing, v: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                onEdit(r, g.columns, col, editing.v);
                                setEditing(null);
                              } else if (e.key === "Escape") setEditing(null);
                            }}
                            onBlur={() => setEditing(null)}
                          />
                        ) : changed !== undefined ? (
                          <span title={`Now ${v ?? "(NULL)"}; waiting to change`}>{changed || "(NULL)"}</span>
                        ) : v === null ? (
                          "(NULL)"
                        ) : (
                          String(v)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > SHOWN_ROWS && (
            <p className="muted small">Showing the first {SHOWN_ROWS.toLocaleString()} of {rows.length.toLocaleString()} rows. Narrow it with WHERE or LIMIT, or Export to Excel for all.</p>
          )}
          {rows.length === 0 && <p className="muted small">No rows.</p>}
          {editable && <p className="muted small">Double-click In, Out, code, hours, additional or remark to change it: the change waits below until you add it to the waiting list.</p>}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------- pending changes

const KIND: Record<Change["kind"], string> = { insert: "New", update: "Change", delete: "Clear", unqueue: "Drop from waiting list" };

function PendingChanges({ pending, onDiscard, onApply, onClear }: { pending: Pending[]; onDiscard: (i: number) => void; onApply: () => void; onClear: () => void }) {
  const total = pending.reduce((s, p) => s + p.changes.length, 0);
  return (
    <div className="sqlws-pending">
      <div className="sqlws-status">
        <b>Changes waiting for you ({total})</b>
        <span className="muted small"> · nothing is in the waiting list or Excel yet</span>
      </div>
      {pending.map((p, i) => (
        <div key={i} className="pending-block">
          <div className="pending-sql">
            <code>{p.sql.replace(/\s+/g, " ")}</code>
            <button className="link small" onClick={() => onDiscard(i)}>Discard</button>
          </div>
          {p.result.notes.map((n) => <p key={n} className="warn-text small">{n}</p>)}
          <table className="sqlws-grid changes">
            <thead>
              <tr><th>What</th><th>Day</th><th>Worker</th><th>Field</th><th>Now</th><th>After</th></tr>
            </thead>
            <tbody>
              {p.changes.slice(0, 300).flatMap((c, n) => {
                const fields = c.fields.length ? c.fields : [{ label: "", before: "", after: "" }];
                return fields.map((f, k) => (
                  <tr key={`${n}-${k}`} className={`ch-${c.kind}`}>
                    {k === 0 && <td rowSpan={fields.length}><span className={`badge ch-badge ch-${c.kind}`}>{KIND[c.kind]}</span></td>}
                    {k === 0 && <td rowSpan={fields.length}>{c.sheet}</td>}
                    {k === 0 && <td rowSpan={fields.length}><b>{c.name}</b></td>}
                    <td>{f.label}</td>
                    <td className="before">{f.before}</td>
                    <td className="after">{f.after}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
          {p.changes.length > 300 && <p className="muted small">… and {p.changes.length - 300} more.</p>}
        </div>
      ))}
      <div className="actions">
        <button className="primary" onClick={onApply} disabled={!total}>Add {total} change{total === 1 ? "" : "s"} to the waiting list</button>
        <button className="link" onClick={onClear}>Discard all</button>
      </div>
    </div>
  );
}
