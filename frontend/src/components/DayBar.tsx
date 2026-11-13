import type { DayView, Issue } from "../api";

interface Props {
  sheets: string[];
  sheet: string;
  counts: Record<string, number | undefined>;
  types: Record<string, unknown>; // day type (H3) per sheet, for the weekend colours
  disrupted?: Record<string, string>; // sheet -> what disrupted the day ("Rain or weather"), given at push
  day: DayView | undefined;
  acknowledged: boolean;
  onPick: (sheet: string) => void;
  onAcknowledge: () => void;
  onFix: (issues: Issue[]) => void;
  onReload: () => void;
  reloading: string | null; // progress while "Reload from Excel" runs
}

const longDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";

const kind = (type: unknown) => {
  const t = String(type ?? "").toLowerCase();
  return t.startsWith("sat") ? " sat" : t.startsWith("sun") || t.startsWith("holi") ? " sun" : "";
};

const FIELD = { H01: "date", H02: "day type", H03: "sheet number" } as Record<string, string>;

export function DayBar({ sheets, sheet, counts, types, disrupted = {}, day, acknowledged, onPick, onAcknowledge, onFix, onReload, reloading }: Props) {
  const h = day?.header;
  const issues = day?.header_issues ?? [];
  const blocking = issues.some((i) => i.severity === "BLOCK");
  return (
    <section className="daybar">
      <div className="days" role="tablist" aria-label="Day sheet">
        {sheets.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={s === sheet}
            className={`day${s === sheet ? " active" : ""}${counts[s] ? " has" : ""}${kind(types[s])}${disrupted[s] ? " disrupted" : ""}`}
            onClick={() => onPick(s)}
            title={`${counts[s] !== undefined ? `${counts[s]} entries` : "not loaded yet"}${disrupted[s] ? ` · disrupted: ${disrupted[s]}` : ""}`}
          >
            {s}
            {disrupted[s] && <span className="day-flag" aria-label={`disrupted: ${disrupted[s]}`}>{/rain/i.test(disrupted[s]) ? "☂" : "!"}</span>}
          </button>
        ))}
      </div>
      <div className="day-legend" aria-hidden>
        <span><b className="lg-sat">S</b>Saturday</span>
        <span><b className="lg-sun">S</b>Sunday / holiday</span>
        <span><i className="lg-has" />has entries</span>
        <span><i className="lg-active" />this day</span>
        {Object.keys(disrupted).length > 0 && <span><b className="lg-flag">☂</b>disrupted (rain, power cut…)</span>}
      </div>
      <div className="dayinfo">
        {h ? (
          <>
            <strong className="day-date">{longDate(h.date) || `Sheet ${sheet} (no date)`}</strong>
            {/* the day type only when it says more than the date (a holiday, a Normal Day on a Saturday, none) */}
            {!(h.date && String(h.day_type ?? "").trim().toLowerCase() === new Date(`${h.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase()) && (
              <span className="badge">{String(h.day_type ?? "no day type")}</span>
            )}
            <span className="muted">
              Sheet {sheet} · {day?.entries.length ?? 0} entered
            </span>
          </>
        ) : (
          <strong className="day-date">Sheet {sheet}</strong>
        )}
        <button
          className="link small"
          onClick={onReload}
          disabled={Boolean(reloading)}
          aria-busy={Boolean(reloading)}
          title="Read this sheet, Labour Detail and the other days again (after editing Excel directly)"
        >
          {reloading ? <><span className="spinner" aria-hidden /> {reloading}</> : "⟳ Reload from Excel"}
        </button>
      </div>
      {issues.length > 0 && (
        <div className={`banner ${blocking ? "BLOCK" : "WARN"}`} role="alert">
          <div>
            <strong>The top of this day sheet looks wrong</strong>
            <ul>
              {issues.map((i) => (
                <li key={i.rule}>
                  <b>{i.plain.title}.</b> {i.plain.what}
                </li>
              ))}
            </ul>
            {blocking && !acknowledged && (
              <p>Fix it before writing to this day, or confirm that it is right.</p>
            )}
            {acknowledged && <p>You confirmed it is right; entries can be written.</p>}
          </div>
          <div className="actions">
            <button className="primary" onClick={() => onFix(issues)}>
              Fix {issues.map((i) => FIELD[i.rule]).filter(Boolean).join(", ")}…
            </button>
            {blocking && !acknowledged && <button onClick={onAcknowledge}>It's right, write anyway</button>}
          </div>
        </div>
      )}
    </section>
  );
}
