import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_VERBS,
  CommandError,
  explain,
  parse,
  run,
  suggest,
  tokenize,
  type CommandContext,
  type CommandResult,
  type WordInfo,
} from "../commands";
import { explainSql, looksSql, parseSql, runSql, sqlTokens, suggestSql, SQL_TABLES } from "../sql";
import { fmtHours } from "../time";
import { store } from "../store";

const HISTORY = "labour.commands";
let handledFocus = 0; // the last Ctrl+K served (the box comes back each time the tab is opened)
const readHistory = (): string[] => {
  try {
    return JSON.parse(store.get(HISTORY) ?? "[]");
  } catch {
    return [];
  }
};

interface Props {
  ctx: CommandContext;
  onApply: (result: CommandResult) => void; // put the entries in the queue (nothing is written)
  waiting: number; // entries in the queue now (they are checked and pushed on the entry screen)
  onReview: () => void; // to the entry screen
  focusToken: number; // changes when Ctrl+K asks for the box
}

/** Many changes at once by typing: "set out 20 for INB-01 on 1-10", "copy … from 26 to 21".
 * Suggestions complete the word, a card explains it (synonyms name the command), and a preview
 * says what will happen before Enter. The result only goes into the queue. */
export function CommandBar({ ctx, onApply, waiting, onReview, focusToken }: Props) {
  const [open, setOpen] = useState(() => store.get("labour.commands.open") === "1");
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pick, setPick] = useState(-1); // -1: no suggestion chosen, Enter runs the command
  const [showList, setShowList] = useState(false);
  const [done, setDone] = useState<CommandResult | null>(null);
  const [help, setHelp] = useState(false);
  const [hist, setHist] = useState<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const sqlMode = looksSql(text); // SELECT … FROM, INSERT INTO, UPDATE … SET, DELETE FROM (or on its way)

  // Ctrl+K (handled by the app, from any tab): open the box and put the cursor in it, once per press
  useEffect(() => {
    if (!focusToken || focusToken === handledFocus) return;
    handledFocus = focusToken;
    setOpen(true);
    store.set("labour.commands.open", "1");
    setTimeout(() => box.current?.focus(), 0);
  }, [focusToken]);

  const sugg = useMemo(
    () => (!open ? { from: 0, items: [] } : sqlMode ? suggestSql(text, cursor, ctx) : suggest(text, cursor, ctx)),
    [open, text, cursor, ctx, sqlMode],
  );
  // The word under the cursor explains itself; otherwise the command's card.
  const card: WordInfo | null = useMemo(() => {
    if (sqlMode) {
      const tokens = sqlTokens(text);
      const at = tokens.find((t) => cursor >= t.start && cursor <= t.end) ?? tokens[tokens.length - 1];
      return (at && explainSql(at.text, text, ctx)) || explainSql(tokens[0]?.text ?? "", text, ctx);
    }
    const tokens = tokenize(text);
    const at = tokens.find((t) => cursor >= t.start && cursor <= t.end) ?? tokens[tokens.length - 1];
    const prev = at ? tokens.slice(0, tokens.indexOf(at)).map((t) => t.text) : [];
    return (at && explain(at.text, ctx, prev)) || (tokens[0] && explain(tokens[0].text, ctx)) || null;
  }, [text, cursor, ctx]);
  const verbCard = useMemo(() => {
    if (sqlMode) return null;
    const first = tokenize(text)[0];
    const e = first ? explain(first.text, ctx) : null;
    return e?.kind === "command" ? e : null;
  }, [text, ctx, sqlMode]);
  // A dry run while typing: what Enter would do, or what is wrong.
  const preview = useMemo((): { result?: CommandResult; error?: string; at?: number } => {
    if (!text.trim()) return {};
    try {
      return { result: sqlMode ? runSql(parseSql(text, ctx), ctx) : run(parse(text, ctx), ctx) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), at: e instanceof CommandError ? e.at?.start : undefined };
    }
  }, [text, ctx, sqlMode]);

  const accept = (insert: string) => {
    const before = text.slice(0, sugg.from);
    const after = text.slice(cursor).replace(/^[^\s,]*/, "");
    const next = `${before}${insert} ${after.trimStart()}`;
    setText(next);
    const pos = before.length + insert.length + 1;
    setCursor(pos);
    setPick(-1);
    requestAnimationFrame(() => box.current?.setSelectionRange(pos, pos));
  };

  const execute = () => {
    if (!preview.result) return;
    const res = preview.result;
    if (res.verb !== "SHOW" && res.verb !== "SELECT") onApply(res);
    setDone(res);
    const h = [text.trim(), ...readHistory().filter((x) => x !== text.trim())].slice(0, 30);
    store.set(HISTORY, JSON.stringify(h));
    setHist(null);
    setShowList(false); // the suggestions would cover the result (and the button to the queue)
    if (res.verb !== "SHOW" && res.verb !== "SELECT") setText("");
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const items = showList ? sugg.items : [];
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setPick((p) => Math.min(p + 1, items.length - 1));
    } else if (e.key === "ArrowUp" && items.length && pick >= 0) {
      e.preventDefault();
      setPick((p) => p - 1);
    } else if (e.key === "ArrowUp" && (!text || hist !== null) && !text.includes("\n")) {
      // history
      e.preventDefault();
      const h = readHistory();
      const n = Math.min((hist ?? -1) + 1, h.length - 1);
      if (n >= 0) {
        setHist(n);
        setText(h[n]);
        setCursor(h[n].length);
      }
    } else if (e.key === "Tab" && items.length) {
      e.preventDefault();
      accept(items[Math.max(pick, 0)].insert);
    } else if (e.key === "Enter" && !e.shiftKey) {
      // Enter runs; Shift+Enter starts a new line (SQL over several lines)
      e.preventDefault();
      if (items.length && pick >= 0) accept(items[pick].insert);
      else execute();
    } else if (e.key === "Escape") {
      if (showList && items.length) setShowList(false);
      else setText("");
    }
  };

  return (
    <section className="commands">
      <div className="section-head">
        <h2>
          <button
            className="link commands-toggle"
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
              store.set("labour.commands.open", open ? "0" : "1");
            }}
          >
            {open ? "▾" : "▸"} Commands
          </button>{" "}
          <span className="muted small">change many entries at once by typing · Ctrl+K from any tab</span>
        </h2>
        {open && (
          <button className="link small" onClick={() => setHelp((h) => !h)}>
            {help ? "Hide the list" : "All commands"}
          </button>
        )}
      </div>
      {open && (
        <>
          <div className="command-input">
            <span className="prompt">›</span>
            <textarea
              ref={box}
              aria-label="Command"
              spellCheck={false}
              autoComplete="off"
              rows={Math.min(8, Math.max(1, text.split("\n").length))}
              value={text}
              placeholder="e.g. set out 20 for INB-01 on 1-10   ·   copy INB-01, INB-02 from 26 to 21   ·   SELECT calling_name, hours FROM entries WHERE hours > 8"
              onChange={(e) => {
                setText(e.target.value);
                setCursor(e.target.selectionStart ?? e.target.value.length);
                setPick(-1);
                setShowList(true);
                setDone(null);
              }}
              onKeyUp={(e) => setCursor(e.currentTarget.selectionStart ?? text.length)}
              onClick={(e) => setCursor(e.currentTarget.selectionStart ?? text.length)}
              onFocus={() => setShowList(true)}
              onBlur={() => setTimeout(() => setShowList(false), 150)}
              onKeyDown={onKey}
            />
            {showList && sugg.items.length > 0 && (
              <ul className="dropdown command-suggest" role="listbox">
                {sugg.items.map((s, i) => (
                  <li
                    key={`${s.insert}-${i}`}
                    role="option"
                    aria-selected={i === pick}
                    className={i === pick ? "active" : ""}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      accept(s.insert);
                    }}
                  >
                    <code>{s.label}</code> <span className="muted small">{s.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <small className="muted">
            <kbd>Tab</kbd> takes a suggestion · <kbd>Enter</kbd> runs · <kbd>↑</kbd> earlier commands. Nothing is written: the
            entries go to the queue, to check on the manpower sheet and push.
          </small>

          <div className="command-panels">
            {card && (
              <div className="command-card" aria-live="polite">
                <div className="card-head">
                  <b className="word">{card.name}</b> <span className="kind">{card.kind}</span>
                </div>
                <p>{card.text}</p>
                {card.syntax && <code className="syntax">{card.syntax}</code>}
                {card.examples && (
                  <ul className="examples">
                    {card.examples.map((x) => (
                      <li key={x}>
                        <button className="link" onClick={() => { setText(x); setCursor(x.length); box.current?.focus(); }}>
                          {x}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {card.synonyms.length > 1 && <small className="muted">Also: {card.synonyms.filter((s) => s !== card.name.toLowerCase()).join(", ")}</small>}
                {verbCard && verbCard.name !== card.name && (
                  <small className="muted block">
                    In {verbCard.name}: <code>{verbCard.syntax}</code>
                  </small>
                )}
              </div>
            )}
            {text.trim() && (
              <div className={`command-preview${preview.error ? " bad" : ""}`} role="status">
                {preview.error ? (
                  <p className="error-text">{preview.error}</p>
                ) : preview.result ? (
                  <>
                    <p>
                      <b>Enter will:</b> {preview.result.summary}
                    </p>
                    {preview.result.notes.map((n) => (
                      <p key={n} className="muted small">
                        {n}
                      </p>
                    ))}
                  </>
                ) : null}
              </div>
            )}
          </div>

          {done && done.verb !== "SHOW" && done.verb !== "SELECT" && (
            <p className="notice">
              ✓ {done.summary} In the queue now. Check them on the manpower sheet of the entry screen, then push (Undo works
              as for any push).
            </p>
          )}
          {waiting > 0 && (
            <div className="actions commands-waiting">
              <button className="primary" onClick={onReview}>
                Check and push {waiting} waiting {waiting === 1 ? "entry" : "entries"} →
              </button>
              <span className="muted small">on the entry screen</span>
            </div>
          )}
          {done?.table && (
            <div className="command-rows">
              <p>
                <b>{done.summary}</b>
              </p>
              <div className="table-wrap daylist-scroll">
                <table>
                  <thead>
                    <tr>
                      {done.table.columns.map((c, n) => (
                        <th key={`${c}-${n}`}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {done.table.rows.slice(0, 1000).map((r, i) => (
                      <tr key={i}>
                        {r.map((v, n) => (
                          <td key={n} className={typeof v === "number" ? "num" : undefined}>
                            {v === null ? "" : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {done.table.rows.length > 1000 && <p className="muted small">First 1000 of {done.table.rows.length} rows shown.</p>}
            </div>
          )}
          {done?.rows && (
            <div className="command-rows">
              <p>
                <b>{done.summary}</b>
              </p>
              <div className="table-wrap daylist-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Worker</th>
                      <th>In–Out</th>
                      <th>Activities</th>
                      <th>Worked</th>
                      <th>From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {done.rows.slice(0, 500).map((r) => (
                      <tr key={`${r.sheet}-${r.name}`}>
                        <td>{r.sheet}</td>
                        <td>
                          <b>{r.name}</b>
                        </td>
                        <td>{r.times}</td>
                        <td className="small">{r.codes}</td>
                        <td>{r.worked === null ? "—" : fmtHours(r.worked)}</td>
                        <td className="muted small">{r.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {done.rows.length > 500 && <p className="muted small">First 500 of {done.rows.length} shown.</p>}
            </div>
          )}

          {help && (
            <div className="command-help">
              {ALL_VERBS.map((v) => (
                <div key={v.name} className="command-card">
                  <div className="card-head">
                    <b className="word">{v.name}</b> <span className="muted small">also {v.synonyms.slice(0, 5).join(", ")}…</span>
                  </div>
                  <p>{v.text}</p>
                  <code className="syntax">{v.syntax}</code>
                  <ul className="examples">
                    {v.examples!.map((x) => (
                      <li key={x}>
                        <button className="link" onClick={() => { setText(x); setCursor(x.length); setHelp(false); box.current?.focus(); }}>
                          {x}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="command-card sql-help">
                <div className="card-head">
                  <b className="word">SQL</b> <span className="muted small">for those who know it</span>
                </div>
                <p>
                  SELECT, INSERT, UPDATE and DELETE work too, on these tables (column names are forgiving: `in times`, InTime and
                  in_time are all <code>in</code>; ZIDAL is the employee code). INSERT, UPDATE and DELETE only fill the queue;
                  UPDATE and DELETE need a WHERE.
                </p>
                <ul className="examples">
                  {SQL_TABLES.map((t) => (
                    <li key={t.name}>
                      <b>{t.name}</b>
                      {t.aliases.length ? <span className="muted small"> (also {t.aliases.slice(0, 3).join(", ")})</span> : null}: <span className="small">{t.cols.join(", ")}</span>
                    </li>
                  ))}
                </ul>
                <ul className="examples">
                  {[
                    "SELECT calling_name FROM workers WHERE calling_name LIKE 'B%' OR calling_name LIKE '%S'",
                    "SELECT calling_name, hours, ot FROM entries WHERE hours > 8 ORDER BY hours DESC",
                    "SELECT code, SUM(hours) AS total_hours, SUM(ot) AS total_ot FROM entries GROUP BY code",
                    "UPDATE entries SET out = '20:00' WHERE calling_name = 'INB-01' AND day BETWEEN 1 AND 10",
                    "DELETE FROM entries WHERE calling_name LIKE 'INB%' AND day = 15",
                  ].map((x) => (
                    <li key={x}>
                      <button className="link" onClick={() => { setText(x); setCursor(x.length); setHelp(false); box.current?.focus(); }}>
                        {x}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="muted small">
                Workers: names, INB-01..INB-20, a prefix (INB), all, crew of INB-03, trade Carpenter, except …. Days: 3, 1-10,
                all, weekdays, saturdays, sundays, holidays, today, yesterday. WHERE: in, out, code, hours, worked, additional,
                remark with =, !=, &lt;, &gt;, &lt;=, &gt;=, like (with *), contains, empty; join with and.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
