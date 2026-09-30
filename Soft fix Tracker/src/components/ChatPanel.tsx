import { FormEvent, useState } from "react";
import { Bell, BookmarkSimple, CalendarCheck, ChatCircle, Clock, Confetti, Gif, Gift, Hash, Heart, MagnifyingGlass, PaperPlaneTilt, Plus, PushPin, Robot, RocketLaunch, Shapes, Smiley, Star, Sticker, Tray, Trophy, UsersThree, VideoCamera } from "@phosphor-icons/react";
import { Avatar } from "./Avatar";

type Message = { name: string; initials: string; color: string; role?: string; time: string; body: string };
type ComposerPanel = "gifs" | "stickers" | "emoji" | "apps" | null;

const starterMessages: Message[] = [
  { name: "Rook", initials: "RK", color: "cyan", role: "SCOUT", time: "9:41 AM", body: "Morning, pilots. The Meridian relay just rotated into range. Anyone up for a clean survey run before reset?" },
  { name: "Moxie", initials: "MO", color: "violet", role: "MOD", time: "9:43 AM", body: "@Rook perfect timing — I have the mission card from last night's route planning." }
];

const reactionIcons = [Smiley, RocketLaunch, Heart, Star, Trophy, Confetti];

function MediaPanel({ mode, onChange }: { mode: Exclude<ComposerPanel, "apps" | null>; onChange: (mode: Exclude<ComposerPanel, "apps" | null>) => void }) {
  return (
    <section className="media-panel" aria-label="Message media picker">
      <div className="media-tabs">
        <button className={mode === "gifs" ? "active" : ""} onClick={() => onChange("gifs")}>GIFs</button>
        <button className={mode === "stickers" ? "active" : ""} onClick={() => onChange("stickers")}>Stickers</button>
        <button className={mode === "emoji" ? "active" : ""} onClick={() => onChange("emoji")}>Emoji</button>
      </div>
      <label className="media-search"><MagnifyingGlass /><input placeholder={`Search ${mode}`} /></label>
      {mode === "gifs" ? (
        <div className="gif-grid">
          {["Meridian signal", "Relay reaction", "Clean run", "Mission ready"].map((label, index) => <button key={label}><img src="/assets/echoes-beyond-meridian.png" alt="" style={{ objectPosition: `${index * 24}% center` }} /><span>{label}</span></button>)}
        </div>
      ) : (
        <div className="reaction-grid">
          {reactionIcons.map((Icon, index) => <button key={index} title={mode === "stickers" ? "Send sticker" : "Insert reaction"}><Icon weight={mode === "stickers" ? "duotone" : "fill"} /></button>)}
        </div>
      )}
    </section>
  );
}

function AppsPanel() {
  const apps = [
    { name: "Standup Assistant", detail: "Collect updates and create a clean summary.", icon: Robot },
    { name: "Focus Session", detail: "Start a shared timer for the room.", icon: Clock },
    { name: "Meeting Room", detail: "Create a secure video session.", icon: VideoCamera },
    { name: "Team Calendar", detail: "Find a time that works for the crew.", icon: CalendarCheck },
  ];
  return (
    <section className="apps-panel" aria-label="Apps and commands">
      <label className="media-search"><MagnifyingGlass /><input placeholder="Search apps & commands" /></label>
      <div className="apps-heading"><strong>Recents</strong><button>View all</button></div>
      <div className="recent-apps">{apps.map(({ name, icon: Icon }) => <button key={name} title={name}><Icon weight="duotone" /></button>)}</div>
      <div className="apps-heading"><strong>Apps in this workplace</strong></div>
      <div className="apps-list">{apps.map(({ name, detail, icon: Icon }) => <button key={name}><span><Icon weight="duotone" /></span><span><strong>{name}</strong><small>{detail}</small></span></button>)}</div>
      <div className="apps-heading"><strong>Promoted for your team</strong></div>
      <button className="promoted-app"><img src="/assets/echoes-beyond-meridian.png" alt="Meridian mission artwork" /><span><strong>Mission Planner</strong><small>Plan a route together without leaving chat.</small></span></button>
    </section>
  );
}

export function ChatPanel({ channel }: { channel: string }) {
  const [joined, setJoined] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [composerPanel, setComposerPanel] = useState<ComposerPanel>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    setMessages([...messages, { name: "aria.exe", initials: "AR", color: "violet", role: "PILOT", time: "NOW", body: draft.trim() }]);
    setDraft("");
  };
  return (
    <main className="chat-panel">
      <header className="chat-header">
        <div className="channel-title"><Hash /><span><strong>{channel}</strong><small>Crew chat, field notes, and everything in between.</small></span></div>
        <div className="header-tools">
          <button title="Threads"><ChatCircle /></button><button title="Notifications"><Bell /></button><button title="Pinned"><PushPin /></button>
          <label className="search"><MagnifyingGlass /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search Nova Vanguard" /><kbd>⌘ K</kbd></label>
          <button title="Inbox"><Tray /></button><button title="Crew"><UsersThree /></button>
        </div>
      </header>
      <div className="message-scroller">
        <section className="channel-welcome">
          <span><Hash /></span><div><h1>Welcome to #{channel}</h1><p>This is the start of the channel. Be curious, be generous, and keep the signal clear.</p></div>
        </section>
        <div className="date-rule"><span>TODAY · SEPTEMBER 28</span></div>
        {messages.map((message, index) => (
          <article className="message" key={`${message.name}-${index}`}>
            <Avatar initials={message.initials} color={message.color} />
            <div><div className="message-meta"><strong>{message.name}</strong>{message.role ? <em>{message.role}</em> : null}<time>{message.time}</time></div><p>{message.body}</p>
            {index === 1 ? (
              <>
                <div className="mission-card">
                  <img src="/assets/echoes-beyond-meridian.png" alt="Fractured Meridian relay above an alien planet" />
                  <div className="mission-copy">
                    <div className="mission-kicker"><span>◉ MISSION BRIEF</span><b>CO-OP · 4</b></div>
                    <h2>Echoes beyond Meridian</h2>
                    <p>Survey the fractured relay, recover three signal cores, and make it back before the ion storm closes in.</p>
                    <div className="mission-facts"><span>♧ Elite</span><span><Clock /> 35–45 min</span></div>
                    <button className={joined ? "joined" : ""} onClick={() => setJoined(!joined)}>{joined ? "Squad joined" : "Join squad"}</button>
                    <button className="bookmark" title="Save mission"><BookmarkSimple /></button>
                  </div>
                </div>
                <div className="reactions"><button>🚀 6</button><button>🫡 3</button><button>✨ 2</button></div>
              </>
            ) : null}</div>
          </article>
        ))}
        <article className="message"><Avatar initials="JX" color="orange" /><div><div className="message-meta"><strong>Jax</strong><em>NAV</em><time>9:47 AM</time></div><p>Count me in. I can bring the phase scanner and cover the west arc. Two slots left.</p></div></article>
        <article className="message"><Avatar initials="LY" color="green" /><div><div className="message-meta"><strong>Lyra</strong><time>9:49 AM</time></div><p>Joining after this queue. Save me the comms seat?</p><div className="reactions"><button>✅ 4</button></div></div></article>
      </div>
      <footer className="composer-wrap">
        <small>✣ Pro tip: type / to browse crew commands</small>
        {composerPanel && composerPanel !== "apps" ? <MediaPanel mode={composerPanel} onChange={setComposerPanel} /> : null}
        {composerPanel === "apps" ? <AppsPanel /> : null}
        <form className="composer" onSubmit={submit}>
          <button type="button" title="Add"><Plus /></button><input value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Message #${channel}`} />
          <button type="button" title="Gift"><Gift /></button>
          <button type="button" className={composerPanel === "gifs" ? "active" : ""} aria-expanded={composerPanel === "gifs"} title="GIFs" onClick={() => setComposerPanel(composerPanel === "gifs" ? null : "gifs")}><Gif /></button>
          <button type="button" className={composerPanel === "stickers" ? "active" : ""} aria-expanded={composerPanel === "stickers"} title="Stickers" onClick={() => setComposerPanel(composerPanel === "stickers" ? null : "stickers")}><Sticker /></button>
          <button type="button" className={composerPanel === "emoji" ? "active" : ""} aria-expanded={composerPanel === "emoji"} title="Emoji" onClick={() => setComposerPanel(composerPanel === "emoji" ? null : "emoji")}><Smiley /></button>
          <button type="button" className={composerPanel === "apps" ? "active" : ""} aria-expanded={composerPanel === "apps"} title="Apps & commands" onClick={() => setComposerPanel(composerPanel === "apps" ? null : "apps")}><Shapes /></button>
          <button className="send" title="Send"><PaperPlaneTilt weight="fill" /></button>
        </form>
      </footer>
    </main>
  );
}
