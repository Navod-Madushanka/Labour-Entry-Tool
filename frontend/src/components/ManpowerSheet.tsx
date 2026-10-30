import { useMemo, useRef, useState } from "react";
import type { DayView, EntryInput } from "../api";
import { formulaValue } from "../calc";
import type { Month } from "../history";
import { effectiveHours, fmtHours, formatClock, parseClock } from "../time";
import type { QueueItem } from "./Queue";
import { placeName } from "../codes";

const PER_PAGE = 10; // worker columns on one printed manpower sheet

interface Column {
  id?: number; // queue item (absent for workers already in Excel: those are shown, not changed)
  input?: EntryInput;
  name: string;
  tin: number | null;
  tout: number | null;
  normal: number | null;
  ot: number | null;
  acts: { code: string; hours: number | null }[];
  source: "queue" | "excel";
  problem: boolean; // something still blocks or needs confirming
}

interface Props {
  items: QueueItem[];
  month: Month;
  places: Record<string, string>; // place names for the Description column
  activities: boolean; // false: the workbook is kept without activity codes (no code rows)
  ready: boolean; // the queue can be written
  busy: boolean;
  onWrite: () => void;
  onEdit: (id: number) => void; // back into the entry form
  onRemove: (id: number) => void;
  onChange: (id: number, input: EntryInput) => void; // a time or hours changed on the sheet
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** Normal and OT from the effective hours and Excel's OT (effective - threshold of the day type). */
function split(effective: number | null, otRaw: number | null): [number | null, number | null] {
  if (effective === null) return [null, null];
  if (otRaw === null) return [effective, null];
  const ot = Math.max(otRaw, 0);
  return [effective - ot, ot];
}

function fromQueue(it: QueueItem): Column {
  const p = it.plan?.preview ?? null;
  const [normal, ot] = split(p?.effective ?? null, p?.ot_raw ?? null);
  return {
    id: it.id,
    input: it.input,
    name: it.input.calling_name,
    tin: it.input.time_in,
    tout: it.input.time_out,
    normal,
    ot,
    acts: it.input.activities.filter((a) => a.code).map((a) => ({ code: a.code!.trim(), hours: a.hours })),
    source: "queue",
    problem: !!it.plan && (it.plan.blocking.length > 0 || it.plan.unconfirmed.length > 0), // no plan = being checked
  };
}

function fromExcel(v: DayView["entries"][number]): Column {
  const [normal, ot] = split(v.computed?.effective ?? null, v.computed?.ot_raw ?? null);
  return {
    name: v.entry.calling_name ?? "",
    tin: num(v.entry.time_in),
    tout: num(v.entry.time_out),
    normal,
    ot,
    acts: v.entry.activities
      .filter((a) => typeof a.code === "string" && a.code.trim())
      .map((a) => ({ code: String(a.code).trim(), hours: num(a.hours) })),
    source: "excel",
    problem: false,
  };
}

const time = (h: number | null) => (h === null ? "" : `${formatClock(h)}${h >= 24 ? " (+1)" : ""}`);
const dateText = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
const longDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";
const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** The queue, live, laid out like the site's "Daily record of manpower" form: workers across (10 per
 * sheet), activity codes down, a tick where a worker did that activity. To compare with the
 * paper before anything is written. */
/** New times; activity hours that added up to the old worked hours are scaled to the new ones
 * (quarter hours, the last line takes the rest), as the entry form does. */
function withTimes(input: EntryInput, tin: number | null, tout: number | null): EntryInput {
  let activities = input.activities;
  const coded = activities.filter((a) => a.code && a.hours !== null);
  if (input.time_in !== null && input.time_out !== null && tin !== null && tout !== null && coded.length) {
    const before = effectiveHours(input.time_in, input.time_out, input.additional ?? 0);
    const after = effectiveHours(tin, tout, input.additional ?? 0);
    const total = coded.reduce((sum, a) => sum + (a.hours ?? 0), 0);
    if (before > 0 && after > 0 && Math.abs(total - before) < 1e-9) {
      let left = after;
      const last = activities.lastIndexOf(coded[coded.length - 1]);
      activities = activities.map((a, i) => {
        if (!a.code || a.hours === null) return a;
        const hours = i === last ? left : Math.round(((a.hours * after) / before) * 4) / 4;
        left -= hours;
        return { ...a, hours };
      });
    }
  }
  return { ...input, time_in: tin, time_out: tout, activities };
}

function parseOut(text: string, tin: number | null): number | null {
  const v = parseClock(text);
  if (v === null) return null;
  return tin !== null && v <= tin ? v + 24 : v; // earlier than In: the next morning
}

function parseHours(text: string): number | null {
  const v = text.trim().startsWith("=") ? formulaValue(text) : Number(text);
  return v !== null && Number.isFinite(v) && v > 0 && v <= 24 ? v : null;
}

/** A sheet cell that can be changed in place: click, type, Enter (Esc cancels). */
function EditCell({ shown, start, parse, onSave, label }: {
  shown: React.ReactNode;
  start: string;
  parse: (text: string) => number | null;
  onSave: (v: number) => void;
  label: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false); // Esc: closing the box also blurs it, which must not save
  if (text === null)
    return (
      <button className="mp-edit" title={`Change ${label}`} aria-label={`Change ${label}`} onClick={() => {
          cancelled.current = false;
          setText(start);
        }}>
        {shown}
      </button>
    );
  const bad = text.trim() !== "" && parse(text) === null;
  const save = () => {
    if (cancelled.current) return;
    const v = parse(text);
    if (v !== null) onSave(v);
    setText(null);
  };
  return (
    <input
      className={`mp-input${bad ? " bad" : ""}`}
      aria-label={label}
      autoFocus
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        else if (e.key === "Escape") {
          cancelled.current = true;
          setText(null);
        }
      }}
    />
  );
}

export function ManpowerSheet({ items, month, places, activities, ready, busy, onWrite, onEdit, onRemove, onChange }: Props) {
  const [withExcel, setWithExcel] = useState(false);
  // Re-rendered with every queue change, so this is the time of the latest entry.
  const entered = new Date().toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const sheets = useMemo(() => {
    const names = [...new Set(items.map((i) => i.input.sheet))].sort((a, b) => Number(a) - Number(b));
    return names.map((sheet) => {
      const queued = items.filter((i) => i.input.sheet === sheet);
      const inQueue = new Set(queued.map((q) => q.input.calling_name));
      const excel = withExcel
        ? (month[sheet]?.entries ?? []).filter((v) => v.entry.calling_name && !inQueue.has(v.entry.calling_name)).map(fromExcel)
        : [];
      const columns = [...excel, ...queued.filter((q) => q.input.activities.length || q.input.time_in !== null).map(fromQueue)];
      const pages: Column[][] = [];
      for (let i = 0; i < columns.length; i += PER_PAGE) pages.push(columns.slice(i, i + PER_PAGE));
      return { sheet, day: month[sheet], pages };
    });
  }, [items, month, withExcel]);

  const total = sheets.reduce((n, s) => n + s.pages.length, 0);
  let pageNo = 0;

  return (
    <section className="manpower-live">
        <div className="section-head">
          <h2>
            Manpower sheet <span className="muted">({items.length} waiting to go to Excel)</span>
          </h2>
        </div>
        <p className="muted small">
          Every entry you add appears here, laid out like the paper form. Compare it with the paper, then push it to
          Excel at the bottom. Click a time or hours to change it; ✎ moves a worker back into the form, ✕ removes them.
        </p>
        <label className="check wrap">
          <input type="checkbox" checked={withExcel} onChange={(e) => setWithExcel(e.target.checked)} /> Also show
          workers already in Excel for these days (grey)
        </label>
        <div className="manpower-pages">
          {sheets.map(({ sheet, day, pages }) =>
            pages.map((cols, n) => {
              pageNo += 1;
              const codes = activities ? [...new Set(cols.flatMap((c) => c.acts.map((a) => a.code)))] : [];
              const blanks = activities ? Math.max(0, 4 - codes.length) : 0; // a few empty rows, like the form
              const padded = [...cols, ...Array.from({ length: PER_PAGE - cols.length }, () => null)];
              return (
                <section key={`${sheet}-${n}`} className="manpower">
                  <div className="mp-banner">
                    <span className="mp-date">{longDate(day?.header.date) || `Sheet ${sheet}`}</span>
                    <span className="mp-entered">Entered {entered}</span>
                  </div>
                  <table className="mp-head">
                    <tbody>
                      <tr>
                        <th colSpan={2} className="mp-title">
                          DAILY RECORD OF MANPOWER
                        </th>
                        <td className="mp-label">Date</td>
                        <td>{dateText(day?.header.date)}</td>
                      </tr>
                      <tr>
                        <td className="mp-label">Prepared by</td>
                        <td>{cell(day?.header.prepared_by)}</td>
                        <td className="mp-label">Sheet No</td>
                        <td>
                          {sheet}
                          {pages.length > 1 && <span className="muted"> · page {n + 1} of {pages.length}</span>}
                        </td>
                      </tr>
                      <tr>
                        <td className="mp-label">Project / Activity Centre</td>
                        <td>{cell(day?.header.project)}</td>
                        <td className="mp-label">Day</td>
                        <td>{cell(day?.header.day_type)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="table-wrap">
                    <table className="mp-grid">
                      <thead>
                        <Row
                          label="Emp.No"
                          cols={padded}
                          codes={codes}
                          rowSpanLeft={activities}
                          render={(c) => (
                            <>
                              <b>{c.name}</b>
                              {c.id !== undefined && !busy && (
                                <span className="mp-actions">
                                  <button className="link" title={`Edit ${c.name} in the form`} aria-label={`Edit ${c.name}`} onClick={() => onEdit(c.id!)}>
                                    ✎
                                  </button>
                                  <button className="link danger" title={`Remove ${c.name}`} aria-label={`Remove ${c.name}`} onClick={() => onRemove(c.id!)}>
                                    ✕
                                  </button>
                                </span>
                              )}
                            </>
                          )}
                        />
                        <Row
                          label="In:"
                          cols={padded}
                          render={(c) =>
                            c.id !== undefined && c.input && !busy ? (
                              <EditCell
                                label={`${c.name} Time In`}
                                shown={time(c.tin) || "—"}
                                start={c.tin === null ? "" : formatClock(c.tin)}
                                parse={parseClock}
                                onSave={(v) => {
                                  const out = c.tout !== null && c.tout <= v ? c.tout + 24 : c.tout;
                                  onChange(c.id!, withTimes(c.input!, v, out));
                                }}
                              />
                            ) : (
                              time(c.tin)
                            )
                          }
                        />
                        <Row
                          label="Out:"
                          cols={padded}
                          render={(c) =>
                            c.id !== undefined && c.input && !busy ? (
                              <EditCell
                                label={`${c.name} Time Out`}
                                shown={time(c.tout) || "—"}
                                start={c.tout === null ? "" : formatClock(c.tout)}
                                parse={(t) => parseOut(t, c.tin)}
                                onSave={(v) => onChange(c.id!, withTimes(c.input!, c.tin, v))}
                              />
                            ) : (
                              time(c.tout)
                            )
                          }
                        />
                        <Row label="Normal Hrs" cols={padded} render={(c) => fmtHours(c.normal ?? undefined)} />
                        <Row label="OT" cols={padded} render={(c) => (c.ot ? fmtHours(c.ot) : c.ot === 0 ? "" : "?")} />
                      </thead>
                      <tbody>
                        {codes.map((code) => (
                          <tr key={code}>
                            <td className="mp-code">{code}</td>
                            <td className="mp-desc">{placeName(code, places)}</td>
                            <td className="mp-label-col" />
                            {padded.map((c, i) => {
                              const act = c?.acts.find((a) => a.code === code);
                              return (
                                <td key={i} className={`mp-tick${c?.source === "excel" ? " excel" : ""}`}>
                                  {act && (
                                    <>
                                      <span className="tick">✓</span>{" "}
                                      {c?.id !== undefined && c.input && !busy ? (
                                        <EditCell
                                          label={`${c.name} hours on ${code}`}
                                          shown={<span className="mp-hours">({fmtHours(act.hours ?? undefined)})</span>}
                                          start={act.hours === null ? "" : String(act.hours)}
                                          parse={parseHours}
                                          onSave={(v) =>
                                            onChange(c.id!, {
                                              ...c.input!,
                                              activities: c.input!.activities.map((a) => (a.code?.trim() === code ? { ...a, hours: v } : a)),
                                            })
                                          }
                                        />
                                      ) : (
                                        <span className="mp-hours">({fmtHours(act.hours ?? undefined)})</span>
                                      )}
                                    </>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {Array.from({ length: blanks }, (_, i) => (
                          <tr key={`blank-${i}`}>
                            <td className="mp-code" />
                            <td className="mp-desc" />
                            <td className="mp-label-col" />
                            {padded.map((_, j) => (
                              <td key={j} className="mp-tick" />
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted small mp-foot">
                    Sheet {pageNo} of {total}
                    {cols.some((c) => c.problem) && (
                      <span className="warn-text"> · columns marked ! still have a problem in the queue</span>
                    )}
                  </p>
                </section>
              );
            }),
          )}
          {total === 0 && <p className="muted">Add an entry above and it appears here.</p>}
        </div>
        {items.length > 0 && (
          <div className="actions push-bar">
            <button className="primary big" disabled={!ready || busy} onClick={onWrite}>
              {busy ? "Writing…" : `Push ${items.length} ${items.length === 1 ? "entry" : "entries"} to Excel`}
            </button>
            {!ready && !busy && (
              <span className={items.some((i) => !i.plan) ? "muted small" : "warn-text small"}>
                {items.some((i) => !i.plan) ? "Checking…" : "Fix or confirm the problems in the queue below first."}
              </span>
            )}
          </div>
        )}
    </section>
  );
}

function Row({
  label,
  cols,
  codes,
  render,
  rowSpanLeft,
}: {
  label: string;
  cols: (Column | null)[];
  codes?: string[];
  render: (c: Column) => React.ReactNode;
  rowSpanLeft?: boolean;
}) {
  return (
    <tr>
      {rowSpanLeft && (
        <>
          <th rowSpan={5} className="mp-code">
            Activity Code
          </th>
          <th rowSpan={5} className="mp-desc">
            Description
          </th>
        </>
      )}
      <th className="mp-label-col">{label}</th>
      {cols.map((c, i) => (
        <td
          key={i}
          className={`mp-cell${c?.source === "excel" ? " excel" : ""}${c?.problem ? " problem" : ""}`}
          title={codes && c?.problem ? "This entry still has a problem in the queue" : undefined}
        >
          {c && render(c)}
          {codes && c?.problem && <span className="warn-text"> !</span>}
        </td>
      ))}
    </tr>
  );
}
