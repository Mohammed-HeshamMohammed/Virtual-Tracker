import { useMemo, useState } from "react";
import { BracketsCurly, ChatCircleDots, CheckCircle, DotsThreeVertical, MagnifyingGlass, PaintBrush, Plus, UserPlus, UsersThree, VideoCamera } from "@phosphor-icons/react";
import { Avatar } from "./Avatar";

type LoungeTab = "online" | "everyone" | "requests";

const people = [
  { initials: "SA", name: "Sara Ahmed", role: "Product designer", activity: "Reviewing Lounge navigation", color: "violet", online: true },
  { initials: "YK", name: "Youssef Khaled", role: "Frontend engineer", activity: "Working in Soft Fix Tracker", color: "cyan", online: true },
  { initials: "MN", name: "Mariam Nabil", role: "Project manager", activity: "Available to talk", color: "gold", online: true },
  { initials: "OA", name: "Omar Adel", role: "Backend engineer", activity: "In Product sync · 24m", color: "green", online: true },
  { initials: "NH", name: "Nour Hany", role: "QA engineer", activity: "Testing the employee build", color: "blue", online: true },
  { initials: "AT", name: "Ahmed Tarek", role: "Support specialist", activity: "Away · 8m", color: "orange", online: false },
  { initials: "LR", name: "Laila Reda", role: "Operations", activity: "Offline", color: "slate", online: false }
];

const activities = [
  { icon: <VideoCamera />, title: "Product sync", detail: "4 teammates in Work Room", names: "Mariam, Omar, Sara +1", tone: "violet" },
  { icon: <BracketsCurly />, title: "Pairing session", detail: "Authentication flow · 36m", names: "Youssef and Ahmed", tone: "cyan" },
  { icon: <PaintBrush />, title: "Design review", detail: "Soft Fix Lounge UI", names: "Sara, Nour +2", tone: "gold" }
];

export function LoungeHome() {
  const [tab, setTab] = useState<LoungeTab>("online");
  const [query, setQuery] = useState("");
  const visiblePeople = useMemo(() => people.filter(person => {
    if (tab === "online" && !person.online) return false;
    return `${person.name} ${person.role} ${person.activity}`.toLowerCase().includes(query.toLowerCase());
  }), [tab, query]);

  return (
    <main className="lounge-home">
      <header className="lounge-header">
        <span className="lounge-title"><UsersThree weight="fill" /><strong>Lounge</strong></span>
        <span className="lounge-header-rule" />
        <div className="lounge-tabs">
          <button className={tab === "online" ? "active" : ""} onClick={() => setTab("online")}>Online</button>
          <button className={tab === "everyone" ? "active" : ""} onClick={() => setTab("everyone")}>Everyone</button>
          <button className={tab === "requests" ? "active" : ""} onClick={() => setTab("requests")}>Requests <b>3</b></button>
        </div>
        <button className="invite-button"><UserPlus /><span>Invite teammate</span></button>
      </header>

      <section className="people-pane">
        {tab === "requests" ? (
          <div className="requests-state">
            <span><UserPlus /></span><h2>3 connection requests</h2><p>Review requests from employees in your Soft Fix workplace.</p>
            {people.slice(4, 7).map(person => <button key={person.name}><Avatar initials={person.initials} color={person.color} /><span><strong>{person.name}</strong><small>{person.role}</small></span><b>Review</b></button>)}
          </div>
        ) : (
          <>
            <label className="people-search"><MagnifyingGlass /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search coworkers" /><kbd>Ctrl K</kbd></label>
            <div className="people-heading">{tab === "online" ? "ONLINE" : "ALL COWORKERS"} — {visiblePeople.length}</div>
            <div className="people-list">
              {visiblePeople.map(person => (
                <article className={`person-row ${person.online ? "" : "is-offline"}`} key={person.name}>
                  <Avatar initials={person.initials} color={person.color} />
                  <span className="person-copy"><strong>{person.name}</strong><small>{person.role} · {person.activity}</small></span>
                  {person.online ? <CheckCircle className="available-mark" weight="fill" /> : null}
                  <button title={`Message ${person.name}`}><ChatCircleDots weight="fill" /></button>
                  <button title="More options"><DotsThreeVertical weight="bold" /></button>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <aside className="active-pane">
        <div className="active-pane-heading"><div><strong>Active now</strong><small>Work together without leaving Soft Fix</small></div><button title="Start activity"><Plus /></button></div>
        <div className="active-cards">
          {activities.map(activity => (
            <button className="active-card" key={activity.title}>
              <span className={`active-icon ${activity.tone}`}>{activity.icon}</span>
              <span><strong>{activity.title}</strong><small>{activity.detail}</small></span>
              <span className="activity-people">{activity.names}</span>
            </button>
          ))}
        </div>
        <div className="active-empty"><ChatCircleDots /><strong>Start something together</strong><small>Open a voice room, share a screen, or message a teammate.</small><button>Open Lounge room</button></div>
      </aside>
    </main>
  );
}
