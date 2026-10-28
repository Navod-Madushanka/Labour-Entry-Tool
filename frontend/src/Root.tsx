import { useEffect, useState } from "react";
import { api, type SetupState } from "./api";
import { App } from "./App";
import { StartPage } from "./components/StartPage";

/** The start page until the workbook is chosen, checked and ready; then the entry screen. */
export function Root() {
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .setup()
      .then((s) => {
        setSetup(s);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

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
  if (!setup.ready) return <StartPage initial={setup} onDone={(s) => setSetup(s)} />;
  return (
    <App
      onChangeWorkbook={() =>
        api
          .setupReady(false)
          .then(setSetup)
          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      }
    />
  );
}
