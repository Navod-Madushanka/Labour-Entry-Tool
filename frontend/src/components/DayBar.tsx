import type { DayView, Issue } from "../api";

interface Props {
  sheets: string[];
  sheet: string;
  counts: Record<string, number | undefined>;
  day: DayView | undefined;
  acknowledged: boolean;
  onPick: (sheet: string) => void;
  onAcknowledge: () => void;
  onFix: (issues: Issue[]) => void;
  onReload: () => void;
}

const longDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";

const FIELD = { H01: "date", H02: "day type", H03: "sheet number" } as Record<string, string>;

export function DayBar({ sheets, sheet, counts, day, acknowledged, onPick, onAcknowledge, onFix, onReload }: Props) {
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
            className={`day${s === sheet ? " active" : ""}${counts[s] ? " has" : ""}`}
            onClick={() => onPick(s)}
            title={counts[s] !== undefined ? `${counts[s]} entries` : "not loaded yet"}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="dayinfo">
        {h ? (
          <>
            <strong className="day-date">{longDate(h.date) || `Sheet ${sheet} (no date)`}</strong>
            <span className="badge">{String(h.day_type ?? "no day type")}</span>
            <span className="muted">
              Sheet {sheet} · {day?.entries.length ?? 0} worker{day?.entries.length === 1 ? "" : "s"} entered
            </span>
          </>
        ) : (
          <strong className="day-date">Sheet {sheet}</strong>
        )}
        <button className="link small" onClick={onReload} title="Read this sheet and Labour Detail again (after editing Excel directly)">
          Reload from Excel
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
