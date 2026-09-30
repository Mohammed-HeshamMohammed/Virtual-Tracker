import { SlidersHorizontal, SpeakerHigh, UserPlus } from "@phosphor-icons/react";
import { crew } from "../data/community";
import { Avatar } from "./Avatar";

function CrewRow({ member }: { member: (typeof crew)[number] }) {
  return <div className="crew-row"><Avatar initials={member.initials} color={member.color} /><span><strong>{member.name} {member.role ? <em>{member.role}</em> : null}</strong><small>{member.status}</small></span>{member.voice ? <SpeakerHigh /> : null}</div>;
}

export function CrewSidebar() {
  return (
    <aside className="crew-sidebar">
      <header><strong>Crew roster</strong><span>24 ONLINE</span><button title="Invite"><UserPlus /></button></header>
      <div className="crew-content">
        <section><div className="crew-section-title live">● LIVE NOW <span>2 activities</span></div><button className="live-card"><span>🎮</span><span><strong>Ready room</strong><small>4 pilots · joinable</small></span><b>↗</b></button></section>
        <section><div className="crew-section-title">COMMAND — 3</div>{crew.slice(0,3).map(m => <CrewRow key={m.name} member={m} />)}</section>
        <section><div className="crew-section-title">PILOTS — 21</div>{crew.slice(3).map(m => <CrewRow key={m.name} member={m} />)}</section>
        <section className="offline"><div className="crew-section-title">DRIFTING OFFLINE — 186</div>{[
          ["Atlas","AT","Last seen 3h ago"],["Euclid","EU","Last seen yesterday"],["Mira","MI","Last seen 2d ago"]
        ].map(([name, initials, status]) => <CrewRow key={name} member={{ name, initials, status, color: "slate" }} />)}</section>
      </div>
      <footer><span>♢ COMMUNITY HEALTHY</span><SlidersHorizontal /></footer>
    </aside>
  );
}
