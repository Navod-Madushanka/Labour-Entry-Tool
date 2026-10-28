import { useMemo, useState } from "react";
import type { DayView } from "../api";
import type { Month } from "../history";
import { fmtHours, formatClock } from "../time";
import type { QueueItem } from "./Queue";

const PER_PAGE = 10; // worker columns on one printed manpower sheet

interface Column {
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
  ready: boolean; // the queue can be written
  busy: boolean;
  onWrite: () => void;
  onClose: () => void;
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
    name: it.input.calling_name,
    tin: it.input.time_in,
    tout: it.input.time_out,
    normal,
    ot,
    acts: it.input.activities.filter((a) => a.code).map((a) => ({ code: a.code!.trim(), hours: a.hours })),
    source: "queue",
    problem: !it.plan || it.plan.blocking.length > 0 || it.plan.unconfirmed.length > 0,
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

/** The queue laid out like the site's "Daily record of manpower" form: workers across (10 per
 * sheet), activity codes down, a tick where a worker did that activity. To compare with the
 * paper before anything is written. */
export function ManpowerSheet({ items, month, ready, busy, onWrite, onClose }: Props) {
  const [withExcel, setWithExcel] = useState(false);
  const [entered] = useState(() =>
    new Date().toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  );

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
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal manpower-modal" role="dialog" aria-label="Manpower sheet check">
        <div className="section-head">
          <h2>Check against the manpower sheet</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted small">
          This is what will be written, laid out like the paper form. Compare each column with the paper sheet.
          Nothing is in Excel yet.
        </p>
        <label className="check">
          <input type="checkbox" checked={withExcel} onChange={(e) => setWithExcel(e.target.checked)} /> Also show
          workers already in Excel for these days (grey)
        </label>
        <div className="manpower-pages">
          {sheets.map(({ sheet, day, pages }) =>
            pages.map((cols, n) => {
              pageNo += 1;
              const codes = [...new Set(cols.flatMap((c) => c.acts.map((a) => a.code)))];
              const blanks = Math.max(0, 4 - codes.length); // a few empty rows, like the form
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
                        <Row label="Emp.No" cols={padded} codes={codes} render={(c) => <b>{c.name}</b>} rowSpanLeft />
                        <Row label="In:" cols={padded} render={(c) => time(c.tin)} />
                        <Row label="Out:" cols={padded} render={(c) => time(c.tout)} />
                        <Row label="Normal Hrs" cols={padded} render={(c) => fmtHours(c.normal ?? undefined)} />
                        <Row label="OT" cols={padded} render={(c) => (c.ot ? fmtHours(c.ot) : c.ot === 0 ? "" : "?")} />
                      </thead>
                      <tbody>
                        {codes.map((code) => (
                          <tr key={code}>
                            <td className="mp-code">{code}</td>
                            <td className="mp-desc" />
                            <td className="mp-label-col" />
                            {padded.map((c, i) => {
                              const act = c?.acts.find((a) => a.code === code);
                              return (
                                <td key={i} className={`mp-tick${c?.source === "excel" ? " excel" : ""}`}>
                                  {act && (
                                    <>
                                      <span className="tick">✓</span>
                                      <span className="mp-hours"> ({fmtHours(act.hours ?? undefined)})</span>
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
          {total === 0 && <p className="muted">Nothing to show yet.</p>}
        </div>
        <div className="actions">
          <button className="primary" disabled={!ready || busy} onClick={onWrite}>
            It matches: write {items.length} entr{items.length === 1 ? "y" : "ies"} to Excel
          </button>
          <button onClick={onClose}>Back to the queue</button>
          {!ready && <span className="warn-text small">Fix or confirm the problems in the queue first.</span>}
        </div>
      </div>
    </div>
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
