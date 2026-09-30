import { useState } from "react";
import { AppToolbar } from "./components/AppToolbar";
import { ChatLauncher } from "./components/ChatLauncher";
import { DashboardShell } from "./components/dashboard/DashboardShell";
import { LoungeShell } from "./components/LoungeShell";
import { SettingsOverlay } from "./components/SettingsOverlay";
import { WorkShell } from "./components/work/WorkShell";

export type Mode = "lounge" | "work" | "dashboard";

export default function App() {
  const [mode, setMode] = useState<Mode>("lounge");
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="shell-root">
      <AppToolbar mode={mode} onModeChange={setMode} onOpenSettings={() => setSettingsOpen(true)} />
      <div className={`app-shell mode-${mode}`}>
        {/* All three modes stay mounted - display:contents, toggled by [hidden] - so
            switching modes never resets a picked project, a half-typed message, or (the
            one that actually matters) a running timer. Only the active one is in the grid. */}
        <div className="mode-pane" hidden={mode !== "lounge"}>
          <LoungeShell onOpenSettings={() => setSettingsOpen(true)} />
        </div>
        <div className="mode-pane" hidden={mode !== "work"}>
          <WorkShell />
        </div>
        <div className="mode-pane" hidden={mode !== "dashboard"}>
          <DashboardShell />
        </div>
        {mode === "dashboard" ? <ChatLauncher onOpen={() => setMode("lounge")} /> : null}
      </div>
      {settingsOpen ? <SettingsOverlay onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
