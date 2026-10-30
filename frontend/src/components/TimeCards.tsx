import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Master, type PrintJob, type TimeCardSheet, type Worker } from "../api";
import type { Month } from "../history";

const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/\s+/g, "");

/** "INB-01 to INB-20, INC-05" -> the workers, in that order. A range takes every calling name with
 * that prefix and a number in between (INB-01 … INB-20 that exist in Labour Detail). */
export function parseCardList(text: string, workers: Worker[]): { names: string[]; unknown: string[] } {
  const names: string[] = [];
  const unknown: string[] = [];
  const add = (n: string) => !names.includes(n) && names.push(n);
  for (const token of text.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean)) {
    const range = token.match(/^(.+?)\s*(?:\bto\b|\.\.|–|—)\s*(.+)$/i);
    if (range) {
      const a = norm(range[1]).match(/^(.*?)(\d+)$/);
      const b = norm(range[2]).match(/^(.*?)(\d+)$/);
      if (a && b && (!b[1] || b[1] === a[1])) {
        const [lo, hi] = [Number(a[2]), Number(b[2])].sort((x, y) => x - y);
        const hits = workers
          .map((w) => ({ w, m: norm(w.calling_name).match(/^(.*?)(\d+)$/) }))
          .filter(({ m }) => m && m[1] === a[1] && Number(m[2]) >= lo && Number(m[2]) <= hi)
          .sort((x, y) => Number(x.m![2]) - Number(y.m![2]));
        if (hits.length) hits.forEach(({ w }) => add(w.calling_name));
        else unknown.push(token);
        continue;
      }
    }
    const q = norm(token);
    const exact = workers.find((w) => norm(w.calling_name) === q);
    const starts = workers.filter((w) => norm(w.calling_name).startsWith(q));
    const w = exact ?? (starts.length === 1 ? starts[0] : undefined);
    if (w) add(w.calling_name);
    else unknown.push(token);
  }
  return { names, unknown };
}

interface Props {
  master: Master;
  month: Month;
  user: string;
}

/** Print one time card per calling name: Excel fills the card and prints it with its own setup. */
export function TimeCards({ master, month, user }: Props) {
  const [sheets, setSheets] = useState<TimeCardSheet[] | null>(null);
  const [sheet, setSheet] = useState("");
  const [cell, setCell] = useState("");
  const [text, setText] = useState("");
  const [copies, setCopies] = useState(1);
  const [job, setJob] = useState<PrintJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null); // "67 names from Book2.xlsx (Sheet1, column A)"
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // A file of calling names (the order of the file is the print order): its names fill the list.
  const loadFile = async (file: File) => {
    setError(null);
    setLoaded(null);
    try {
      const res = await api.timecardList(file);
      setText(res.names.join("\n"));
      setLoaded(`${res.names.length} name${res.names.length === 1 ? "" : "s"} from ${file.name} (${res.source})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    api
      .timecards()
      .then((s) => {
        setSheets(s);
        if (s[0]) {
          setSheet(s[0].sheet);
          setCell(s[0].cell ?? "");
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    api.printJob().then(setJob).catch(() => undefined);
  }, []);

  // Follow a running job.
  useEffect(() => {
    if (!job?.running) return;
    const t = setInterval(() => api.printJob().then(setJob).catch(() => undefined), 700);
    return () => clearInterval(t);
  }, [job?.running]);

  const { names, unknown } = useMemo(() => parseCardList(text, master.workers), [text, master.workers]);
  const chosen = sheets?.find((s) => s.sheet === sheet);
  const worked = useMemo(() => {
    const seen = new Set(Object.values(month).flatMap((d) => d.entries.map((v) => v.entry.calling_name)));
    return master.workers.filter((w) => seen.has(w.calling_name)).map((w) => w.calling_name);
  }, [month, master.workers]);

  const print = async () => {
    if (!names.length || !sheet || !cell) return;
    if (
      !window.confirm(
        `Print ${names.length} time card${names.length === 1 ? "" : "s"} from "${sheet}"${copies > 1 ? `, ${copies} copies each` : ""}?\n\n` +
          "Excel prints with the print area, page setup and printer set in Excel. Check them before you start.",
      )
    )
      return;
    setError(null);
    try {
      setJob(await api.printCards(sheet, cell, names, copies, user));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const running = Boolean(job?.running);
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <section className="timecards">
      <div className="section-head">
        <h2>Print time cards</h2>
      </div>
      <p className="muted">
        Set up the time card sheet in Excel first: print area, page setup and the printer. The tool then puts each calling
        name into the card, Excel fills in the rest, and the card is printed. One card per worker, without the print dialog.
      </p>
      {error && <p className="error-text">{error}</p>}
      {sheets && !sheets.length && (
        <p className="warn-text">No time card sheet found in this workbook (a sheet with "Time Card" in its name).</p>
      )}
      {chosen?.practice && (
        <p className="notice">Practice mode: nothing is printed. The run only shows what would be printed.</p>
      )}

      {sheets && sheets.length > 0 && (
        <div className="tc-grid">
          <div className="field">
            <label htmlFor="tc-sheet">Time card sheet</label>
            <select
              id="tc-sheet"
              value={sheet}
              disabled={running}
              onChange={(e) => {
                setSheet(e.target.value);
                setCell(sheets.find((s) => s.sheet === e.target.value)?.cell ?? "");
              }}
            >
              {sheets.map((s) => (
                <option key={s.sheet}>{s.sheet}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tc-cell">Calling name cell</label>
            <input id="tc-cell" value={cell} disabled={running} onChange={(e) => setCell(e.target.value.toUpperCase().trim())} placeholder="e.g. E8" />
            <small className="hint">
              {chosen?.note ?? (chosen?.cell ? `Found next to "Calling Name"${chosen.current ? ` (now ${String(chosen.current)})` : ""}` : "Type the cell where the calling name goes")}
            </small>
          </div>
          <div className="field">
            <label htmlFor="tc-copies">Copies of each</label>
            <input id="tc-copies" type="number" min={1} max={5} value={copies} disabled={running} onChange={(e) => setCopies(Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="tc-names">Workers to print</label>
        <textarea
          id="tc-names"
          className={over ? "drop-over" : undefined}
          rows={3}
          value={text}
          disabled={running}
          onChange={(e) => {
            setText(e.target.value);
            setLoaded(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f && !running) loadFile(f);
          }}
          placeholder="e.g. INB-01 to INB-20, INC-05, INC-08 (or drop an Excel file with the calling names here)"
        />
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xlsm,.csv"
          hidden
          aria-label="Excel file with calling names"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = ""; // the same file can be loaded again
          }}
        />
        {loaded && <small className="hint">Loaded {loaded}. They print in this order.</small>}
        <div className="row tc-quick">
          <button className="small" disabled={running} onClick={() => fileInput.current?.click()} title="An Excel (.xlsx) or .csv file with the calling names, one per row">
            Load from Excel file…
          </button>
          <button className="small" disabled={running} onClick={() => setText(worked.join(", "))}>
            Everyone who worked this month ({worked.length})
          </button>
          <button className="small" disabled={running} onClick={() => setText(master.workers.map((w) => w.calling_name).join(", "))}>
            Everyone in Labour Detail ({master.workers.length})
          </button>
          {text && (
            <button className="link small" disabled={running} onClick={() => { setText(""); setLoaded(null); }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {(names.length > 0 || unknown.length > 0) && (
        <div className="tc-list">
          <b>
            {names.length} time card{names.length === 1 ? "" : "s"}
          </b>
          {names.length > 0 && <span className="muted"> · {names.slice(0, 40).join(", ")}{names.length > 40 ? ` … and ${names.length - 40} more` : ""}</span>}
          {unknown.length > 0 && <div className="error-text small">Not found: {unknown.join(", ")}</div>}
        </div>
      )}

      {job && (job.running || job.done > 0 || job.error) && (
        <div className={`tc-progress${job.error ? " bad" : !job.running ? " done" : ""}`} role="status">
          <div className="tc-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <div>
            {job.running ? (
              <>
                {job.practice ? "Going through" : "Printing"} {job.done + 1} of {job.total}: <b>{job.current}</b>
              </>
            ) : job.error ? (
              <>Stopped after {job.done} of {job.total}: {job.error}</>
            ) : job.stopped ? (
              <>Stopped after {job.done} of {job.total}. Last printed: {job.printed[job.printed.length - 1] ?? "none"}.</>
            ) : (
              <>
                ✓ {job.practice ? "Practice run done" : "Printed"}: {job.done} time card{job.done === 1 ? "" : "s"}.
              </>
            )}
          </div>
        </div>
      )}

      <div className="actions">
        {running ? (
          <button className="primary" onClick={() => api.stopPrinting().then(setJob).catch(() => undefined)}>
            Stop after this card
          </button>
        ) : (
          <button className="primary big" disabled={!names.length || !cell || !sheet} onClick={print}>
            Print {names.length || ""} time card{names.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </section>
  );
}
