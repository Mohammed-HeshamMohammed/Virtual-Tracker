import { invoke } from "@tauri-apps/api/core";
import type { MonitoringNoticeView } from "../../types";
import { TitleBar } from "../common/TitleBar";

// CF-2: full-screen, non-dismissible by design - no back button, no close-X,
// no click-outside-to-dismiss. The only way past it is the Accept action,
// which is exactly what "cannot be hidden or disabled by any setting or
// flag" means for the one screen whose entire job is to require attention.
export function MonitoringNoticePanel({
  notice,
  busy,
  onAccept,
}: {
  notice: MonitoringNoticeView;
  busy: boolean;
  onAccept: () => void;
}) {
  return (
    <main className="agent-tray view-home">
      <TitleBar title="Virtual Tracker" onClose={() => void invoke("close_window")} />
      <div className="reconnect-body">
        <div className="notice-card">
          <h1 className="reconnect-name">Before you start tracking</h1>
          <pre className="notice-text">{notice.text}</pre>
          <button
            className="btn btn-primary reconnect-btn"
            type="button"
            disabled={busy}
            onClick={onAccept}
          >
            {busy ? "Recording…" : "I understand — continue"}
          </button>
        </div>
      </div>
    </main>
  );
}
