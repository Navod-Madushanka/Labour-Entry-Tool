import { useState } from "react";

/** Asked once per browser; every write and undo is logged under this name (PLAN.md §8). */
export function NamePrompt({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onDone(name.trim());
        }}
      >
        <h2>Who is entering?</h2>
        <p className="muted">Your name goes into the audit log with every change you write.</p>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        <div className="actions">
          <button className="primary" disabled={!name.trim()}>
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
