import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root";
import "./styles.css";

/** If anything in the page breaks, say so on screen instead of leaving a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="start">
        <div className="banner BLOCK">
          <div>
            <p>
              <b>Something went wrong in this page.</b> Your data in Excel is not affected. Reload the page; if this
              message comes back, send this text to whoever looks after the tool:
            </p>
            <pre className="small">{String(error.stack || error)}</pre>
          </div>
          <div className="actions">
            <button onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
