import { useState } from "react";
import {
  Broadcast,
  CaretDown,
  CaretRight,
  Check,
  Gear,
  Headphones,
  Microphone,
  MonitorArrowUp,
  PhoneDisconnect,
  SpeakerHigh,
  SquaresFour,
  VideoCamera,
  Waveform,
} from "@phosphor-icons/react";
import { Avatar } from "./Avatar";

type DeviceMenu = "input" | "output" | null;

const inputDevices = ["Windows default", "Laptop microphone array", "USB headset microphone", "Webcam microphone", "Conference speakerphone"];
const outputDevices = ["Windows default", "Soft Fix speakers", "USB headset", "HDMI display audio", "Conference room speaker"];

function DeviceDropdown({ kind, devices, selected, onSelect, volume, onVolumeChange }: { kind: "input" | "output"; devices: string[]; selected: string; onSelect: (device: string) => void; volume: number; onVolumeChange: (value: number) => void }) {
  const [submenu, setSubmenu] = useState<"devices" | "profile" | null>(null);
  const [profile, setProfile] = useState("Balanced");
  const [pushToTalk, setPushToTalk] = useState(false);
  return (
    <div className="device-menu" role="menu">
      <button className="device-summary" role="menuitem" onClick={() => setSubmenu(submenu === "devices" ? null : "devices")}>
        <span><strong>{kind === "input" ? "Input Device" : "Output Device"}</strong><small>{selected}</small></span><CaretRight />
      </button>
      {kind === "input" ? (
        <button className="device-summary" role="menuitem" onClick={() => setSubmenu(submenu === "profile" ? null : "profile")}>
          <span><strong>Input Profile</strong><small>{profile}</small></span><CaretRight />
        </button>
      ) : null}
      <div className="device-menu-rule" />
      <label className="device-volume"><span>{kind === "input" ? "Input Volume" : "Output Volume"}</span><input type="range" min="0" max="100" value={volume} onChange={event => onVolumeChange(Number(event.target.value))} /></label>
      {kind === "input" ? <>
        <label className="input-level"><span>Input Level</span><meter min="0" max="100" value={Math.max(12, volume - 24)} /></label>
        <label className="push-to-talk"><span>Push to Talk</span><input type="checkbox" checked={pushToTalk} onChange={event => setPushToTalk(event.target.checked)} /></label>
      </> : null}
      <div className="device-menu-rule" />
      <button role="menuitem"><Gear /><span>Voice settings</span></button>
      {submenu === "devices" ? (
        <div className="device-submenu" role="menu" aria-label={`${kind} devices`}>
          {devices.map((device, index) => (
            <button key={device} role="menuitemradio" aria-checked={selected === device} onClick={() => onSelect(device)}>
              <span><strong>{device}</strong><small>{index === 0 ? "Use the Windows-selected device" : kind === "input" ? "Available microphone" : "Available playback device"}</small></span>
              <i className={selected === device ? "selected" : ""}>{selected === device ? <Check weight="bold" /> : null}</i>
            </button>
          ))}
        </div>
      ) : null}
      {submenu === "profile" ? (
        <div className="device-submenu profile-submenu" role="menu" aria-label="Input profiles">
          {["Voice isolation", "Studio", "Balanced"].map(option => (
            <button key={option} role="menuitemradio" aria-checked={profile === option} onClick={() => setProfile(option)}>
              <strong>{option}</strong><i className={profile === option ? "selected" : ""}>{profile === option ? <Check weight="bold" /> : null}</i>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ControlDock({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [connected, setConnected] = useState(true);
  const [noiseCancellation, setNoiseCancellation] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [deviceMenu, setDeviceMenu] = useState<DeviceMenu>(null);
  const [inputDevice, setInputDevice] = useState(inputDevices[0]);
  const [outputDevice, setOutputDevice] = useState(outputDevices[0]);
  const [inputVolume, setInputVolume] = useState(78);
  const [outputVolume, setOutputVolume] = useState(86);

  return (
    <section className="control-dock" aria-label="Voice and profile controls">
      <div className="control-voice">
        <span className={`control-status-icon ${connected ? "connected" : ""}`}><Broadcast weight="fill" /></span>
        <span className="control-copy">
          <strong>{connected ? "Voice Connected" : "Voice Disconnected"}</strong>
          <small>{connected ? "Work room / Soft Fix Workplace" : "Select a work room to reconnect"}</small>
        </span>
        <button className={`dock-tooltip control-icon-button ${noiseCancellation ? "active" : ""}`} data-tooltip={noiseCancellation ? "Noise cancellation on" : "Noise cancellation off"} title="Noise cancellation" onClick={() => setNoiseCancellation(!noiseCancellation)}><Waveform /></button>
        <button className="dock-tooltip control-icon-button disconnect" data-tooltip={connected ? "Disconnect" : "Reconnect"} title={connected ? "Disconnect" : "Reconnect"} onClick={() => setConnected(!connected)}><PhoneDisconnect weight="fill" /></button>
      </div>

      <div className="control-actions">
        <button className={`dock-tooltip ${cameraOn ? "active" : ""}`} data-tooltip={cameraOn ? "Turn off camera" : "Turn on camera"} onClick={() => setCameraOn(!cameraOn)}><VideoCamera /></button>
        <button className={`dock-tooltip ${sharing ? "active" : ""}`} data-tooltip={sharing ? "Stop sharing" : "Share your screen"} onClick={() => setSharing(!sharing)}><MonitorArrowUp /></button>
        <button className={`dock-tooltip ${activityOpen ? "active" : ""}`} data-tooltip="Start an activity" onClick={() => setActivityOpen(!activityOpen)}><SquaresFour weight="fill" /></button>
        <button className={`dock-tooltip ${soundboardOpen ? "active" : ""}`} data-tooltip="Open soundboard" onClick={() => setSoundboardOpen(!soundboardOpen)}><SpeakerHigh weight="fill" /></button>
      </div>

      <div className="profile-dock">
        <Avatar initials="AR" color="violet" />
        <span className="profile-copy"><strong>aria.exe <em>PILOT</em></strong><small>{connected ? "In voice" : "Focused mode"}</small></span>

        <div className="device-control">
          <button className={`dock-tooltip device-main ${muted ? "danger" : ""}`} data-tooltip={muted ? "Unmute" : "Mute"} onClick={() => setMuted(!muted)} title="Mute microphone"><Microphone /></button>
          <button className="device-chevron" aria-label="Choose microphone" aria-expanded={deviceMenu === "input"} onClick={() => setDeviceMenu(deviceMenu === "input" ? null : "input")}><CaretDown /></button>
          {deviceMenu === "input" ? <DeviceDropdown kind="input" devices={inputDevices} selected={inputDevice} onSelect={setInputDevice} volume={inputVolume} onVolumeChange={setInputVolume} /> : null}
        </div>

        <div className="device-control">
          <button className={`dock-tooltip device-main ${deafened ? "danger" : ""}`} data-tooltip={deafened ? "Undeafen" : "Deafen"} onClick={() => setDeafened(!deafened)} title="Deafen headphones"><Headphones /></button>
          <button className="device-chevron" aria-label="Choose headphones" aria-expanded={deviceMenu === "output"} onClick={() => setDeviceMenu(deviceMenu === "output" ? null : "output")}><CaretDown /></button>
          {deviceMenu === "output" ? <DeviceDropdown kind="output" devices={outputDevices} selected={outputDevice} onSelect={setOutputDevice} volume={outputVolume} onVolumeChange={setOutputVolume} /> : null}
        </div>

        <button className="dock-tooltip profile-settings" data-tooltip="User settings" title="Settings" onClick={onOpenSettings}><Gear /></button>
      </div>
    </section>
  );
}
