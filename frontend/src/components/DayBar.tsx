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
}

const FIELD = { H01: "date", H02: "day type", H03: "sheet number" } as Record<string, string>;

export function DayBar({ sheets, sheet, counts, day, acknowledged, onPick, onAcknowledge, onFix }: Props) {
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
        <strong>Sheet {sheet}</strong>
        {h && (
          <>
            <span>{h.date ?? "no date"}</span>
            <span className="badge">{String(h.day_type ?? "no day type")}</span>
            <span className="muted">{day?.entries.length ?? 0} entries</span>
          </>
        )}
      </div>
      {issues.length > 0 && (
        <div className={`banner ${blocking ? "BLOCK" : "WARN"}`} role="alert">
          <div>
            <strong>This sheet's header looks wrong.</strong>
            <ul>
              {issues.map((i) => (
                <li key={i.rule}>
                  {i.rule}: {i.message} {i.suggestion && <em>({i.suggestion})</em>}
                </li>
              ))}
            </ul>
            {blocking && !acknowledged && (
              <p>Writing to this sheet is blocked until you fix the header or confirm it is right.</p>
            )}
            {acknowledged && <p>You confirmed the header for this session; entries can be written.</p>}
          </div>
          <div className="actions">
            <button className="primary" onClick={() => onFix(issues)}>
              Fix {issues.map((i) => FIELD[i.rule]).filter(Boolean).join(", ")}…
            </button>
            {blocking && !acknowledged && <button onClick={onAcknowledge}>Header is right, write anyway</button>}
          </div>
        </div>
      )}
    </section>
  );
}
