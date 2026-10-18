import { Prohibit } from "@phosphor-icons/react";
import { useWorkspace, type Member } from "../workspace";
import { Avatar } from "./Avatar";
import type { LoungeRoom } from "./lounge-model";

/** The member list beside a channel, grouped Online / Offline like Discord's. */
export function CrewSidebar({ room, onMessage }: { room: LoungeRoom; onMessage: (id: string) => void }) {
  const { members, profile, preferences } = useWorkspace();
  const people = members
    .filter((member) => member.id === "me" || room.members.includes(member.id))
    .map((member) => {
      const self = member.id === "me";
      const status = self ? (preferences.activityVisible ? profile.status : "Offline") : member.status;
      return { ...member, self, status, name: self ? profile.name : member.name };
    });
  const groups = [
    { title: "Online", people: people.filter((person) => person.status !== "Offline") },
    { title: "Offline", people: people.filter((person) => person.status === "Offline") },
  ];
  return (
    <aside className="lg-context-pane lg-member-list" aria-label="Members">
      <h2 className="lg-member-group">Channel members — {people.length}</h2>
      {groups
        .filter((group) => group.people.length)
        .map((group) => (
          <section key={group.title}>
            <h2 className="lg-member-group">
              {group.title} — {group.people.length}
            </h2>
            {group.people.map((person) => (
              <button
                key={person.id}
                className={`lg-member-row ${person.status === "Offline" ? "offline" : ""}`}
                disabled={person.self}
                aria-label={person.self ? `${person.name}, you` : `Message ${person.name}`}
                onClick={() => onMessage(person.id)}
              >
                <span className="lg-avatar-status">
                  <Avatar memberId={person.id} initials={person.initials} color={person.color} />
                  <i className={`lg-status-dot ${person.status.toLowerCase()}`} />
                </span>
                <span>
                  <strong className={`lg-role-${person.role.toLowerCase()}`}>{person.name}</strong>
                  <small>{person.team}</small>
                </span>
              </button>
            ))}
          </section>
        ))}
    </aside>
  );
}

const presence = (status: string) =>
  status === "Available" ? "Online" : status === "Focusing" ? "Do Not Disturb" : status === "Away" ? "Idle" : "Offline";

/** The profile card shown beside a direct message. */
export function ProfilePanel({
  person,
  blocked,
  onBlock,
}: {
  person: Member;
  blocked: boolean;
  onBlock: () => void;
}) {
  return (
    <aside className="lg-context-pane lg-profile-pane" aria-label={`${person.name}'s profile`}>
      <div className={`lg-profile-banner avatar-${person.color}`} />
      <span className="lg-avatar-status lg-profile-avatar">
        <Avatar memberId={person.id} initials={person.initials} color={person.color} size="lg" />
        <i className={`lg-status-dot ${person.status.toLowerCase()}`} />
      </span>
      <div className="lg-profile-body">
        <h2>{person.name}</h2>
        <p className="lg-profile-handle">
          {person.email.split("@")[0]} · {presence(person.status)}
        </p>
        <section>
          <h3>Role</h3>
          <p className={`lg-role-${person.role.toLowerCase()}`}>{person.role}</p>
        </section>
        <section>
          <h3>Team</h3>
          <p>{person.team}</p>
        </section>
        <section>
          <h3>Email</h3>
          <p>{person.email}</p>
        </section>
        <button className="sf-button" onClick={onBlock}>
          <Prohibit />
          {blocked ? "Unblock" : "Block"}
        </button>
      </div>
    </aside>
  );
}
