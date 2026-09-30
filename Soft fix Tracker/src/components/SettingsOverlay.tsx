import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CaretRight,
  Cloud,
  DownloadSimple,
  GearSix,
  HardDrives,
  Key,
  MagnifyingGlass,
  PaintBrushBroad,
  Plug,
  ShieldCheck,
  SignOut,
  SlidersHorizontal,
  UserCircle,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { Avatar } from "./Avatar";

type Props = { onClose: () => void };

const settingsItems = [
  { label: "Account", icon: UserCircle },
  { label: "Data & Privacy", icon: ShieldCheck },
  { label: "Team Permissions", icon: UsersThree },
  { label: "Notifications", icon: Bell },
  { label: "Appearance", icon: PaintBrushBroad },
  { label: "Integrations", icon: Plug },
  { label: "Storage", icon: HardDrives },
  { label: "Cloud Sync", icon: Cloud },
  { label: "Updater", icon: DownloadSimple },
];

function SettingRow({ label, value, action = "Edit", onAction }: { label: string; value: string; action?: string; onAction?: () => void }) {
  return (
    <div className="setting-row">
      <strong>{label}</strong>
      <span>{value}</span>
      <button onClick={onAction}>{action === "Open" ? <CaretRight /> : action}</button>
    </div>
  );
}

export function SettingsOverlay({ onClose }: Props) {
  const [active, setActive] = useState("Account");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const filteredItems = useMemo(
    () => settingsItems.filter(item => item.label.toLowerCase().includes(query.toLowerCase())),
    [query]
  );

  const edit = (field: string) => {
    setNotice(`${field} editing is ready for the next prototype pass.`);
    window.setTimeout(() => setNotice(""), 2400);
  };

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="settings-window" role="dialog" aria-modal="true" aria-label="Soft Fix settings">
        <button className="settings-close" onClick={onClose} aria-label="Close settings"><X /></button>

        <aside className="settings-nav">
          <div className="settings-identity">
            <Avatar initials="AR" color="violet" size="lg" />
            <span><strong>aria.exe</strong><small>Manage your profile</small></span>
          </div>
          <label className="settings-search"><MagnifyingGlass /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search settings" /></label>
          <nav>
            {filteredItems.map(({ label, icon: Icon }) => (
              <button key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)}><Icon weight={active === label ? "fill" : "regular"} /><span>{label}</span></button>
            ))}
          </nav>
          <div className="settings-nav-rule" />
          <small className="settings-nav-heading">SOFT FIX WORKPLACE</small>
          <button className="settings-nav-static"><SlidersHorizontal /><span>Advanced</span></button>
          <button className="settings-nav-static"><GearSix /><span>Developer settings</span></button>
          <button className="settings-signout"><SignOut /><span>Sign out</span></button>
        </aside>

        <main className="settings-content">
          <header><span>Settings</span><strong>{active}</strong></header>
          {active === "Account" ? (
            <div className="settings-page">
              <div className="settings-page-title"><UserCircle weight="duotone" /><div><h1>Account</h1><p>Manage your Soft Fix identity, access, and sign-in security.</p></div></div>

              <section className="settings-section">
                <h2>Account info</h2>
                <SettingRow label="Display name" value="aria.exe" onAction={() => edit("Display name")} />
                <SettingRow label="Work email" value="a••••••@softfix.work" onAction={() => edit("Work email")} />
                <SettingRow label="Employee ID" value="SF-0248" onAction={() => edit("Employee ID")} />
              </section>

              <section className="settings-section">
                <h2>Password & security</h2>
                <SettingRow label="Password" value="Last changed 31 days ago" onAction={() => edit("Password")} />
                <SettingRow label="Multi-factor authentication" value="Enabled" action="Open" onAction={() => edit("MFA")} />
                <SettingRow label="Logged-in devices" value="3 devices" action="Open" onAction={() => edit("Devices")} />
              </section>

              <section className="settings-section">
                <h2>Account status</h2>
                <div className="security-note"><ShieldCheck weight="fill" /><p>Your account is protected by company access policy. Role changes are controlled by an owner, admin, or super admin.</p><button aria-label="Dismiss notice"><X /></button></div>
                <div className="status-grid"><span><Key /><b>MEMBER</b><small>Workspace role</small></span><span><ShieldCheck /><b>HEALTHY</b><small>Security status</small></span></div>
              </section>
            </div>
          ) : (
            <div className="settings-page settings-placeholder">
              <div className="settings-page-title"><GearSix weight="duotone" /><div><h1>{active}</h1><p>This category is ready for its detailed Soft Fix settings design.</p></div></div>
            </div>
          )}
        </main>
        {notice ? <div className="settings-toast">{notice}</div> : null}
      </section>
    </div>
  );
}
