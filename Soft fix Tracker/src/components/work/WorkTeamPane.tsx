import { UsersThree } from "@phosphor-icons/react";
import { Avatar } from "../Avatar";
import { teammates } from "../../data/work";

/** Who else is tracking right now - the Work-mode counterpart to CrewSidebar. */
export function WorkTeamPane() {
  const trackingCount = teammates.filter(person => person.tracking).length;
  return (
    <aside className="crew-sidebar work-team">
      <header><strong>Your team</strong><span>{trackingCount} TRACKING NOW</span></header>
      <div className="crew-content">
        <section>
          <div className="crew-section-title">TEAM — {teammates.length}</div>
          {teammates.map(person => (
            <div className="crew-row" key={person.name}>
              <Avatar initials={person.initials} color={person.color} />
              <span><strong>{person.name}</strong><small>{person.status}</small></span>
              {person.tracking ? <i className="work-tracking-dot" /> : null}
            </div>
          ))}
        </section>
      </div>
      <footer><span><UsersThree /> {teammates.length} on this workspace</span></footer>
    </aside>
  );
}
