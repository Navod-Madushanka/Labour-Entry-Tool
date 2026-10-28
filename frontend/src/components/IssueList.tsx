import type { Issue } from "../api";

interface Props {
  issues: Issue[];
  acknowledged?: string[];
  onToggle?: (rule: string) => void; // "It's correct" for warnings
  compact?: boolean;
}

const ICON: Record<string, string> = { BLOCK: "✕", WARN: "!", INFO: "i" };

/** Problems in plain words. A warning can be confirmed ("It's correct") when onToggle is given;
 * an error has to be fixed. */
export function IssueList({ issues, acknowledged = [], onToggle, compact }: Props) {
  if (!issues.length) return null;
  return (
    <ul className={`issues${compact ? " compact" : ""}`}>
      {issues.map((i, n) => {
        const confirmable = onToggle && (i.severity === "WARN" || i.rule === "H01" || i.rule === "H02");
        const done = acknowledged.includes(i.rule);
        return (
          <li key={`${i.rule}-${n}`} className={`issue ${i.severity}${done ? " confirmed" : ""}`}>
            <span className="issue-icon" aria-hidden>
              {ICON[i.severity]}
            </span>
            <div className="issue-body">
              <b>{i.plain.title}</b>
              {!compact && <span> {i.plain.what}</span>}
              {!compact && <div className="fix">{i.plain.fix}</div>}
              {compact && <span className="muted"> {i.plain.what}</span>}
              {confirmable && (
                <label className="confirm">
                  <input type="checkbox" checked={done} onChange={() => onToggle(i.rule)} /> It's correct
                </label>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
