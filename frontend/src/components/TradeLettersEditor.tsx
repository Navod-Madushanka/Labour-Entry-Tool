import { useEffect, useState } from "react";
import { api, type Master, type TradeLetters } from "../api";
import { CardHelp } from "./CardHelp";

type Row = { letter: string; trade: string };
const rowsOf = (letters: Record<string, string>): Row[] =>
  Object.entries(letters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, trade]) => ({ letter, trade }));

/** Codes & registration: a worker's trade comes from the last letter of the calling name's group
 * (INR-01: R = Rigger, ADB-100: B = Barbender); a letter not in this list falls back to the trade
 * column of Labour Detail. Kept for every workbook. */
export function TradeLettersEditor({ master, onChanged }: { master: Master; onChanged: () => void }) {
  const [view, setView] = useState<TradeLetters | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = (v: TradeLetters) => {
    setView(v);
    setRows([...rowsOf(v.letters), { letter: "", trade: "" }]);
  };
  useEffect(() => {
    api.tradeLetters().then(show).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const fromColumn = master.workers.filter((w) => w.trade_source === "column");
  const set = (n: number, patch: Partial<Row>) =>
    setRows((r) => {
      const next = r.map((x, i) => (i === n ? { ...x, ...patch } : x));
      return next[next.length - 1].letter || next[next.length - 1].trade ? [...next, { letter: "", trade: "" }] : next;
    });
  const save = async (letters: Record<string, string>) => {
    setBusy(true);
    setSaved(null);
    setError(null);
    try {
      show(await api.saveTradeLetters(letters));
      setSaved("Saved. Analysis, the SQL panel and the crews use these trades now.");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card trade-letters">
      <h2>
        Trades by calling-name letter {view && <span className="h-count">{Object.keys(view.letters).length}</span>}
      </h2>
      <CardHelp id="trades">
        A worker's trade comes from the last letter before the "-" in the calling name: INR-01 is a Rigger, ADB-100 a
        Barbender. A letter not in this list, or a name that does not follow the pattern, takes the trade column of
        Labour Detail. Kept for every workbook. Excel is not changed.
      </CardHelp>
      {error && <p className="error-text">{error}</p>}
      {!view ? (
        <p className="muted small">Loading…</p>
      ) : (
        <>
          <table className="data trade-table">
            <thead>
              <tr>
                <th>Letter</th>
                <th>Trade</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n}>
                  <td>
                    <input
                      className="letter-chip"
                      aria-label={`Letter ${n + 1}`}
                      value={r.letter}
                      maxLength={2}
                      placeholder={n === rows.length - 1 ? "+" : ""}
                      title={n === rows.length - 1 ? "A new letter" : undefined}
                      onChange={(e) => set(n, { letter: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })}
                    />
                  </td>
                  <td>
                    <input aria-label={`Trade for ${r.letter || `letter ${n + 1}`}`} value={r.trade} placeholder={n === rows.length - 1 ? "trade" : ""} onChange={(e) => set(n, { trade: e.target.value })} />
                  </td>
                  <td>
                    {n < rows.length - 1 && (
                      <button className="link small danger" title="Take this letter off: its workers take the trade column" onClick={() => setRows((x) => x.filter((_, i) => i !== n))}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {Object.keys(view.unmatched).length > 0 && (
            <p className="warn-text small">
              Letters in Labour Detail with no trade here (they take the trade column):{" "}
              {Object.entries(view.unmatched)
                .sort((a, b) => b[1] - a[1])
                .map(([l, n]) => `${l} (${n} worker${n === 1 ? "" : "s"})`)
                .join(", ")}
            </p>
          )}
          {fromColumn.length > 0 && (
            <p className="muted small">
              From the trade column now: {fromColumn.length} worker{fromColumn.length === 1 ? "" : "s"} (
              {fromColumn
                .slice(0, 8)
                .map((w) => w.calling_name)
                .join(", ")}
              {fromColumn.length > 8 ? " …" : ""}).
            </p>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => save(Object.fromEntries(rows.filter((r) => r.letter && r.trade.trim()).map((r) => [r.letter, r.trade])))}
            >
              Save trades
            </button>
            <button
              className="link small quiet"
              disabled={busy}
              title={Object.entries(view.known).map(([l, t]) => `${l}: ${t}`).join(", ")}
              onClick={() => window.confirm("Replace your letters with the tool's own list?\n\n" + Object.entries(view.known).map(([l, t]) => `${l}: ${t}`).join("\n")) && save(view.known)}
            >
              Back to the tool's list
            </button>
            {saved && <span className="ok-text small">{saved}</span>}
          </div>
        </>
      )}
    </section>
  );
}
