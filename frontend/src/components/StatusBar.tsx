import type { Status } from "../api";

interface Props {
  status: Status | null;
  user: string;
  historyLoaded: number;
  historyTotal: number;
  onSave: () => void;
  onChangeUser: () => void;
}

export function StatusBar({ status, user, historyLoaded, historyTotal, onSave, onChangeUser }: Props) {
  return (
    <header className="statusbar">
      <strong className="brand">Labour Entry</strong>
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
      {status?.unsaved_changes && <span className="badge warn">Unsaved changes in Excel</span>}
      <button onClick={onSave} disabled={!status?.connected || !status.unsaved_changes}>
        Save workbook
      </button>
      <a href="/health" target="_blank" rel="noreferrer">
        Health check
      </a>
      <button className="link" onClick={onChangeUser} title="Change name">
        {user || "Set name"}
      </button>
    </header>
  );
}
