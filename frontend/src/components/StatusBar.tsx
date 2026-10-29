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
  story: { on: boolean; unlocked: number; total: number; onOpen: () => void };
}

export function StatusBar(props: Props) {
  const { page, status, user, historyLoaded, historyTotal, onSave, onChangeUser, onChangeWorkbook, story } = props;
  const { books, onSwitch, onAddWorkbook } = props;
  const active = books.find((b) => b.active)?.name ?? status?.workbook ?? "";
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
      {status ? (
        status.connected ? (
          books.length > 1 ? (
            <select
              className="workbook-pick"
              aria-label="Workbook"
              value={active}
              onChange={(e) => onSwitch(e.target.value)}
              title={status.backup ? `Backup: ${status.backup}` : "No backup yet"}
            >
              {books.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="workbook" title={status.backup ? `Backup: ${status.backup}` : "No backup yet"}>
              {status.workbook}
            </span>
          )
        ) : (
          <span className="badge error">Not connected: {status.error}</span>
        )
      ) : (
        <span className="muted">Connecting…</span>
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
      <button className="link" onClick={onAddWorkbook} title="Open one more workbook (this one stays open)">
        + Workbook
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
