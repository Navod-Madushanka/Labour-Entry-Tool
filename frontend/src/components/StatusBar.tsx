import { useEffect, useRef, useState } from "react";
import type { BookInfo, Status } from "../api";

interface Props {
  page: "entry" | "codes" | "cards";
  status: Status | null;
  user: string;
  historyLoaded: number;
  historyTotal: number;
  onSave: () => void;
  onChangeUser: () => void;
  onChangeWorkbook: () => void;
  books: BookInfo[];
  onSwitch: (name: string) => void;
  onAddWorkbook: () => void;
  onCloseBook: (name: string) => void;
  story: { on: boolean; unlocked: number; total: number; onOpen: () => void };
}

export function StatusBar(props: Props) {
  const { page, status, user, historyLoaded, historyTotal, onSave, onChangeUser, onChangeWorkbook, story } = props;
  const { books, onSwitch, onAddWorkbook, onCloseBook } = props;
  const active = books.find((b) => b.active)?.name ?? status?.workbook ?? "";
  const backup = status?.backup ? `Backup: ${status.backup}` : "No backup yet";
  return (
    <header className="statusbar">
      <strong className="brand" title="Pattern-Based Labour Entry Assistant">Labour Entry Assistant</strong>
      <nav className="tabs">
        <a href="#" className={page === "entry" ? "active" : ""}>
          Entry
        </a>
        <a href="#codes" className={page === "codes" ? "active" : ""}>
          Codes &amp; registration
        </a>
        <a href="#cards" className={page === "cards" ? "active" : ""}>
          Time cards
        </a>
      </nav>
      {status?.mode === "demo" && (
        <span className="badge demo" title="Changes stay in memory; Excel is not used">
          DEMO
        </span>
      )}
      {books.length > 0 ? (
        <WorkbookMenu books={books} active={active} title={backup} onSwitch={onSwitch} onAdd={onAddWorkbook} onClose={onCloseBook} />
      ) : (
        status?.workbook && <span className="workbook" title={backup}>{status.workbook}</span>
      )}
      {!status ? (
        <span className="muted">Connecting…</span>
      ) : (
        !status.connected && <span className="badge error">Not connected: {status.error}</span>
      )}
      {historyLoaded < historyTotal && (
        <span className="muted small">
          Loading month {historyLoaded}/{historyTotal}
        </span>
      )}
      <span className="spacer" />
      {status?.unsaved_changes && <span className="badge warn">Not saved in Excel yet</span>}
      <button onClick={onSave} disabled={!status?.connected || !status.unsaved_changes}>
        Save Excel file
      </button>
      <button
        className={`link${story.on ? "" : " muted"}`}
        onClick={story.onOpen}
        title={story.on ? "Today's story" : "The story is off: click to turn it back on"}
      >
        📖 {!story.on ? "off" : story.unlocked ? `${story.unlocked}/${story.total}` : "?"}
      </button>
      <button className="link" onClick={onChangeWorkbook} title="Check this workbook again, or change its settings">
        Check workbook
      </button>
      <button className="link" onClick={onChangeUser} title="Change name">
        {user || "Set name"}
      </button>
    </header>
  );
}

/** The active workbook's name; opens the list of workbooks open in this tool: click one to work on
 * it, ✕ to take it off the list (the file and Excel are not touched), or open another. */
function WorkbookMenu({ books, active, title, onSwitch, onAdd, onClose }: {
  books: BookInfo[];
  active: string;
  title: string;
  onSwitch: (name: string) => void;
  onAdd: () => void;
  onClose: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (go: () => void) => {
    setOpen(false);
    go();
  };
  return (
    <div className="book-menu" ref={box}>
      <button className="book-current" aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen((o) => !o)}>
        <span className="name">{active}</span>
        {books.length > 1 && <span className="count">{books.length} open</span>} ▾
      </button>
      {open && (
        <div className="book-list" role="menu">
          <div className="muted small head">Workbooks open in this tool</div>
          {books.map((b) => (
            <div key={b.name} className={`book-row${b.active ? " active" : ""}`}>
              <button
                role="menuitem"
                className="book-name"
                disabled={b.active}
                title={b.active ? "Working on this one" : `Work on ${b.name}`}
                onClick={() => pick(() => onSwitch(b.name))}
              >
                {b.active ? "✓ " : ""}
                {b.name}
                <span className="muted small">
                  {" "}
                  {b.mode === "live" ? "Excel" : "practice copy"}
                  {!b.check_activities && " · no activity codes"}
                </span>
              </button>
              <button
                className="link danger"
                aria-label={`Close ${b.name}`}
                title="Take it off this list (the file and Excel are not changed)"
                onClick={() => {
                  const what = b.active ? `${b.name} is the workbook you are working on. ` : "";
                  if (window.confirm(`${what}Close ${b.name}?\n\nIt only leaves this list: the file and Excel are not changed, and you can open it again later.`))
                    pick(() => onClose(b.name));
                }}
              >
                ✕ Close
              </button>
            </div>
          ))}
          <button role="menuitem" className="link book-add" onClick={() => pick(onAdd)}>
            + Open another workbook
          </button>
        </div>
      )}
    </div>
  );
}

