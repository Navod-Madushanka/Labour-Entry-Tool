import { useEffect, useRef, useState } from "react";
import type { BookInfo, Status } from "../api";

interface Props {
  page: "entry" | "codes" | "cards" | "analysis" | "supervisors";
  status: Status | null;
  user: string;
  historyLoaded: number;
  historyTotal: number;
  onSave: () => void;
  onRecover: () => void; // Recover pushed entries from the change log
  autoSave: boolean; // save by itself after the tool writes to Excel
  onAutoSave: (on: boolean) => void;
  savedAt: Date | null;
  saveNote: string | null; // why the automatic save is waiting (Excel busy)
  onChangeUser: () => void;
  onChangeWorkbook: () => void;
  books: BookInfo[];
  onSwitch: (name: string) => void;
  onAddWorkbook: () => void;
  onCloseBook: (name: string) => void;
  onChangeMonth: () => void;
  story: { on: boolean; unlocked: number; total: number; onOpen: () => void };
}

export function StatusBar(props: Props) {
  const { page, status, user, historyLoaded, historyTotal, onSave, onChangeUser, onChangeWorkbook, story } = props;
  const { books, onSwitch, onAddWorkbook, onCloseBook, onChangeMonth, autoSave, onAutoSave, savedAt, saveNote, onRecover } = props;
  const savedText = savedAt ? savedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;
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
        <a href="#analysis" className={page === "analysis" ? "active" : ""}>
          Analysis
        </a>
        <a href="#supervisors" className={page === "supervisors" ? "active" : ""}>
          Supervisors
        </a>
      </nav>
      {status?.mode === "demo" && (
        <span className="badge demo" title="Changes stay in memory; Excel is not used">
          DEMO
        </span>
      )}
      {books.length > 0 ? (
        <WorkbookMenu books={books} active={active} title={backup} onSwitch={onSwitch} onAdd={onAddWorkbook} onClose={onCloseBook} onChangeMonth={onChangeMonth} />
      ) : (
        status?.workbook && <span className="workbook" title={backup}>{status.workbook}</span>
      )}
      {!status ? (
        <span className="muted">Connecting…</span>
      ) : (
        !status.connected && <span className="badge error">Not connected: {status.error}</span>
      )}
      {status?.connected && (status.excel_busy ?? 0) > 3 && (
        <span
          className="badge warn excel-busy"
          role="status"
          title="Excel has not answered the tool for a while: an open dialog or message box, a cell being edited, or a long calculation. Finish it in Excel; the tool carries on by itself and nothing is lost."
        >
          Excel busy {Math.round(status.excel_busy!)} s · waiting (check Excel for an open dialog)
        </span>
      )}
      {historyLoaded < historyTotal && (
        <span className="muted small">
          Loading month {historyLoaded}/{historyTotal}
        </span>
      )}
      <span className="spacer" />
      {status?.unsaved_changes ? (
        <span className="badge warn" title={saveNote ?? undefined}>
          {autoSave ? (saveNote ? "Auto-save waiting (Excel busy)" : "Saving soon…") : "Not saved in Excel yet"}
        </span>
      ) : (
        savedText && <span className="saved-note small" title="The workbook in Excel was saved">✓ Saved {savedText}</span>
      )}
      <button onClick={onSave} disabled={!status?.connected || !status.unsaved_changes}>
        Save Excel file
      </button>
      <label className="auto-switch small" title="The tool saves the workbook by itself: a few seconds after it writes to Excel (a push, an undo, a fix), and every 2 minutes if Excel holds unsaved changes (also ones typed in Excel). Works with this page closed too.">
        <input type="checkbox" checked={autoSave} onChange={(e) => onAutoSave(e.target.checked)} /> Auto-save
      </label>
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
      <button className="link" onClick={onRecover} title="Compare what the tool pushed (its change log) with this workbook, and put lost entries back on the manpower sheet">
        Recover…
      </button>
      <button className="link" onClick={onChangeUser} title="Change name">
        {user || "Set name"}
      </button>
    </header>
  );
}

/** The active workbook's name; opens the list of workbooks open in this tool: click one to work on
 * it, ✕ to take it off the list (the file and Excel are not touched), or open another. */
function WorkbookMenu({ books, active, title, onSwitch, onAdd, onClose, onChangeMonth }: {
  books: BookInfo[];
  active: string;
  title: string;
  onSwitch: (name: string) => void;
  onAdd: () => void;
  onClose: (name: string) => void;
  onChangeMonth: () => void;
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
          <button role="menuitem" className="link book-add" onClick={() => pick(onChangeMonth)} title="Which month this workbook is for: the sheets' dates and day types are checked and set for it">
            🗓 Change the month of this workbook…
          </button>
        </div>
      )}
    </div>
  );
}

