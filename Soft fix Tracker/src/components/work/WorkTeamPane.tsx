import { ArrowUpRight, ChatCircle, UsersThree } from "@phosphor-icons/react";
import { useWorkspace } from "../../workspace";

export function WorkTeamPane({ onMessage }: { onMessage: (name?: string) => void }) {
  const { members } = useWorkspace();
  const teammates = members.filter(member => member.id !== "me");
  return (
    <section className="sf-card wk-team-card">
      <div className="wk-card-heading"><div><span className="wk-eyebrow">BETTER TOGETHER</span><h2>Your team today</h2></div><span className="sf-badge"><span className="wk-green-dot" /> {teammates.filter(person => person.status === "Focusing" || person.status === "Available").length} online</span></div>
      <div className="wk-team-list">{teammates.slice(0, 4).map(person => <div className="wk-person" key={person.id}><span className={`wk-avatar ${person.color}`}>{person.initials}<i className={person.status === "Focusing" || person.status === "Available" ? "online" : "away"} /></span><div><strong>{person.name}</strong><small>{person.status} · {person.team}</small></div><button className="wk-icon-button" onClick={() => onMessage(person.name)} aria-label={`Message ${person.name}`} title={`Message ${person.name}`}><ChatCircle size={18} /></button></div>)}</div>
      <button className="wk-text-button wk-team-link" onClick={() => onMessage()}><UsersThree size={18} /> Meet in the Lounge <ArrowUpRight size={16} /></button>
    </section>
  );
}
