import type { Status } from "../api";

interface Props {
  page: "entry" | "codes";
  status: Status | null;
  user: string;
  historyLoaded: number;
  historyTotal: number;
  onSave: () => void;
  onChangeUser: () => void;
  onChangeWorkbook: () => void;
  story: { on: boolean; unlocked: number; onOpen: () => void };
}

export function StatusBar({ page, status, user, historyLoaded, historyTotal, onSave, onChangeUser, onChangeWorkbook, story }: Props) {
  return (
    <header className="statusbar">
      <strong className="brand">Labour Entry</strong>
      <nav className="tabs">
        <a href="#" className={page === "entry" ? "active" : ""}>
          Entry
        </a>
        <a href="#codes" className={page === "codes" ? "active" : ""}>
          Codes &amp; registration
        </a>
      </nav>
      {status?.mode === "demo" && (
        <span className="badge demo" title="Changes stay in memory; Excel is not used">
          DEMO
        </span>
      )}
      {status ? (
        status.connected ? (
          <span className="workbook" title={status.backup ? `Backup: ${status.backup}` : "No backup yet"}>
            {status.workbook}
          </span>
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
        📖 {!story.on ? "off" : story.unlocked ? `${story.unlocked}/7` : "?"}
      </button>
      <button className="link" onClick={onChangeWorkbook} title="Choose another workbook or check this one again">
        Change workbook
      </button>
      <button className="link" onClick={onChangeUser} title="Change name">
        {user || "Set name"}
      </button>
    </header>
  );
}
