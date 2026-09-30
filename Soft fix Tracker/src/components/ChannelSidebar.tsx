import { useState } from "react";
import { Bell, Broadcast, Buildings, CalendarPlus, CaretDown, CheckSquare, Copy, FolderPlus, Gear, Hash, Lock, Megaphone, Plugs, Plus, ShieldCheck, SpeakerHigh, UserCircleGear, UserPlus, UsersThree } from "@phosphor-icons/react";
import { channels } from "../data/community";
import { Avatar } from "./Avatar";

type Props = { activeChannel: string; onChannelChange: (channel: string) => void };

export function ChannelSidebar({ activeChannel, onChannelChange }: Props) {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [hideInactive, setHideInactive] = useState(false);
  return (
    <aside className="channel-sidebar">
      <button className="community-header" aria-expanded={workspaceMenuOpen} onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}>
        <span className="community-logo">SF</span>
        <span><strong>Soft Fix Workplace</strong><small>COMPANY WORKSPACE</small></span>
        <CaretDown className={workspaceMenuOpen ? "open" : ""} weight="bold" />
      </button>
      {workspaceMenuOpen ? (
        <div className="workspace-menu" role="menu">
          <button role="menuitem"><Buildings /><span>Workspace overview</span></button>
          <button role="menuitem"><UserPlus /><span>Invite teammate</span></button>
          <button role="menuitem"><Gear /><span>Workspace settings</span></button>
          <div />
          <button role="menuitem"><FolderPlus /><span>Create project</span></button>
          <button role="menuitem"><CheckSquare /><span>Create task</span></button>
          <button role="menuitem"><CalendarPlus /><span>Schedule meeting</span></button>
          <button role="menuitem"><Plugs /><span>Apps & integrations</span></button>
          <div />
          <button role="menuitem"><Bell /><span>Notification settings</span></button>
          <button role="menuitem"><ShieldCheck /><span>Privacy & security</span></button>
          <button role="menuitem"><UserCircleGear /><span>Edit workplace profile</span></button>
          <label><UsersThree /><span>Hide inactive projects</span><input type="checkbox" checked={hideInactive} onChange={event => setHideInactive(event.target.checked)} /></label>
          <div />
          <button role="menuitem"><Copy /><span>Copy workspace ID</span></button>
        </div>
      ) : null}
      <button className="event-card">
        <span className="event-icon"><Broadcast /></span>
        <span><strong>Weekly team sync</strong><small>Today at 3 PM · 18 attending</small></span>
      </button>
      <nav className="channel-nav">
        {channels.map(group => (
          <section key={group.section}>
            <div className="section-label"><span><CaretDown /> {group.section}</span><Plus /></div>
            {group.items.map(item => (
              <button key={item} className={`channel-row ${activeChannel === item ? "active" : ""}`} onClick={() => onChannelChange(item)}>
                {item === "announcements" ? <Megaphone /> : item === "rules-and-roles" ? <ShieldCheck /> : <Hash />}
                <span>{item}</span>{item === "announcements" ? <b>2</b> : null}
              </button>
            ))}
          </section>
        ))}
        <section>
          <div className="section-label"><span><CaretDown /> VOICE DECKS</span><Plus /></div>
          <button className="channel-row"><SpeakerHigh /><span>Ready room</span></button>
          <div className="voice-user"><Avatar initials="RK" color="cyan" size="sm" /><span>Rook</span><SpeakerHigh /></div>
          <div className="voice-user"><Avatar initials="MO" color="violet" size="sm" /><span>Moxie</span></div>
          <button className="channel-row"><SpeakerHigh /><span>Afterburner</span><Lock /></button>
        </section>
      </nav>
    </aside>
  );
}
