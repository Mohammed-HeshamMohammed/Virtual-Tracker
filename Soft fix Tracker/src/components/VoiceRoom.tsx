import { useEffect, useRef, useState } from "react";
import "./voice-room.css";
import { ArrowsOut, ArrowsIn, ChatCircleDots, DotsThree, Gear, Headphones, Microphone, MicrophoneSlash, MonitorArrowUp, PhoneDisconnect, PushPin, SpeakerHigh, SquaresFour, Sparkle, UsersThree, VideoCamera, VideoCameraSlash, X } from "@phosphor-icons/react";
import { useWorkspace } from "../workspace";
import { Avatar } from "./Avatar";
import type { LoungeRoom } from "./lounge-model";
import { VoicePanels } from "./VoicePanels";
import { voiceActivities, voicePanelTitles, type VoicePanel, type VoiceUiState } from "./voice-ui";
export type { VoiceUiState } from "./voice-ui";

type Props = { room: LoungeRoom; connected: boolean; muted: boolean; voiceUi: VoiceUiState; onJoin: () => void; onChat: () => void; onLeave: () => void; onToggleMute: () => void; onVoiceUi: (change: Partial<VoiceUiState>) => void };
export function VoiceRoom({ room, connected, muted, onJoin, onChat, voiceUi: state, onLeave, onToggleMute, onVoiceUi: update }: Props) {
  const { profile } = useWorkspace();
  const panelRef=useRef<HTMLElement>(null);
  const panelOpener=useRef<HTMLElement | null>(null);
  const [expanded,setExpanded] = useState(false);
  const [menu,setMenu] = useState(false);
  const [ready,setReady] = useState(false);
  const [note,setNote] = useState("");
  useEffect(() => { setReady(false); setNote(""); }, [state.activity,room.id]);
  useEffect(() => {
    if (state.panel) {
      if (!panelRef.current?.contains(document.activeElement)) panelOpener.current=document.activeElement as HTMLElement;
      panelRef.current?.focus();
    } else if (panelOpener.current?.isConnected) panelOpener.current.focus();
  },[state.panel]);
  useEffect(() => { const escape=(event:KeyboardEvent) => { if(event.key === "Escape") { setExpanded(false); setMenu(false); if (state.panel) update({panel:undefined}); } }; document.addEventListener("keydown",escape); return () => document.removeEventListener("keydown",escape); },[state.panel]);
  const panel=(next:VoicePanel) => update({panel:state.panel === next ? undefined : next});
  const activity=voiceActivities.find(value => value.name === state.activity);
  const initials=profile.name.split(" ").map(word => word[0]).slice(0,2).join("");
  return <main className={`lg-main lg-voice-room vc-room ${expanded ? "vc-room-expanded" : ""}`}>
    <header className="lg-topbar"><div className="lg-topbar-title"><SpeakerHigh /><h1>{room.name}</h1><span className="vc-preview-badge">UI preview</span></div><div className="vc-room-tools">
      <button className="lg-icon-button" aria-label="Room participants" aria-pressed={state.panel === "participants"} onClick={() => panel("participants")}><UsersThree /></button>
      <button className="lg-icon-button" aria-label="Toggle focus layout" aria-pressed={state.layout === "focus"} onClick={() => update({layout:state.layout === "grid" ? "focus" : "grid"})}><SquaresFour /></button>
      <button className="lg-icon-button" aria-label={expanded ? "Restore room size" : "Expand room view"} onClick={() => setExpanded(!expanded)}>{expanded ? <ArrowsIn /> : <ArrowsOut />}</button>
      <button className="lg-icon-button" aria-label={`Open voice chat for ${room.name}`} onClick={onChat}><ChatCircleDots /></button>
    </div></header>
    <div className={`vc-workspace ${state.panel ? "vc-panel-open" : ""}`}>
      <div className="vc-room-body">
        <div className="vc-room-heading"><div><span>VOICE CHANNEL</span><h2>{connected ? "Your space to connect." : "A seat is waiting for you."}</h2><p>{connected ? "1 participant · local preview" : "Join the preview to explore your call controls."}</p></div><button className="vc-subtle-button" onClick={() => panel("connection")}><SpeakerHigh />Room details</button></div>
        {connected ? <>
          <div className={`vc-stage vc-layout-${state.layout} ${state.screen && state.spotlight === "screen" ? "vc-screen-focused" : ""}`} aria-label="Voice room stage">
            <section className={`vc-participant-tile ${state.camera ? "vc-camera-visible" : ""} vc-background-${state.background.toLowerCase()}`} aria-label={`${profile.name}, you`}>
              <div className="vc-tile-top"><span className="vc-preview-badge">{state.camera ? `Camera layout · ${state.cameraQuality}` : "Voice only"}</span><div className="vc-tile-menu-wrap"><button className="lg-icon-button" aria-label="Your participant options" aria-expanded={menu} onClick={() => setMenu(!menu)}><DotsThree /></button>{menu && <div className="vc-tile-menu"><button onClick={() => { update({spotlight:"participant",layout:"focus"});setMenu(false); }}><PushPin />Focus my tile</button><button onClick={() => { update({names:!state.names});setMenu(false); }}>{state.names ? "Hide names" : "Show names"}</button><button onClick={() => { panel("camera");setMenu(false); }}><VideoCamera />Camera settings</button></div>}</div></div>
              <div className={`vc-person-avatar ${state.mirror ? "vc-mirror-preview" : ""}`}><Avatar memberId="me" initials={initials} color="blue" size="lg" /></div>
              {state.camera && <small className="vc-camera-caption">Camera layout preview · {state.background} background</small>}
              <div className="vc-tile-footer">{state.names && <strong>{profile.name}<small>You</small></strong>}<span className={`vc-mic-state ${muted || state.deafened ? "is-muted" : ""}`}>{muted || state.deafened ? <MicrophoneSlash /> : <Microphone />}{state.deafened ? "Deafened" : muted ? "Muted" : "Mic on"}</span></div>
            </section>
            {state.screen && <section className="vc-share-tile" aria-label="Screen share layout"><header><span><MonitorArrowUp />{state.shareSource}</span><button className="lg-icon-button" aria-label="Stop screen sharing layout" onClick={() => update({screen:false,spotlight:"participant"})}><X /></button></header><button className="vc-screen-stage" aria-label="Focus shared screen layout" onClick={() => update({spotlight:"screen",layout:"focus"})}><MonitorArrowUp /><strong>Shared content goes here</strong><small>Screen layout preview</small></button><footer><span>{state.resolution} · {state.fps} FPS · {state.shareAudio ? "Audio included" : "No audio"}</span><button className="lg-icon-button" aria-label="Screen share settings" onClick={() => panel("share")}><Gear /></button></footer></section>}
          </div>
          {activity && <section className="vc-active-activity"><header><span className="vc-activity-icon">{activity.icon}</span><div><small>ACTIVITY PREVIEW</small><h3>{activity.name}</h3></div><button className="lg-icon-button" aria-label="Leave activity preview" onClick={() => update({activity:undefined})}><X /></button></header><p>{activity.text}</p>{["Brainstorm","Team check-in"].includes(activity.name) && <label className="vc-field"><span>{activity.name === "Brainstorm" ? "Your idea" : "Your update"}</span><textarea placeholder="Write something for the room…" value={note} onChange={event => setNote(event.target.value)} /></label>}<div className="vc-activity-footer"><span>{ready ? "You are ready · 1/1" : "Settle in when you are ready"}</span><button className="sf-button" aria-pressed={ready} onClick={() => setReady(!ready)}>{ready ? "Ready ✓" : "I’m ready"}</button></div></section>}
          <div className="vc-room-hint"><span>No one else is in this preview yet.</span><button className="lg-text-button" onClick={onChat}>Open room chat<ChatCircleDots /></button></div>
        </> : <div className="vc-join-state"><div><SpeakerHigh /></div><h3>{room.name}</h3><p>Talk, share your screen, or spend time together.</p><button className="sf-button primary" onClick={onJoin}>Join voice preview</button><button className="lg-text-button" onClick={onChat}>Open text chat instead</button></div>}
      </div>
      {state.panel && <aside ref={panelRef} tabIndex={-1} className="vc-room-panel" aria-label={voicePanelTitles[state.panel]}><header><div><small>ROOM CONTROLS</small><h2>{voicePanelTitles[state.panel]}</h2></div><button className="lg-icon-button" aria-label="Close room panel" onClick={() => update({panel:undefined})}><X /></button></header><nav className="vc-panel-nav" aria-label="Room control sections">{(["participants","audio","camera","share","activities","soundboard"] as VoicePanel[]).map(value => <button key={value} aria-pressed={state.panel === value} onClick={() => update({panel:value})}>{value === "participants" ? "People" : value === "share" ? "Share" : value[0].toUpperCase()+value.slice(1)}</button>)}</nav><VoicePanels key={state.panel} panel={state.panel} state={state} update={update} roomName={connected ? room.name : undefined} muted={muted || state.deafened} /></aside>}
    </div>
    {connected && <footer className="vc-call-controls" aria-label="In-room call controls"><div>
      <button className={muted || state.deafened ? "vc-control-muted" : ""} aria-label={muted || state.deafened ? "Unmute in room" : "Mute in room"} aria-pressed={muted || state.deafened} onClick={onToggleMute}>{muted || state.deafened ? <MicrophoneSlash /> : <Microphone />}</button>
      <button aria-label="In-room audio settings" onClick={() => panel("audio")}><Headphones /></button>
      <button aria-label="In-room camera settings" aria-pressed={state.camera} onClick={() => panel("camera")}>{state.camera ? <VideoCamera /> : <VideoCameraSlash />}</button>
      <button aria-label="In-room screen share" aria-pressed={state.screen} onClick={() => panel("share")}><MonitorArrowUp /></button>
      <button aria-label="In-room activities" aria-pressed={!!state.activity} onClick={() => panel("activities")}><Sparkle /></button>
      <button aria-label="In-room soundboard" onClick={() => panel("soundboard")}><SpeakerHigh /></button>
      <button className="vc-leave-call" aria-label="Disconnect from voice preview" onClick={onLeave}><PhoneDisconnect /></button>
    </div><small>Controls preview · no devices are accessed</small></footer>}
  </main>;
}
