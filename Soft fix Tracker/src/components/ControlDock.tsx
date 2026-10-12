import { useState } from "react";
import { Gear, Headphones, Microphone, MicrophoneSlash, PhoneDisconnect, Waveform } from "@phosphor-icons/react";
import { useWorkspace } from "../workspace";
import { Avatar } from "./Avatar";

export function ControlDock({ onOpenSettings, roomName, onLeave }: { onOpenSettings: () => void; roomName?: string; onLeave?: () => void }) {
  const { profile, preferences } = useWorkspace();
  const [muted, setMuted] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const status = preferences.activityVisible ? profile.status : "Invisible";
  return <section className="lg-control-dock" aria-label="Voice and profile controls">
    {roomName && <div className="lg-voice-connected"><div><Waveform /><span><strong>Voice Connected</strong><small>{roomName} · preview only</small></span><button className="lg-icon-button" aria-label="Leave room preview" title="Disconnect" onClick={onLeave}><PhoneDisconnect /></button></div></div>}
    <div className="lg-profile-dock"><button className="lg-profile-button" aria-label="Open profile settings" onClick={onOpenSettings}><span className="lg-avatar-status"><Avatar initials={profile.name.split(" ").map(word => word[0]).slice(0, 2).join("")} color="blue" /><i className={`lg-status-dot ${status.toLowerCase()}`} /></span><span><strong>{profile.name}</strong><small>{status}</small></span></button><div className="lg-profile-controls"><button className={`lg-icon-button ${muted ? "is-muted" : ""}`} aria-label={muted ? "Unmute microphone preview" : "Mute microphone preview"} title={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? <MicrophoneSlash /> : <Microphone />}</button><button className={`lg-icon-button ${deafened ? "is-muted" : ""}`} aria-label={deafened ? "Enable audio preview" : "Deafen audio preview"} title={deafened ? "Undeafen" : "Deafen"} aria-pressed={deafened} onClick={() => setDeafened(!deafened)}><Headphones /></button><button className="lg-icon-button" aria-label="User settings" title="User Settings" onClick={onOpenSettings}><Gear weight="fill" /></button></div></div>
  </section>;
}

