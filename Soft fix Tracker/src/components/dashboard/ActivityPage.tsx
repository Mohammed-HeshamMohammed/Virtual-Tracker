import { useState } from "react";
import {
  ArrowRight,
  Clock,
  ChartBar,
  Pulse,
  ArrowUpRight,
} from "@phosphor-icons/react";
import { useWorkspace, formatDuration, type Session } from "../../workspace";
import { SearchField, EmptyState, Modal } from "../ui";
import { Avatar, Badge, PageHeading, ShortDate, StatTile } from "./DashboardParts";
import { AreaChart, Donut } from "./DashboardCharts";
export function ActivityPage({ sessions }: { sessions: Session[] }) {
  const { members, projects, navigate } = useWorkspace();
  const [query, setQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState("all");
  const [detail, setDetail] = useState<string | null>(null);
  const filtered = sessions.filter(
    (session) =>
      (memberFilter === "all" || session.memberId === memberFilter) &&
      `${session.taskTitle} ${members.find((member) => member.id === session.memberId)?.name || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const total = filtered.reduce((sum, session) => sum + session.seconds, 0);
  const allocations = projects
    .map((project) => ({
      ...project,
      seconds: filtered
        .filter((session) => session.projectId === project.id)
        .reduce((sum, session) => sum + session.seconds, 0),
    }))
    .sort((a, b) => b.seconds - a.seconds);
  const activeMember = members.find((member) => member.id === detail);
  const sessionCount = filtered.length;
  const contributors = members
    .map((member) => ({
      member,
      seconds: filtered.filter((session) => session.memberId === member.id).reduce((sum, session) => sum + session.seconds, 0),
    }))
    .filter((entry) => entry.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
  const approvedSeconds = filtered
    .filter((session) => session.status === "Approved")
    .reduce((sum, session) => sum + session.seconds, 0);
  const approvedPercent = total ? Math.round((approvedSeconds / total) * 100) : 0;
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - 13 + index);
    const seconds = filtered
      .filter((session) => new Date(session.startedAt).toDateString() === date.toDateString())
      .reduce((sum, session) => sum + session.seconds, 0);
    return {
      label: date.toLocaleDateString("en", { month: "short", day: "numeric" }),
      value: Math.round((seconds / 3600) * 100) / 100,
    };
  });
  return (
    <div className="sf-page db-page">
      <PageHeading
        eyebrow="THE PULSE OF YOUR TEAM"
        title="Activity"
        description="Understand how the work is taking shape, one session at a time."
      >
        <button
          className="sf-button"
          onClick={() => navigate("dashboard", "reports")}
        >
          <ChartBar size={17} />
          Activity report
        </button>
      </PageHeading>
      <div className="db-bento db-activity">
        <StatTile hero title="Tracked time" action="Open timesheets" onOpen={() => navigate("dashboard", "timesheets")}>
          <strong>{formatDuration(total)}</strong>
          <small>
            <span className="db-chip">{sessionCount} sessions</span> in this view
          </small>
        </StatTile>
        <StatTile title="People active" action="Open people" onOpen={() => navigate("dashboard", "people")}>
          <strong>
            {contributors.length}
            <em> / {members.length}</em>
          </strong>
          <small>Contributing in this period</small>
        </StatTile>
        <StatTile title="Average session">
          <strong>{formatDuration(sessionCount ? total / sessionCount : 0)}</strong>
          <small>Across every session shown</small>
        </StatTile>
        <StatTile title="Approved">
          <strong>
            {approvedPercent}
            <em>%</em>
          </strong>
          <div className="db-progress">
            <span style={{ width: `${approvedPercent}%` }} />
          </div>
        </StatTile>

        <section className="sf-card db-span-8">
          <div className="db-card-heading">
            <div>
              <h2>Tracked hours</h2>
              <p>Daily time over the last two weeks</p>
            </div>
            <span className="db-chip">{formatDuration(total)} total</span>
          </div>
          <AreaChart
            label="Tracked hours per day"
            points={days}
            unit="h"
            format={(value) => (Number.isInteger(value) ? String(value) : value.toFixed(1))}
          />
        </section>

        <section className="sf-card db-span-4">
          <div className="db-card-heading">
            <div>
              <h2>Time by project</h2>
              <p>Where the hours went</p>
            </div>
          </div>
          <div className="db-donut-wrap">
            <Donut
              segments={allocations.map((project) => ({
                label: project.name,
                value: project.seconds,
                tone: project.color,
              }))}
            >
              <strong>{formatDuration(total)}</strong>
              <span>tracked</span>
            </Donut>
          </div>
          <ul className="db-legend-list">
            {allocations.map((project) => (
              <li key={project.id}>
                <i className={`db-color-dot ${project.color}`} />
                <span>{project.name}</span>
                <strong>{total ? Math.round((project.seconds / total) * 100) : 0}%</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="sf-card db-span-5">
          <div className="db-card-heading">
            <div>
              <h2>Top contributors</h2>
              <p>People contributing in this period</p>
            </div>
            <Pulse size={20} />
          </div>
          <div className="db-contributors">
            {contributors.map(({ member, seconds }) => (
              <button key={member.id} onClick={() => setDetail(member.id)}>
                <Avatar name={member.name} color={member.color} />
                <span className="db-contributor-copy">
                  <strong>{member.name}</strong>
                  <small>
                    {member.team} · {member.role}
                  </small>
                  <span className="db-progress">
                    <span style={{ width: `${contributors[0].seconds ? (seconds / contributors[0].seconds) * 100 : 0}%` }} />
                  </span>
                </span>
                <span className="db-contributor-time">
                  {formatDuration(seconds)}
                  <ArrowUpRight size={14} />
                </span>
              </button>
            ))}
            {!contributors.length && (
              <EmptyState
                title="No activity in this view"
                description="Clear your filters to see your team's sessions."
              />
            )}
          </div>
        </section>

        <section className="sf-card db-span-7">
          <div className="db-card-heading">
            <div>
              <h2>Where the time goes</h2>
              <p>Tracked time by project</p>
            </div>
            <Clock size={20} />
          </div>
          <div className="db-allocation-total">
            <strong>{formatDuration(total)}</strong>
            <span>across {sessionCount} sessions</span>
          </div>
          <div className="db-allocation-list">
            {allocations.map((project) => (
              <button key={project.id} onClick={() => navigate("dashboard", "pm-project", project.id)}>
                <div>
                  <span>
                    <i className={`db-color-dot ${project.color}`} />
                    {project.name}
                  </span>
                  <strong>{formatDuration(project.seconds)}</strong>
                </div>
                <div className="db-progress">
                  <span style={{ width: `${total ? (project.seconds / total) * 100 : 0}%` }} />
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
      <section className="sf-card">
        <div className="db-card-heading">
          <div>
            <h2>Session timeline</h2>
            <p>A transparent record of work in this workspace</p>
          </div>
          <Badge text="Local workspace" />
        </div>
        <div className="db-filter-row">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search activity"
          />
          <select
            className="db-select"
            aria-label="Filter activity by member"
            value={memberFilter}
            onChange={(event) => setMemberFilter(event.target.value)}
          >
            <option value="all">All members</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="db-timeline">
          {filtered.map((session) => {
            const member = members.find(
              (person) => person.id === session.memberId,
            );
            return (
              <div className="db-timeline-item" key={session.id}>
                <Avatar
                  name={member?.name || "Team member"}
                  color={member?.color}
                />
                <div>
                  <p>
                    <strong>{member?.name}</strong> logged{" "}
                    <strong>{formatDuration(session.seconds)}</strong> on{" "}
                    <span>
                      {
                        projects.find(
                          (project) => project.id === session.projectId,
                        )?.name
                      }
                    </span>
                  </p>
                  <small>{session.taskTitle}</small>
                  <div>
                    <Badge text={session.status} />
                    <span>
                      <ShortDate value={session.startedAt} /> ·{" "}
                      {new Date(session.startedAt).toLocaleTimeString("en", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
                <button
                  className="sf-icon-button"
                  aria-label={`View session ${session.taskTitle}`}
                  onClick={() =>
                    navigate("dashboard", "timesheets-submissions", session.id)
                  }
                >
                  <ArrowRight size={18} />
                </button>
              </div>
            );
          })}
        </div>
        {!filtered.length && (
          <EmptyState
            title="No matching activity"
            description="Try another name or clear the member filter."
            action="Clear filters"
            onAction={() => {
              setQuery("");
              setMemberFilter("all");
            }}
          />
        )}
      </section>
      {activeMember && (
        <Modal
          title={activeMember.name}
          description={`${activeMember.role} · ${activeMember.team}`}
          onClose={() => setDetail(null)}
        >
          <div className="db-profile-summary">
            <Avatar name={activeMember.name} color={activeMember.color} />
            <div>
              <strong>
                {formatDuration(
                  sessions
                    .filter((session) => session.memberId === activeMember.id)
                    .reduce((sum, session) => sum + session.seconds, 0),
                )}
              </strong>
              <p>tracked in the selected period</p>
            </div>
            <Badge text={activeMember.status} />
          </div>
          <h3>Recent sessions</h3>
          {sessions
            .filter((session) => session.memberId === activeMember.id)
            .map((session) => (
              <div className="db-detail-row" key={session.id}>
                <span>{session.taskTitle}</span>
                <strong>{formatDuration(session.seconds)}</strong>
              </div>
            ))}
          <div className="db-modal-actions">
            <button
              className="sf-button primary"
              onClick={() => {
                setMemberFilter(activeMember.id);
                setDetail(null);
              }}
            >
              Focus on {activeMember.name.split(" ")[0]}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
