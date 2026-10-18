import { useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowUpRight,
  EnvelopeSimple,
  List,
  Plus,
  TreeStructure,
  UsersThree,
  PencilSimple,
  ShieldCheck,
  SquaresFour,
} from "@phosphor-icons/react";
import {
  useWorkspace,
  formatDuration,
  type Member,
  type Session,
} from "../../workspace";
import { EmptyState, Modal, SearchField } from "../ui";
import { Avatar, Badge, FilterSelect, PageHeading } from "./DashboardParts";
const roleNames = ["Owner", "Admin", "Manager", "Member", "Client"];
const tier = (role: string) =>
  ({ Owner: 0, Admin: 1, Manager: 2, Member: 3, Client: 3 })[role] ?? 3;
export function PeoplePage({
  sessions,
  canManage,
  initialView = "directory",
}: {
  sessions: Session[];
  canManage: boolean;
  initialView?: "directory" | "hierarchy";
}) {
  const { members, setMembers, profile, setProfile, notify, navigate } =
    useWorkspace();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [view, setView] = useState<string>(initialView);
  const [detail, setDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "Member",
    team: "Design",
    managerId: "",
  });
  const [error, setError] = useState("");
  const filtered = members.filter(
    (member) =>
      `${member.name} ${member.email} ${member.team}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (roleFilter === "all" || member.role === roleFilter),
  );
  const active = members.find((member) => member.id === detail);
  const timeFor = (id: string) =>
    sessions.filter((session) => session.memberId === id).reduce((sum, session) => sum + session.seconds, 0);
  const longest = Math.max(...filtered.map((member) => timeFor(member.id)), 1);
  const canEditPerson = (person: Member) =>
    canManage &&
    (profile.role !== "Manager" || tier(person.role) > tier("Manager"));
  const allowedParents = members.filter(
    (member) =>
      member.id !== editing &&
      (form.role === "Member"
        ? member.role === "Manager"
        : form.role === "Client"
          ? ["Owner", "Admin"].includes(member.role)
          : tier(member.role) < tier(form.role)),
  );
  const openForm = (member?: Member) => {
    setEditing(member?.id || null);
    setForm({
      name: member?.name || "",
      email: member?.email || "",
      role: member?.role || "Member",
      team: member?.team || "Design",
      managerId: member?.managerId || "",
    });
    setError("");
    setDetail(null);
    setFormOpen(true);
  };
  const savePerson = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("Enter this person’s full name.");
      return;
    }
    const original = members.find((member) => member.id === editing);
    if (
      original &&
      original.role !== form.role &&
      members.some(
        (member) =>
          member.managerId === editing &&
          (member.role === "Member"
            ? form.role !== "Manager"
            : member.role === "Client"
              ? !["Owner", "Admin"].includes(form.role)
              : tier(form.role) >= tier(member.role)),
      )
    ) {
      setError(
        "Reassign this person’s direct reports before changing to that role.",
      );
      return;
    }
    if (
      original?.role === "Owner" &&
      form.role !== "Owner" &&
      members.filter((member) => member.role === "Owner").length === 1
    ) {
      setError(
        "Your workspace needs at least one owner. Add another owner before changing this role.",
      );
      return;
    }
    if (
      form.role !== "Owner" &&
      form.managerId &&
      !allowedParents.some((member) => member.id === form.managerId)
    ) {
      setError("Choose a reporting lead compatible with this role.");
      return;
    }
    if (
      members.some(
        (member) =>
          member.id !== editing &&
          member.email.toLowerCase() === form.email.trim().toLowerCase(),
      )
    ) {
      setError("A person with this email already belongs to the workspace.");
      return;
    }
    const id = editing || crypto.randomUUID();
    const next = {
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      team: form.team.trim() || "General",
      initials: form.name
        .trim()
        .split(" ")
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      managerId:
        form.role === "Owner" ? undefined : form.managerId || undefined,
    };
    setMembers((previous) =>
      editing
        ? previous.map((member) =>
            member.id === editing ? { ...member, ...next } : member,
          )
        : [...previous, { id, ...next, color: "blue", status: "Offline" }],
    );
    if (editing === "me")
      setProfile((previous) => ({
        ...previous,
        name: next.name,
        email: next.email,
      }));
    setFormOpen(false);
    setDetail(id);
    notify(
      editing
        ? "Person updated across the workspace."
        : "Person added to your local workspace.",
    );
  };
  const tree = (member: Member, depth = 0): ReactNode => {
    if (depth > members.length) return null;
    const children = members.filter((person) => person.managerId === member.id);
    const isMatch = filtered.some((person) => person.id === member.id);
    const hasMatch = (person: Member, seen: string[] = []): boolean =>
      !seen.includes(person.id) &&
      (filtered.some((entry) => entry.id === person.id) ||
        members
          .filter((child) => child.managerId === person.id)
          .some((child) => hasMatch(child, [...seen, person.id])));
    if (!isMatch && !children.some((child) => hasMatch(child))) return null;
    return (
      <div className="db-tree-branch" key={member.id}>
        <button className="db-tree-person" onClick={() => setDetail(member.id)}>
          <Avatar memberId={member.id} name={member.name} color={member.color} />
          <div>
            <strong>{member.name}</strong>
            <small>
              {member.team}
              {member.role === "Member" ? " · Worker" : ""}
            </small>
          </div>
          <Badge text={member.role} />
          <ArrowUpRight size={15} />
        </button>
        {children.length > 0 && (
          <div className="db-tree-children">
            {children.map((child) => tree(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="sf-page db-page">
      <PageHeading
        eyebrow="THE PEOPLE BEHIND THE PROGRESS"
        title="People"
        description="A connected team, with a clear place for everyone."
      >
        {canManage && (
          <button className="sf-button primary" onClick={() => openForm()}>
            <Plus size={17} />
            Add person
          </button>
        )}
      </PageHeading>
      <div className="db-people-stats">
        {[
          {
            label: "Team members",
            value: members.filter((member) => member.role !== "Client").length,
            icon: UsersThree,
          },
          {
            label: "Owners & admins",
            value: members.filter((member) =>
              ["Owner", "Admin"].includes(member.role),
            ).length,
            icon: ShieldCheck,
          },
          {
            label: "Managers",
            value: members.filter((member) => member.role === "Manager").length,
            icon: TreeStructure,
          },
          {
            label: "Client partners",
            value: members.filter((member) => member.role === "Client").length,
            icon: EnvelopeSimple,
          },
        ].map((stat) => (
          <div className="sf-card" key={stat.label}>
            <stat.icon size={20} />
            <strong>{stat.value.toString().padStart(2, "0")}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
      <section className="sf-card">
        <div className="db-filter-row">
          <FilterSelect
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "directory", text: "Directory" },
              { value: "cards", text: "Cards" },
              { value: "hierarchy", text: "Team structure" },
            ]}
          />
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search your people"
          />
          <select
            className="db-select"
            aria-label="Filter people by role"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
          >
            <option value="all">All roles</option>
            {roleNames.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </div>
        {view === "cards" ? (
          <div className="db-people-cards">
            {filtered.map((member) => {
              const seconds = timeFor(member.id);
              return (
                <button className="db-person-card" key={member.id} onClick={() => setDetail(member.id)}>
                  <Avatar memberId={member.id} name={member.name} color={member.color} />
                  <strong>
                    {member.name}
                    {member.id === "me" && <span className="db-you">you</span>}
                  </strong>
                  <small>{member.email}</small>
                  <div className="db-person-card-meta">
                    <Badge text={member.role} />
                    <span className="db-presence">
                      <i className={member.status.toLowerCase()} />
                      {member.status}
                    </span>
                  </div>
                  <div className="db-person-card-time">
                    <span>{member.team}</span>
                    <strong>{formatDuration(seconds)}</strong>
                  </div>
                  <div className="db-progress">
                    <span style={{ width: `${(seconds / longest) * 100}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        ) : view === "directory" ? (
          <div className="db-table-scroll">
            <table className="sf-table db-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Team</th>
                  <th>Reports to</th>
                  <th>Status</th>
                  <th>
                    <span className="db-sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className="db-person-cell">
                        <Avatar memberId={member.id} name={member.name} color={member.color} />
                        <div>
                          <strong>
                            {member.name}
                            {member.id === "me" && (
                              <span className="db-you">you</span>
                            )}
                          </strong>
                          <small>{member.email}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge text={member.role} />
                    </td>
                    <td>{member.team}</td>
                    <td>
                      {member.role === "Owner"
                        ? "Workspace owner"
                        : members.find(
                            (person) => person.id === member.managerId,
                          )?.name || "Unassigned"}
                    </td>
                    <td>
                      <span className="db-presence">
                        <i className={member.status.toLowerCase()} />
                        {member.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="sf-icon-button"
                        aria-label={`View ${member.name}`}
                        onClick={() => setDetail(member.id)}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="db-hierarchy">
            <div className="db-hierarchy-guide">
              <ShieldCheck size={18} />
              <span>
                Owners <b>›</b> Admins <b>›</b> Managers <b>›</b> Workers
              </span>
              <small>
                Client partners stay connected to their owner or admin.
              </small>
            </div>
            {members
              .filter(
                (member) =>
                  member.role === "Owner" ||
                  !member.managerId ||
                  !members.some((person) => person.id === member.managerId),
              )
              .map((member) => (
                <div key={member.id}>
                  {member.role !== "Owner" && !member.managerId && (
                    <span className="db-unassigned-label">
                      Unassigned · choose a reporting lead in the person's
                      profile
                    </span>
                  )}
                  {tree(member)}
                </div>
              ))}
          </div>
        )}
        {!filtered.length && (
          <EmptyState
            title="No people found"
            description="Try a name, email, team, or another role."
            action="Clear filters"
            onAction={() => {
              setQuery("");
              setRoleFilter("all");
            }}
          />
        )}
        <div className="db-table-footer">
          <span>{filtered.length} people</span>
          <span>Presence and tracked time are shown separately</span>
        </div>
      </section>
      {formOpen && (
        <Modal
          title={editing ? "Edit person" : "Add a person"}
          description="Keep your workspace directory and team structure up to date."
          onClose={() => setFormOpen(false)}
        >
          <form onSubmit={savePerson}>
            <div className="db-form-grid">
              <label className="db-field">
                Full name
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <label className="db-field">
                Email address
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="db-form-grid">
              <label className="db-field">
                Workspace role
                <select
                  value={form.role}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      role: event.target.value,
                      managerId: "",
                    })
                  }
                >
                  {roleNames
                    .filter(
                      (role) =>
                        profile.role !== "Manager" ||
                        ["Member", "Client"].includes(role) ||
                        role === form.role,
                    )
                    .map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                </select>
              </label>
              <label className="db-field">
                Team
                <input
                  required
                  maxLength={60}
                  value={form.team}
                  onChange={(event) =>
                    setForm({ ...form, team: event.target.value })
                  }
                />
              </label>
            </div>
            {form.role !== "Owner" && (
              <label className="db-field">
                {form.role === "Member" ? "Assigned manager" : "Reports to"}
                <select
                  value={form.managerId}
                  onChange={(event) =>
                    setForm({ ...form, managerId: event.target.value })
                  }
                >
                  <option value="">Unassigned</option>
                  {allowedParents.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} · {member.role}
                    </option>
                  ))}
                </select>
                <small>
                  Choose an explicit reporting lead. Unassigned people remain
                  visible.
                </small>
              </label>
            )}
            {error && (
              <p className="db-form-error" role="alert">
                {error}
              </p>
            )}
            <p className="db-form-hint">
              This updates the local directory. No invitation email is sent.
            </p>
            <div className="db-modal-actions">
              <button
                className="sf-button"
                type="button"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </button>
              <button className="sf-button primary" type="submit">
                {editing ? "Save person" : "Add to workspace"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {active && (
        <Modal
          title={active.name}
          description={`${active.role} · ${active.team}`}
          onClose={() => setDetail(null)}
        >
          <div className="db-profile-summary">
            <Avatar name={active.name} color={active.color} />
            <div>
              <strong>{active.name}</strong>
              <p>{active.email}</p>
            </div>
            <Badge text={active.status} />
          </div>
          <div className="db-detail-row">
            <span>Reports to</span>
            <strong>
              {active.role === "Owner"
                ? "Workspace owner"
                : members.find((member) => member.id === active.managerId)
                    ?.name || "Unassigned"}
            </strong>
          </div>
          <div className="db-detail-row">
            <span>Tracked time</span>
            <strong>
              {formatDuration(
                sessions
                  .filter((session) => session.memberId === active.id)
                  .reduce((sum, session) => sum + session.seconds, 0),
              )}
            </strong>
          </div>
          <div className="db-detail-row">
            <span>Direct reports</span>
            <strong>
              {
                members.filter((member) => member.managerId === active.id)
                  .length
              }
            </strong>
          </div>
          <div className="db-modal-actions">
            {canEditPerson(active) && (
              <button className="sf-button" onClick={() => openForm(active)}>
                <PencilSimple size={17} />
                Edit person
              </button>
            )}
            <button
              className="sf-button primary"
              onClick={() => {
                setDetail(null);
                if (active.id === "me") navigate("dashboard", "settings");
                else navigate("lounge", "messages", active.id);
              }}
            >
              {active.id === "me" ? "My profile" : "Open conversation"}
              <ArrowUpRight size={17} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
