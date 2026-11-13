// "How this works": a card's explanation, folded away after the first read (remembered per card
// on this PC), so the controls come first.
import { useState, type ReactNode } from "react";
import { store } from "../store";

export function CardHelp({ id, children }: { id: string; children: ReactNode }) {
  const key = `labour.help.${id}`;
  const [open, setOpen] = useState(() => store.get(key) !== "0"); // open until folded once
  return (
    <details
      className="card-help"
      open={open}
      onToggle={(e) => {
        const now = (e.target as HTMLDetailsElement).open;
        setOpen(now);
        store.set(key, now ? "1" : "0");
      }}
    >
      <summary>How this works</summary>
      <div className="muted small">{children}</div>
    </details>
  );
}
