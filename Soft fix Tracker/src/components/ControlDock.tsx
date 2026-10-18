import { useEffect, useRef } from "react";
import { CaretDown, Gear, Headphones, Microphone, MicrophoneSlash, MonitorArrowUp, PhoneDisconnect, Sparkle, SpeakerHigh, VideoCamera, VideoCameraSlash, Waveform, X } from "@phosphor-icons/react";
import { useWorkspace } from "../workspace";
import { Avatar } from "./Avatar";
import { VoicePanels } from "./VoicePanels";
import { voicePanelTitles, type VoicePanel, type VoiceUiState } from "./voice-ui";

export function ControlDock({ onOpenSettings, roomName, onLeave, muted, onToggleMute, voiceUi, onVoiceUi, inVoiceRoom }: {
  onOpenSettings: () => void; roomName?: string; onLeave: () => void;
  muted: boolean; onToggleMute: () => void; voiceUi: VoiceUiState;
  onVoiceUi: (change: Partial<VoiceUiState>) => void; inVoiceRoom: boolean;
}) {
  const { profile, preferences } = useWorkspace();
  const panel = voiceUi.panel;
  const root = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const status = preferences.activityVisible ? profile.status : "Invisible";
  const close = () => { onVoiceUi({panel:undefined}); opener.current?.focus(); };
  const open = (next: VoicePanel) => {
    opener.current = document.activeElement as HTMLElement;
    onVoiceUi({panel:panel === next ? undefined : next});
  };
  useEffect(() => {
    if (!panel || inVoiceRoom) return;
    panelRef.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onVoiceUi({panel:undefined}); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onVoiceUi({panel:undefined}); opener.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [panel, inVoiceRoom]);
  return <section ref={root} className="lg-control-dock" aria-label="Voice and profile controls">
    {panel && !inVoiceRoom && <div ref={panelRef} className="lg-voice-popover" role="dialog" aria-label={voicePanelTitles[panel]} tabIndex={-1}>
      <header><div><small>UI PREVIEW</small><h2>{voicePanelTitles[panel]}</h2></div><button className="lg-icon-button" aria-label="Close voice panel" onClick={close}><X /></button></header>
      <VoicePanels key={panel} panel={panel} state={voiceUi} update={onVoiceUi} roomName={roomName} muted={muted} />
    </div>}
    {roomName && <div className="lg-voice-connected">
      <div><button className="lg-connection-summary" aria-label="Voice connection details" aria-expanded={panel === "connection"} onClick={() => open("connection")}><Waveform /><span><strong>Voice preview</strong><small>{roomName}</small></span></button><span className="lg-voice-preview-label">PREVIEW</span><button className="lg-icon-button" aria-label="Voice connection details" title="Connection details" onClick={() => open("connection")}><Waveform /></button><button className="lg-icon-button lg-disconnect" aria-label="Leave room preview" title="Disconnect" onClick={() => { close(); onLeave(); }}><PhoneDisconnect /></button></div>
      <div className="lg-voice-action-bar" aria-label="Voice room actions">
        <button aria-label="Camera controls" title="Camera" aria-pressed={voiceUi.camera} onClick={() => open("camera")}>{voiceUi.camera ? <VideoCamera weight="fill" /> : <VideoCameraSlash />}</button>
        <button aria-label="Screen sharing controls" title="Share your screen" aria-pressed={voiceUi.screen} onClick={() => open("share")}><MonitorArrowUp /></button>
        <button aria-label="Choose an activity" title="Activities" aria-expanded={panel === "activities"} aria-pressed={!!voiceUi.activity} onClick={() => open("activities")}><Sparkle weight="fill" /></button>
        <button aria-label="Open soundboard" title="Soundboard" aria-expanded={panel === "soundboard"} onClick={() => open("soundboard")}><SpeakerHigh weight="fill" /></button>
      </div>
    </div>}
    <div className="lg-profile-dock"><button className="lg-profile-button" aria-label="Open profile settings" onClick={onOpenSettings}><span className="lg-avatar-status"><Avatar memberId="me" initials={profile.name.split(" ").map(word => word[0]).slice(0, 2).join("")} color="blue" /><i className={`lg-status-dot ${status.toLowerCase()}`} /></span><span><strong>{profile.name}</strong><small>{voiceUi.deafened ? "Deafened" : status}</small></span></button><div className="lg-profile-controls"><button className={`lg-icon-button ${muted ? "is-muted" : ""}`} aria-label={muted ? "Unmute microphone preview" : "Mute microphone preview"} title={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={onToggleMute}>{muted ? <MicrophoneSlash /> : <Microphone />}</button><button className="lg-audio-menu-button" aria-label="Audio device settings" title="Audio devices" aria-expanded={panel === "audio"} onClick={() => open("audio")}><CaretDown /></button><button className={`lg-icon-button ${voiceUi.deafened ? "is-muted" : ""}`} aria-label={voiceUi.deafened ? "Enable audio preview" : "Deafen audio preview"} title={voiceUi.deafened ? "Undeafen" : "Deafen"} aria-pressed={voiceUi.deafened} onClick={() => onVoiceUi({deafened: !voiceUi.deafened})}><Headphones /></button><button className="lg-icon-button" aria-label="User settings" title="User Settings" onClick={onOpenSettings}><Gear weight="fill" /></button></div></div>
  </section>;
}
