import { useMemo, useState } from "react";
import type { DayView, Master, Worker } from "../api";
import type { Month } from "../history";
import { searchWorkers } from "../search";
import { formatShift } from "../time";

const CREWS_KEY = "labour.crews";

export function loadCrews(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(CREWS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveCrews(crews: Record<string, string[]>) {
  try {
    localStorage.setItem(CREWS_KEY, JSON.stringify(crews));
  } catch {
    /* storage unavailable: crews last for this page only */
  }
}

interface Props {
  master: Master;
  sheet: string;
  day: DayView | undefined;
  month: Month;
  formSummary: string | null; // e.g. "07:00–19:00, 03-11-00-00" or null when the form is empty
  onSameAsForm: (workers: Worker[]) => void;
  onCopyYesterday: (workers: Worker[]) => void;
  onClose: () => void;
}

/** Pick several workers (by trade, search or saved crew) and queue them in one go. */
export function CrewDialog({ master, sheet, day, month, formSummary, onSameAsForm, onCopyYesterday, onClose }: Props) {
  const [crews, setCrews] = useState(loadCrews);
  const [trade, setTrade] = useState("");
  const [q, setQ] = useState("");
  const [onlyFree, setOnlyFree] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [crewName, setCrewName] = useState("");

  const entered = useMemo(() => new Set(day?.entries.map((v) => v.entry.calling_name)), [day]);
  const trades = useMemo(
    () => [...new Set(master.workers.map((w) => String(w.trade_group ?? "")))].filter(Boolean).sort(),
    [master.workers],
  );
  const shown = searchWorkers(master.workers, q, 1000).filter(
    (w) => (!trade || w.trade_group === trade) && (!onlyFree || !entered.has(w.calling_name)),
  );
  const yesterday = month[String(Number(sheet) - 1)];
  const chosen = master.workers.filter((w) => picked.has(w.calling_name));
  const withYesterday = chosen.filter((w) => yesterday?.entries.some((v) => v.entry.calling_name === w.calling_name));

  const toggle = (name: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Crew entry">
        <div className="section-head">
          <h2>Crew entry · sheet {sheet}</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="row">
          <select value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="Trade group">
            <option value="">All trades</option>
            {trades.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input autoFocus type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> Not entered yet
          </label>
          <select
            value=""
            aria-label="Saved crews"
            onChange={(e) => e.target.value && setPicked(new Set(crews[e.target.value]))}
          >
            <option value="">Saved crews…</option>
            {Object.keys(crews).map((name) => (
              <option key={name} value={name}>
                {name} ({crews[name].length})
              </option>
            ))}
          </select>
        </div>
        <div className="row small">
          <button className="link" onClick={() => setPicked(new Set([...picked, ...shown.map((w) => w.calling_name)]))}>
            Select all shown ({shown.length})
          </button>
          <button className="link" onClick={() => setPicked(new Set())}>
            Select none
          </button>
          <span className="muted">{picked.size} selected</span>
        </div>
        <ul className="crew-list">
          {shown.map((w) => {
            const prev = yesterday?.entries.find((v) => v.entry.calling_name === w.calling_name)?.entry;
            return (
              <li key={w.row}>
                <label>
                  <input type="checkbox" checked={picked.has(w.calling_name)} onChange={() => toggle(w.calling_name)} />{" "}
                  <b>{w.calling_name}</b> <span className="muted">{String(w.trade_group ?? "")}</span>
                  {entered.has(w.calling_name) && <span className="badge small">entered</span>}
                  {prev && <span className="muted small"> · day {Number(sheet) - 1}: {formatShift(prev.time_in, prev.time_out)}</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <div className="row">
          <input placeholder="Crew name" value={crewName} onChange={(e) => setCrewName(e.target.value)} aria-label="Crew name" />
          <button
            disabled={!crewName.trim() || !picked.size}
            onClick={() => {
              const next = { ...crews, [crewName.trim()]: [...picked] };
              setCrews(next);
              saveCrews(next);
            }}
          >
            Save crew
          </button>
          {crewName.trim() && crews[crewName.trim()] && (
            <button
              className="link"
              onClick={() => {
                const next = { ...crews };
                delete next[crewName.trim()];
                setCrews(next);
                saveCrews(next);
              }}
            >
              Delete crew
            </button>
          )}
        </div>
        <div className="actions">
          <button className="primary" disabled={!chosen.length || !formSummary} onClick={() => onSameAsForm(chosen)}>
            Queue {chosen.length} with {formSummary ?? "the form's times (fill the form first)"}
          </button>
          <button disabled={!withYesterday.length} onClick={() => onCopyYesterday(withYesterday)}>
            Copy day {Number(sheet) - 1} for {withYesterday.length}
          </button>
        </div>
      </div>
    </div>
  );
}
