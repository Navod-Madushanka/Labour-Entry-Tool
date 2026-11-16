// Updates of the Windows package (backend/app/updater.py): a bar when a new, verified version is
// ready ("Restart and update"), and a small "Version …" button (bottom right) with the details,
// "Check now" and the automatic switch. Installing restarts the tool; the page reloads by itself
// on the new version and the waiting entries come back (they are kept by the browser).
import { useEffect, useState } from "react";
import { api, type UpdateState } from "../api";

export function Updates({ waiting }: { waiting: number }) {
  const [u, setU] = useState<UpdateState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [hidden, setHidden] = useState<string | null>(null); // "Later" for this version (this visit)

  useEffect(() => {
    const load = () => api.updateState().then(setU).catch(() => undefined);
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  // after "Restart and update": wait for the tool to come back on the new version, then reload
  useEffect(() => {
    if (!restarting || !u) return;
    const from = u.current;
    const t = setInterval(() => {
      api.status().then((s) => s.version && s.version !== from && window.location.reload(), () => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [restarting, u]);

  if (!u) return null;
  const check = async () => {
    setBusy(true);
    try {
      setU(await api.checkUpdate());
    } catch {
      /* shown in the state */
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    const keep = waiting ? `\n\nThe ${waiting} ${waiting === 1 ? "entry" : "entries"} waiting to go to Excel are kept and come back after the restart.` : "";
    if (!window.confirm(`Restart the tool and update to version ${u.latest}?\n\nIt takes about half a minute. Excel and your workbook stay open; nothing in Excel or in your data folder is changed.${keep}`)) return;
    setBusy(true);
    try {
      await api.installUpdate();
      setRestarting(true);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const status =
    u.state === "off"
      ? "Automatic updates are not set up yet (the releases are not signed)."
      : u.state === "ready"
        ? `Version ${u.latest} is downloaded and verified: ready to install.`
        : u.state === "downloading"
          ? `Downloading version ${u.latest}…`
          : u.state === "checking"
            ? "Checking…"
            : u.state === "up_to_date"
              ? "This is the latest version."
              : u.state === "error"
                ? `Could not check: ${u.error}`
                : "Not checked yet.";

  return (
    <>
      {restarting && (
        <div className="update-bar restarting" role="status">
          Updating to version {u.latest}… the page reloads by itself in a moment.
        </div>
      )}
      {!restarting && u.state === "ready" && u.can_install && hidden !== u.latest && (
        <div className="update-bar" role="status">
          <span>
            <b>Version {u.latest} is ready.</b> Restart the tool to use it (about half a minute; your data and Excel are not touched).
          </span>
          <button className="small primary" disabled={busy} onClick={install}>
            Restart and update
          </button>
          <button className="link small" onClick={() => setOpen(true)}>
            What's new
          </button>
          <button className="link small" onClick={() => setHidden(u.latest)} title="It installs by itself the next time you start the tool">
            Later
          </button>
        </div>
      )}
      <div className="update-chip">
        <button className="link small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Version {u.current}
          {u.state === "ready" ? " · update ready" : ""}
        </button>
        {open && (
          <div className="update-panel card" role="dialog" aria-label="Updates">
            <div className="update-head">
              <b>Updates</b>
              <button className="link small" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <p className="small">
              Installed: <b>{u.current}</b>
              {u.latest && u.latest !== u.current ? (
                <>
                  {" "}
                  · newest: <b>{u.latest}</b>
                </>
              ) : null}
            </p>
            <p className={`small ${u.state === "error" ? "warn-text" : "muted"}`}>{status}</p>
            {u.state !== "off" && (
              <>
                <label className="check small">
                  <input type="checkbox" checked={u.auto} onChange={(e) => api.setUpdateAuto(e.target.checked).then(setU).catch(() => undefined)} /> Check and download
                  updates by themselves (installed only when you restart)
                </label>
                <div className="row">
                  <button className="small" disabled={busy || u.state === "checking" || u.state === "downloading"} onClick={check}>
                    Check now
                  </button>
                  {u.state === "ready" && u.can_install && (
                    <button className="small primary" disabled={busy} onClick={install}>
                      Restart and update
                    </button>
                  )}
                </div>
              </>
            )}
            {u.notes && u.latest !== u.current && (
              <details className="small" open={u.state === "ready"}>
                <summary>What's new in {u.latest}</summary>
                <pre className="update-notes">{u.notes}</pre>
              </details>
            )}
            <p className="muted small">
              Updates come only from this tool's own GitHub releases, signed by its build; a download whose signature does not match is refused. Nothing
              about this PC, you or the workbooks is sent. Your data folder is never changed, and the old version is kept as LabourEntryTool.previous.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
