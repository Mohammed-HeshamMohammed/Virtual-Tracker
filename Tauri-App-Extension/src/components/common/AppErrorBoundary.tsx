import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The last thing between a crash and a blank window.
 *
 * There was no error boundary anywhere in this app, and no `window.onerror` or
 * `unhandledrejection` handler either. A render-time throw therefore unmounted
 * the whole tree and left the window painting nothing - indistinguishable, from
 * the outside, from the WebView2 renderer being killed outright. Either way the
 * member sees one flat rectangle and has no way to recover but to kill the app,
 * and we get no report of what happened.
 *
 * This cannot catch a renderer that the OS has already killed - nothing running
 * inside it can. What it can do is catch every failure that is merely a bug,
 * say so, and offer the reload that fixes it.
 */
type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // console.* is forwarded to the Rust log, so this lands in the file the
    // member can send us. It is the only trace such a crash leaves.
    console.error("UI crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-crash">
        <h1>Something broke in the app window</h1>
        <p>
          Your tracking is unaffected — it runs outside this window and is still
          recording. Reloading only restarts the display.
        </p>
        <pre>{this.state.error.message}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

/**
 * Catches what the boundary cannot: errors thrown outside React's render path,
 * and rejected promises nobody handled. Neither would otherwise leave a trace,
 * and both are how a background failure becomes a window that has quietly
 * stopped updating.
 */
export function installGlobalErrorLogging() {
  window.addEventListener("error", (event) => {
    console.error("Uncaught error:", event.message, event.filename, event.lineno);
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection:", event.reason);
  });
}
