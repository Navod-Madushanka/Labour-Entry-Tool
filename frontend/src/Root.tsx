import { useEffect, useState } from "react";
import { api, type SetupState } from "./api";
import { App } from "./App";
import { StartPage } from "./components/StartPage";

/** The start page until the workbook is chosen, checked and ready; then the entry screen. Several
 * workbooks can be open: the entry screen works on the active one, and switching reloads it. */
export function Root() {
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false); // on the start page to open one more workbook

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const load = () =>
    api
      .setup()
      .then((s) => {
        setSetup(s);
        setError(null);
      })
      .catch(fail);

  useEffect(() => {
    load();
  }, []);

  if (error)
    return (
      <main className="start">
        <p className="error-text">Cannot reach the tool: {error}. Is its window still open?</p>
        <button onClick={load}>Try again</button>
      </main>
    );
  if (!setup) return <main className="start muted">Starting…</main>;
  if (!setup.ready || adding)
    return (
      <StartPage
        key={adding ? "add" : setup.workbook ?? ""}
        initial={setup}
        adding={adding}
        onDone={(s) => {
          setAdding(false);
          setSetup(s);
        }}
        onCancel={setup.ready ? () => setAdding(false) : undefined}
      />
    );
  return (
    <App
      key={setup.workbook ?? ""}
      books={setup.books}
      onSwitch={(name) => api.setupSwitch(name).then(setSetup).catch(fail)}
      onAddWorkbook={() => setAdding(true)}
      onCloseBook={(name) => api.setupClose(name).then(setSetup).catch(fail)}
      onChangeWorkbook={() => api.setupReady(false).then(setSetup).catch(fail)}
    />
  );
}
