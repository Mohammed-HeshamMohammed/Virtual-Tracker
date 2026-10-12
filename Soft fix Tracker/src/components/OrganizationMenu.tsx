import { useState, type FormEvent } from "react";
import { ChevronsUpDown, Plus, Settings } from "lucide-react";
import { peekOrg, useOrganizations } from "../organizations";
import { useWorkspace } from "../workspace";
import { MenuButton, type MenuEntry } from "./MenuButton";
import { Modal } from "./ui";
import "./organization.css";

export const orgInitial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
const people = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

/** The organization switcher. A person can belong to several organizations, and each is a workspace of
 *  its own (projects, tasks, people, time, messages), so this shows the one that is open and lists the
 *  others. In the Dashboard it sits at the bottom of the sidebar; in Work it is the sidebar's label. */
export function OrganizationMenu({ variant, onOpenSettings }: { variant: "sidebar" | "work"; onOpenSettings: () => void }) {
  const { orgs, active, switchTo } = useOrganizations();
  const { profile, members } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const about = (id: string) => (id === active.id ? { role: profile.role, people: members.length } : peekOrg(id));

  const entries: MenuEntry[] = [
    { kind: "heading", label: "Your organizations" },
    ...orgs.map((org): MenuEntry => {
      const info = about(org.id);
      return { kind: "item", id: org.id, label: org.name, detail: `${info.role} · ${people(info.people)}`, icon: <span className="org-mark small">{orgInitial(org.name)}</span>, active: org.id === active.id, onSelect: () => switchTo(org.id) };
    }),
    { kind: "heading", label: "Manage" },
    { kind: "item", id: "new", label: "New organization", icon: <Plus size={16} />, onSelect: () => setCreating(true) },
    { kind: "item", id: "settings", label: "Organization settings", icon: <Settings size={16} />, onSelect: onOpenSettings },
  ];
  return (
    <>
      <MenuButton label={`Organization: ${active.name}. Switch organization`} title="Switch organization" className={`org-menu ${variant}`} fixed up={variant === "sidebar"} entries={entries}>
        <span className="org-mark">{orgInitial(active.name)}</span>
        <span className="org-copy">
          <strong>{active.name}</strong>
          <small>
            {profile.role} · {people(members.length)}
          </small>
        </span>
        <ChevronsUpDown size={16} />
      </MenuButton>
      {creating && <NewOrganizationDialog onClose={() => setCreating(false)} />}
    </>
  );
}

/** Makes an organization and opens it. The person who makes it is its owner. */
export function NewOrganizationDialog({ onClose }: { onClose: () => void }) {
  const { create } = useOrganizations();
  const { profile } = useWorkspace();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = create(name, { name: profile.name, email: profile.email, title: profile.title, status: profile.status });
    if (problem) setError(problem);
    else onClose();
  };
  return (
    <Modal title="New organization" description="A workspace of its own. Its projects, people, time and messages are kept apart from your other organizations." onClose={onClose}>
      <form className="org-form" onSubmit={submit}>
        <label>
          Name
          <input className="sf-input" autoFocus maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Acme Studio" />
        </label>
        {error && (
          <p className="org-error" role="alert">
            {error}
          </p>
        )}
        <div className="org-actions">
          <button className="sf-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="sf-button primary" type="submit">
            Create organization
          </button>
        </div>
      </form>
    </Modal>
  );
}
