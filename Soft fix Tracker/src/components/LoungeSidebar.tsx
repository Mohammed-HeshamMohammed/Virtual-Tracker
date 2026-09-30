import { Bell, CalendarDots, ChatCircleDots, EnvelopeSimple, MagnifyingGlass, Plus, PushPin, UsersThree } from "@phosphor-icons/react";
import { Avatar } from "./Avatar";

const conversations = [
  { initials: "SA", name: "Sara Ahmed", status: "Design handoff", color: "violet", pinned: true },
  { initials: "YK", name: "Youssef Khaled", status: "Reviewing pull requests", color: "cyan", pinned: true },
  { initials: "MN", name: "Mariam Nabil", status: "Available", color: "gold" },
  { initials: "OA", name: "Omar Adel", status: "In a work room", color: "green" },
  { initials: "NH", name: "Nour Hany", status: "Focus mode", color: "blue" },
  { initials: "AT", name: "Ahmed Tarek", status: "Away · 8m", color: "orange" }
];

export function LoungeSidebar() {
  return (
    <aside className="lounge-sidebar">
      <button className="lounge-find"><MagnifyingGlass /><span>Find or start a conversation</span></button>
      <nav className="lounge-nav" aria-label="Lounge navigation">
        <button className="active"><UsersThree /><span>Coworkers</span></button>
        <button><EnvelopeSimple /><span>Message requests</span><b>3</b></button>
        <button><CalendarDots /><span>Lounge events</span></button>
        <button><Bell /><span>Mentions</span></button>
      </nav>
      <div className="conversation-heading"><span>DIRECT CONVERSATIONS</span><button title="Start a conversation"><Plus /></button></div>
      <div className="conversation-list">
        {conversations.map(person => (
          <button className="conversation-row" key={person.name}>
            <Avatar initials={person.initials} color={person.color} />
            <span><strong>{person.name}</strong><small>{person.status}</small></span>
            {person.pinned ? <PushPin weight="fill" /> : <ChatCircleDots />}
          </button>
        ))}
      </div>
    </aside>
  );
}
