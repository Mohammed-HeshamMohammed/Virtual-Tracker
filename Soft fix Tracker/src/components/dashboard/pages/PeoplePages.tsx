import { useState, type FormEvent } from "react";
import { Prohibit, UsersThree } from "@phosphor-icons/react";
import { formatDuration, useWorkspace } from "../../../workspace";
import { Modal } from "../../ui";
import { Avatar, Badge, PageHeading } from "../DashboardParts";
import { DataTable, Kpis, Person, dateLabel, money, type PageContext } from "./kit";
import { dayKey, logAudit, useDashboardStores } from "./stores";

/** Teams: the same people, grouped the way they work together. */
export function TeamsPage({ ctx }: { ctx: PageContext }) {
  const { members } = useWorkspace();
  const weekAgo = Date.now() - 7 * 86_400_000;
  const teams = [...new Set(members.filter((member) => member.role !== "Client").map((member) => member.team))].map((team) => {
    const people = members.filter((member) => member.team === team && member.role !== "Client");
    const lead = people.find((member) => ["Owner", "Admin", "Manager"].includes(member.role)) ?? people[0];
    const seconds = ctx.allSessions.filter((session) => people.some((member) => member.id === session.memberId) && new Date(session.startedAt).getTime() >= weekAgo).reduce((sum, session) => sum + session.seconds, 0);
    return { team, people, lead, seconds, open: people.filter((member) => member.status !== "Offline").length };
  });
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="THE PEOPLE BEHIND THE PROGRESS" title="Teams" description="Everyone, grouped by the team they belong to." />
      <Kpis items={[{ label: "Teams", value: teams.length }, { label: "People", value: teams.reduce((sum, team) => sum + team.people.length, 0) }, { label: "Online now", value: teams.reduce((sum, team) => sum + team.open, 0), tone: "good" }]} />
      <div className="db-team-grid">
        {teams.map(({ team, people, lead, seconds, open }) => (
          <section key={team} className="sf-card db-team">
            <div className="db-card-heading">
              <div>
                <h2>{team}</h2>
                <p>{lead ? `Led by ${lead.name}` : "No lead yet"}</p>
              </div>
              <Badge text={`${open} online`} />
            </div>
            <div className="db-avatar-row">
              {people.map((member) => (
                <Avatar key={member.id} name={member.name} color={member.color} />
              ))}
            </div>
            <dl className="db-team-stats">
              <div>
                <dt>People</dt>
                <dd>{people.length}</dd>
              </div>
              <div>
                <dt>This week</dt>
                <dd>{formatDuration(seconds)}</dd>
              </div>
            </dl>
            <button className="db-text-button" onClick={() => ctx.go("people-members")}>
              See the members
            </button>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Banned members: people who have been shut out of the workspace, and why. */
export function BannedMembersPage() {
  const stores = useDashboardStores();
  const { members, profile, notify } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ memberId: "", reason: "" });
  const rows = Object.entries(stores.banned).map(([id, entry]) => ({ id, ...entry }));
  const candidates = members.filter((member) => member.id !== "me" && member.role !== "Owner" && !stores.banned[member.id]);

  const ban = (event: FormEvent) => {
    event.preventDefault();
    if (!form.memberId || !form.reason.trim()) return;
    const name = members.find((member) => member.id === form.memberId)?.name ?? "A member";
    stores.setBanned((old) => ({ ...old, [form.memberId]: { reason: form.reason.trim(), date: dayKey(0) } }));
    logAudit(stores, profile.name, `Banned ${name} from the workspace.`);
    setOpen(false);
    setForm({ memberId: "", reason: "" });
    notify(`${name} is banned.`);
  };
  const restore = (id: string) => {
    const name = members.find((member) => member.id === id)?.name ?? "The member";
    stores.setBanned((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
    logAudit(stores, profile.name, `Restored access for ${name}.`);
    notify(`${name} can use the workspace again.`);
  };

  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="THE PEOPLE BEHIND THE PROGRESS" title="Banned members" description="Owners and admins can shut someone out, and let them back in.">
        <button className="sf-button primary" onClick={() => setOpen(true)} disabled={!candidates.length}>
          <Prohibit size={17} /> Ban a member
        </button>
      </PageHeading>
      <Kpis items={[{ label: "Banned", value: rows.length, tone: rows.length ? undefined : "good" }, { label: "Active members", value: members.length - rows.length }]} />
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        searchText={(row) => `${members.find((member) => member.id === row.id)?.name ?? ""} ${row.reason}`}
        searchPlaceholder="Search banned members"
        exportName="banned-members"
        emptyTitle="Nobody is banned"
        emptyHint="Everyone in the workspace has access."
        footer="A ban is recorded on this device only"
        columns={[
          { header: "Member", cell: (row) => <Person id={row.id} detail={members.find((member) => member.id === row.id)?.email} /> },
          { header: "Reason", cell: (row) => row.reason, csv: (row) => row.reason },
          { header: "Banned on", cell: (row) => dateLabel(row.date), csv: (row) => row.date },
          { header: "", cell: (row) => <button className="sf-button" onClick={() => restore(row.id)}>Restore access</button> },
        ]}
      />
      {open && (
        <Modal title="Ban a member" description="They lose access until an admin restores it." onClose={() => setOpen(false)}>
          <form onSubmit={ban}>
            <label className="db-field">
              Who
              <select required value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value })}>
                <option value="">Choose a member</option>
                {candidates.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {member.role}
                  </option>
                ))}
              </select>
            </label>
            <label className="db-field">
              Reason
              <textarea required rows={3} maxLength={240} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
            </label>
            <div className="db-modal-actions">
              <button className="sf-button" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="sf-button primary" type="submit">
                Ban member
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/** Customer accounts: the client logins, and the company and billing behind each. */
export function CustomerAccountsPage({ ctx }: { ctx: PageContext }) {
  const stores = useDashboardStores();
  const { members } = useWorkspace();
  const rows = members
    .filter((member) => member.role === "Client")
    .map((member) => {
      const client = stores.clients.find((item) => item.contact === member.name || item.email === member.email);
      const invoices = client ? stores.invoices.filter((invoice) => invoice.client === client.name) : [];
      return { member, company: client?.name ?? "Not linked yet", projects: client?.projectIds.length ?? 0, billed: invoices.reduce((sum, invoice) => sum + invoice.amount, 0), banned: Boolean(stores.banned[member.id]) };
    });
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="THE PEOPLE BEHIND THE PROGRESS" title="Customer accounts" description="Client logins and the company behind each one.">
        <button className="sf-button" onClick={() => ctx.go("pm-clients")}>
          <UsersThree size={17} /> Manage clients
        </button>
      </PageHeading>
      <Kpis items={[{ label: "Customer accounts", value: rows.length }, { label: "Billed to date", value: money(rows.reduce((sum, row) => sum + row.billed, 0)) }, { label: "Active", value: rows.filter((row) => !row.banned).length, tone: "good" }]} />
      <DataTable
        rows={rows}
        rowKey={(row) => row.member.id}
        searchText={(row) => `${row.member.name} ${row.member.email} ${row.company}`}
        searchPlaceholder="Search accounts"
        exportName="customer-accounts"
        emptyTitle="No customer accounts"
        emptyHint="Add a person with the Client role in Members."
        columns={[
          { header: "Account", cell: (row) => <Person id={row.member.id} detail={row.member.email} />, csv: (row) => row.member.name },
          { header: "Company", cell: (row) => row.company, csv: (row) => row.company },
          { header: "Projects", numeric: true, cell: (row) => row.projects, csv: (row) => row.projects },
          { header: "Billed", numeric: true, cell: (row) => money(row.billed), csv: (row) => row.billed },
          { header: "Status", cell: (row) => <Badge text={row.banned ? "Banned" : "Active"} />, csv: (row) => (row.banned ? "Banned" : "Active") },
        ]}
      />
    </div>
  );
}
