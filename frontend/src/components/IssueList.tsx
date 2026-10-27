import type { Issue } from "../api";

interface Props {
  issues: Issue[];
  acknowledged?: string[];
  onToggle?: (rule: string) => void; // WARN confirm checkboxes
  compact?: boolean;
}

/** Issues with their severity; warnings get a confirm checkbox when onToggle is given. */
export function IssueList({ issues, acknowledged = [], onToggle, compact }: Props) {
  if (!issues.length) return null;
  return (
    <ul className={`issues${compact ? " compact" : ""}`}>
      {issues.map((i, n) => {
        const confirmable = onToggle && (i.severity === "WARN" || i.rule === "H01" || i.rule === "H02");
        return (
          <li key={`${i.rule}-${n}`} className={`issue ${i.severity}`}>
            {confirmable ? (
              <label>
                <input
                  type="checkbox"
                  checked={acknowledged.includes(i.rule)}
                  onChange={() => onToggle(i.rule)}
                />{" "}
                <b>{i.rule}</b> {i.message}
              </label>
            ) : (
              <>
                <b>{i.rule}</b> {i.message}
              </>
            )}
            {i.suggestion && !compact && <span className="fix"> → {i.suggestion}</span>}
          </li>
        );
      })}
    </ul>
  );
}
