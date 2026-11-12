// A gentle "nothing here yet" card: what a view needs before it can show anything.
import type { ReactNode } from "react";

export function EmptyState({
  title,
  children,
  steps,
}: {
  title: string;
  children?: ReactNode;
  steps?: ReactNode[];
}) {
  return (
    <div className="card view-empty">
      <b>{title}</b>
      {children && <p className="muted small">{children}</p>}
      {steps && (
        <ol className="small">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
