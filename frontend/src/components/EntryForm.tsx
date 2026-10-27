import { useEffect, useMemo, useRef, useState } from "react";
import { api, type DayView, type EntryInput, type EntryPlan, type Master, type Worker } from "../api";
import {
  emptyForm,
  formProblems,
  fromEntry,
  hasProblems,
  isOvernight,
  LINES,
  toInput,
  type FormState,
} from "../form";
import { crewToday, entriesOf, recentActivities, usualTimes, workerStats, type Month } from "../history";
import { searchWorkers } from "../search";
import { effectiveHours, fmtHours, formatClock, formatShift, parseClock, stepClock } from "../time";
import { IssueList } from "./IssueList";

interface Props {
  master: Master;
  sheet: string;
  day: DayView | undefined;
  month: Month;
  form: FormState;
  setForm: (f: FormState | ((f: FormState) => FormState)) => void;
  headerAcks: string[];
  activityOrder: string[];
  onQueue: (input: EntryInput) => void;
  onCrew: () => void;
  onMedical: () => void;
  onBuild: () => void;
  focusToken: number; // changes when the worker field should take focus
  dialogOpen: boolean; // never steal focus from a dialog
}

const STATUS_LABEL: Record<string, string> = {
  valid: "",
  missing: "no employee code",
  error: "employee code #N/A",
  zero: "employee code 0",
  invalid: "bad employee code",
};

export function EntryForm(props: Props) {
  const { master, sheet, day, month, form, setForm, headerAcks, activityOrder, onQueue, onCrew, onMedical, onBuild } = props;
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [plan, setPlan] = useState<EntryPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const reg = (key: string) => (el: HTMLInputElement | null) => {
    refs.current[key] = el;
  };
  // Synchronous, so keys typed right after Enter land in the next field (fast typists).
  const focus = (key: string) => refs.current[key]?.focus();

  useEffect(() => {
    if (!props.dialogOpen) focus("worker");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusToken, props.dialogOpen]);

  const matches = useMemo(() => searchWorkers(master.workers, form.query), [master.workers, form.query]);
  const problems = formProblems(form);
  const input = useMemo(() => toInput(form, sheet, headerAcks), [form, sheet, headerAcks]);

  // Live preview from the server (cached sheets, no Excel round trip).
  useEffect(() => {
    if (!input || hasProblems(problems)) {
      setPlan(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      api
        .preview([input])
        .then(([p]) => !stale && (setPlan(p), setError(null)))
        .catch((e) => !stale && setError(String(e.message ?? e)));
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(input)]);

  const worker = form.worker;
  const existing = worker ? day?.entries.find((v) => v.entry.calling_name === worker.calling_name) : undefined;
  const history = useMemo(() => (worker ? entriesOf(month, worker.calling_name, Number(sheet)) : []), [month, worker, sheet]);
  const stats = worker ? workerStats(month, worker.calling_name) : null;
  const usual = usualTimes(history);
  const recent = recentActivities(history);
  const yesterday = worker ? month[String(Number(sheet) - 1)]?.entries.find((v) => v.entry.calling_name === worker.calling_name) : undefined;
  const crew = worker ? crewToday(day, master.workers, worker.trade_group) : null;

  const pick = (w: Worker) => {
    setForm((f) => ({ ...f, worker: w, query: w.calling_name, overwrite: false, acknowledged: [] }));
    setOpen(false);
    focus("in");
  };

  // Queue what the form holds now (not the last preview, which may predate the last keystroke);
  // the queue re-checks it on the server.
  const queue = () => {
    if (input && !hasProblems(problems)) onQueue(input);
  };

  /** Effective hours not yet given to the other lines: the default for this line's hours. */
  const remaining = (index: number): number | null => {
    if (!input || input.time_in === null || input.time_out === null) return null;
    const effective = effectiveHours(input.time_in, input.time_out, input.additional ?? 0);
    const others = form.lines.reduce((sum, l, i) => (i === index ? sum : sum + (Number(l.hours) || 0)), 0);
    const rest = effective - others;
    return rest > 0 ? rest : null;
  };

  const setLine = (i: number, patch: Partial<{ code: string; hours: string }>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) }));

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, next: string | "queue") => {
    if (e.key === "Escape") {
      setForm(emptyForm());
      setPlan(null);
      focus("worker");
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey || next === "queue") queue();
      else focus(next);
    }
  };

  const timeKey = (e: React.KeyboardEvent<HTMLInputElement>, field: "timeIn" | "timeOut", next: string) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const delta = e.key === "ArrowUp" ? 0.25 : -0.25;
      setForm((f) => ({ ...f, [field]: stepClock(f[field], delta) }));
    } else onKey(e, next);
  };

  return (
    <section className="entry">
      <div className="entry-main">
        <div className="field worker-field">
          <label htmlFor="worker">Worker</label>
          <input
            id="worker"
            ref={reg("worker")}
            autoComplete="off"
            placeholder="Calling name, name or employee code"
            value={form.query}
            role="combobox"
            aria-expanded={open}
            aria-controls="worker-list"
            onChange={(e) => {
              setForm((f) => ({ ...f, query: e.target.value, worker: null }));
              setOpen(true);
              setHighlight(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() =>
              // Late close (lets a click on the list land), but not if focus came back meanwhile.
              setTimeout(() => document.activeElement !== refs.current.worker && setOpen(false), 150)
            }
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if ((e.key === "Enter" || e.key === "Tab") && !form.worker && form.query.trim() && matches.length) {
                // Typed but not picked yet: take the highlighted (or best) match, list shown or not.
                e.preventDefault();
                pick(matches[open ? highlight : 0] ?? matches[0]);
              } else onKey(e, "in");
            }}
          />
          {open && !form.worker && matches.length > 0 && (
            <ul className="dropdown" id="worker-list" role="listbox">
              {matches.map((w, i) => {
                const done = day?.entries.some((v) => v.entry.calling_name === w.calling_name);
                return (
                  <li
                    key={w.row}
                    role="option"
                    aria-selected={i === highlight}
                    className={i === highlight ? "active" : ""}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(w);
                    }}
                  >
                    <b>{w.calling_name}</b> <span className="muted">{String(w.name ?? "")}</span>{" "}
                    <span className="small">{String(w.trade_group ?? "")}</span>
                    {done && <span className="badge small">entered</span>}
                    {w.code_status !== "valid" && <span className="badge warn small">{STATUS_LABEL[w.code_status]}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {worker && (
          <div className="worker-card">
            <b>{worker.calling_name}</b> {String(worker.name ?? "")} · {String(worker.trade_group ?? "")} ·{" "}
            {worker.code_status === "valid" ? (
              String(worker.employee_code)
            ) : (
              <span className="warn-text">{STATUS_LABEL[worker.code_status]}</span>
            )}
            {stats && (
              <span className="muted">
                {" "}
                · this month {stats.days} days, {fmtHours(stats.hours)} h
              </span>
            )}
          </div>
        )}
        {existing && !form.overwrite && (
          <div className="notice">
            Already entered on sheet {sheet}: {formatShift(existing.entry.time_in, existing.entry.time_out)}.{" "}
            <button
              className="link"
              onClick={() => worker && setForm(fromEntry(existing.entry, worker, true))}
            >
              Edit it
            </button>
          </div>
        )}
        {form.overwrite && <div className="notice">Editing the existing entry: it will be overwritten.</div>}

        <div className="times">
          <div className="field">
            <label htmlFor="in">In</label>
            <input
              id="in"
              ref={reg("in")}
              inputMode="numeric"
              placeholder="07:00"
              value={form.timeIn}
              onChange={(e) => setForm((f) => ({ ...f, timeIn: e.target.value }))}
              onBlur={() => setForm((f) => ({ ...f, timeIn: normaliseClock(f.timeIn) }))}
              onKeyDown={(e) => timeKey(e, "timeIn", "out")}
              aria-invalid={Boolean(problems.timeIn)}
            />
            {problems.timeIn && <small className="error-text">{problems.timeIn}</small>}
          </div>
          <div className="field">
            <label htmlFor="out">Out</label>
            <input
              id="out"
              ref={reg("out")}
              inputMode="numeric"
              placeholder="19:00"
              value={form.timeOut}
              onChange={(e) => setForm((f) => ({ ...f, timeOut: e.target.value }))}
              onBlur={() => setForm((f) => ({ ...f, timeOut: normaliseClock(f.timeOut) }))}
              onKeyDown={(e) => timeKey(e, "timeOut", "code0")}
              aria-invalid={Boolean(problems.timeOut)}
            />
            {problems.timeOut && <small className="error-text">{problems.timeOut}</small>}
          </div>
          <label className="check" title="Out is on the next day (written past 24 in Excel)">
            <input
              type="checkbox"
              tabIndex={-1}
              checked={isOvernight(form)}
              onChange={(e) => setForm((f) => ({ ...f, overnight: e.target.checked }))}
            />{" "}
            Overnight
          </label>
        </div>

        <table className="lines">
          <thead>
            <tr>
              <th>Activity</th>
              <th>Hours</th>
            </tr>
          </thead>
          <tbody>
            {form.lines.slice(0, LINES).map((line, i) => (
              <tr key={i}>
                <td>
                  <input
                    ref={reg(`code${i}`)}
                    list="activity-codes"
                    aria-label={`Activity ${i + 1}`}
                    value={line.code}
                    onChange={(e) => setLine(i, { code: e.target.value })}
                    onKeyDown={(e) => onKey(e, `hours${i}`)}
                  />
                </td>
                <td>
                  <input
                    ref={reg(`hours${i}`)}
                    aria-label={`Hours ${i + 1}`}
                    inputMode="decimal"
                    value={line.hours}
                    placeholder={line.code && remaining(i) !== null ? fmtHours(remaining(i)) : ""}
                    onFocus={() => {
                      const rest = remaining(i);
                      if (!line.hours && line.code && rest !== null) setLine(i, { hours: fmtHours(rest) });
                    }}
                    onChange={(e) => setLine(i, { hours: e.target.value })}
                    onKeyDown={(e) => onKey(e, "queue")}
                    aria-invalid={Boolean(problems.lines[i])}
                  />
                  {problems.lines[i] && <small className="error-text">{problems.lines[i]}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="activity-codes">
          {activityOrder.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <div className="times">
          <div className="field">
            <label htmlFor="additional">Additional hours</label>
            <input
              id="additional"
              ref={reg("additional")}
              inputMode="decimal"
              value={form.additional}
              placeholder="0"
              onChange={(e) => setForm((f) => ({ ...f, additional: e.target.value }))}
              onKeyDown={(e) => onKey(e, "queue")}
            />
          </div>
          <div className="field grow">
            <label htmlFor="remark">Remark</label>
            <input
              id="remark"
              ref={reg("remark")}
              value={form.remark}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
              onKeyDown={(e) => onKey(e, "queue")}
            />
          </div>
        </div>

        <div className="actions">
          <button className="primary" onClick={queue} disabled={!input || hasProblems(problems)}>
            Add to queue <kbd>Enter</kbd>
          </button>
          <button
            onClick={() => {
              setForm(emptyForm());
              setPlan(null);
              focus("worker");
            }}
          >
            Clear <kbd>Esc</kbd>
          </button>
          <button onClick={onBuild}>Start day from previous days…</button>
          <button onClick={onCrew}>Crew entry…</button>
          <button onClick={onMedical}>Medical leave…</button>
        </div>
      </div>

      <aside className="entry-side">
        <Preview plan={plan} error={error} />
        {worker && (
          <div className="suggestions">
            <h3>Suggestions</h3>
            {usual && (
              <button
                onClick={() => setForm((f) => ({ ...f, timeIn: formatClock(usual.time_in), timeOut: formatClock(usual.time_out), overnight: usual.time_out >= 24 }))}
              >
                Usual {formatShift(usual.time_in, usual.time_out)} <span className="muted">({usual.count}×)</span>
              </button>
            )}
            {yesterday && (
              <button onClick={() => setForm(fromEntry(yesterday.entry, worker, form.overwrite || Boolean(existing)))}>
                Copy day {Number(sheet) - 1}: {formatShift(yesterday.entry.time_in, yesterday.entry.time_out)}
              </button>
            )}
            {crew && (crew.activity || crew.time_in !== null) && (
              <button
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    timeIn: crew.time_in !== null ? formatClock(crew.time_in) : f.timeIn,
                    timeOut: crew.time_out !== null ? formatClock(crew.time_out) : f.timeOut,
                    overnight: crew.time_out !== null ? crew.time_out >= 24 : f.overnight,
                    lines: crew.activity ? f.lines.map((l, i) => (i === 0 ? { code: crew.activity!, hours: "" } : l)) : f.lines,
                  }))
                }
              >
                Crew today: {crew.activity ?? "—"} {crew.time_in !== null && formatShift(crew.time_in, crew.time_out)}{" "}
                <span className="muted">({crew.count} {String(worker.trade_group ?? "")})</span>
              </button>
            )}
            {recent.length > 0 && (
              <div className="chips">
                <span className="muted small">Recent:</span>
                {recent.map((code) => (
                  <button
                    key={code}
                    className="chip"
                    onClick={() => {
                      const i = form.lines.findIndex((l) => !l.code.trim());
                      setLine(i === -1 ? 0 : i, { code });
                      focus(`hours${i === -1 ? 0 : i}`);
                    }}
                  >
                    {code}
                  </button>
                ))}
              </div>
            )}
            {!usual && !yesterday && !recent.length && <p className="muted small">No history this month yet.</p>}
          </div>
        )}
      </aside>
    </section>
  );
}

/** "730" -> "07:30" when valid; invalid text stays so the user sees what they typed. */
function normaliseClock(text: string): string {
  const value = parseClock(text);
  return value === null ? text.trim() : formatClock(value);
}

function Preview({ plan, error }: { plan: EntryPlan | null; error: string | null }) {
  const p = plan?.preview;
  return (
    <div className="preview" aria-live="polite">
      <h3>Excel will show</h3>
      {error && <p className="error-text">{error}</p>}
      {p ? (
        <dl>
          <dt>Total</dt>
          <dd>{fmtHours(p.total)}</dd>
          <dt>Effective</dt>
          <dd>
            <b>{fmtHours(p.effective)}</b>
          </dd>
          <dt>OT</dt>
          <dd>{p.ot_raw !== null && p.ot_raw > 0 ? fmtHours(p.ot_raw) : "—"}</dd>
          <dt>ZIDLE</dt>
          <dd>{p.zidle === null ? "hidden (text hours)" : p.zidle === 0 ? "—" : fmtHours(p.zidle)}</dd>
          <dt>Day count</dt>
          <dd>
            {fmtHours(plan?.day_count)} {plan?.bp_day === false && <span className="muted small">(BP Bill: not a day)</span>}
          </dd>
        </dl>
      ) : (
        <p className="muted small">Pick a worker and enter In and Out.</p>
      )}
      {plan && <IssueList issues={plan.issues} compact />}
    </div>
  );
}
