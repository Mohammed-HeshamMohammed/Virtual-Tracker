import { useState } from "react";
import { ChannelSidebar } from "./ChannelSidebar";
import { ChatPanel } from "./ChatPanel";
import { ControlDock } from "./ControlDock";
import { CrewSidebar } from "./CrewSidebar";
import { LoungeHome } from "./LoungeHome";
import { LoungeSidebar } from "./LoungeSidebar";

type LoungeView = "coworkers" | "channels";

/** Everything the app already had before Work and Dashboard existed: the coworkers/DM view
 *  and the project-channels view, still switchable between themselves, plus the voice dock
 *  and its Settings gear. Unchanged in substance - only pulled out from App.tsx so a mode is
 *  its own self-contained shell, the same shape as WorkShell and DashboardShell. */
export function LoungeShell({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [view, setView] = useState<LoungeView>("coworkers");
  const [channel, setChannel] = useState("general-orbit");

  return (
    <>
      <div className="lounge-view-switch" role="tablist" aria-label="Lounge view">
        <button role="tab" aria-selected={view === "coworkers"} className={view === "coworkers" ? "active" : ""} onClick={() => setView("coworkers")}>Coworkers</button>
        <button role="tab" aria-selected={view === "channels"} className={view === "channels" ? "active" : ""} onClick={() => setView("channels")}>Project rooms</button>
      </div>
      {view === "coworkers" ? (
        <>
          <LoungeSidebar />
          <LoungeHome />
        </>
      ) : (
        <>
          <ChannelSidebar activeChannel={channel} onChannelChange={setChannel} />
          <ChatPanel channel={channel} />
          <CrewSidebar />
        </>
      )}
      <ControlDock onOpenSettings={onOpenSettings} />
    </>
  );
}
