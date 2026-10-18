import { ProjectLabel } from "../ProjectAvatar";
import { useState } from "react";
import {
  ChartBar,
  DownloadSimple,
  BookmarkSimple,
  ArrowUpRight,
  Trash,
  FileText,
  UsersThree,
  Folder,
  Clock,
} from "@phosphor-icons/react";
import {
  useWorkspace,
  usePersistentState,
  downloadCsv,
  formatDuration,
  type Session,
} from "../../workspace";
import { EmptyState } from "../ui";
import { PageHeading, Badge } from "./DashboardParts";
export function ReportsPage({ sessions }: { sessions: Session[] }) {
  const { projects, members, notify } = useWorkspace();
  const [groupBy, setGroupBy] = useState("project");
  const [status, setStatus] = useState("all");
  const [name, setName] = useState("Weekly workspace summary");
  const [saved, setSaved] = usePersistentState<
    { id: string; name: string; groupBy: string; status: string }[]
  >("dashboard.reports", []);
  const filtered = sessions.filter(
    (session) => status === "all" || session.status === status,
  );
  const grouped = Object.values(
    filtered.reduce<
      Record<
        string,
        { label: string; projectId?: string; seconds: number; sessions: number; approved: number }
      >
    >((result, session) => {
      const label =
        groupBy === "project"
          ? projects.find((project) => project.id === session.projectId)
              ?.name || "Archived project"
          : groupBy === "member"
            ? members.find((member) => member.id === session.memberId)?.name ||
              "Team member"
            : new Date(session.startedAt).toLocaleDateString("en", {
                day: "numeric",
                month: "short",
                year: "numeric",
              });
      result[label] ||= { label, projectId: groupBy === "project" ? session.projectId : undefined, seconds: 0, sessions: 0, approved: 0 };
      result[label].seconds += session.seconds;
      result[label].sessions++;
      if (session.status === "Approved")
        result[label].approved += session.seconds;
      return result;
    }, {}),
  ).sort((a, b) => b.seconds - a.seconds);
  const total = filtered.reduce((sum, session) => sum + session.seconds, 0);
  const exportReport = () => {
    downloadCsv(
      `${name.trim().replaceAll(/[^a-z0-9]+/gi, "-") || "softfix-report"}.csv`,
      [
        [
          groupBy,
          "Sessions",
          "Tracked hours",
          "Approved hours",
          "Share of time",
        ],
        ...grouped.map((row) => [
          row.label,
          row.sessions,
          (row.seconds / 3600).toFixed(2),
          (row.approved / 3600).toFixed(2),
          `${Math.round((row.seconds / (total || 1)) * 100)}%`,
        ]),
      ],
    );
    notify("Your report has been downloaded.");
  };
  return (
    <div className="sf-page db-page">
      <PageHeading
        eyebrow="MAKE THE NUMBERS MEAN SOMETHING"
        title="Reports"
        description="Turn your team's work into a clear, shareable story."
      >
        <button className="sf-button primary" onClick={exportReport}>
          <DownloadSimple size={17} />
          Export report
        </button>
      </PageHeading>
      <div className="db-report-templates">
        {[
          {
            id: "project",
            title: "Project overview",
            subtitle: "Time and progress, project by project",
            icon: Folder,
          },
          {
            id: "member",
            title: "Team summary",
            subtitle: "See how your team spends its time",
            icon: UsersThree,
          },
          {
            id: "day",
            title: "Daily breakdown",
            subtitle: "Follow the rhythm of the week",
            icon: Clock,
          },
        ].map((template) => (
          <button
            key={template.id}
            className={`sf-card db-template ${groupBy === template.id ? "active" : ""}`}
            onClick={() => setGroupBy(template.id)}
          >
            <template.icon size={23} />
            <div>
              <strong>{template.title}</strong>
              <small>{template.subtitle}</small>
            </div>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
      <section className="sf-card">
        <div className="db-card-heading">
          <div>
            <h2>Build your report</h2>
            <p>Your selected date range applies to this report</p>
          </div>
          <Badge text="Live preview" />
        </div>
        <div className="db-report-builder">
          <label className="db-field">
            Report name
            <input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="db-field">
            Group by
            <select
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value)}
            >
              <option value="project">Project</option>
              <option value="member">Team member</option>
              <option value="day">Day</option>
            </select>
          </label>
          <label className="db-field">
            Entry status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option>Approved</option>
              <option>Submitted</option>
              <option>Draft</option>
            </select>
          </label>
          <button
            className="sf-button"
            disabled={!name.trim()}
            onClick={() => {
              const existing = saved.find(
                (report) =>
                  report.name.toLowerCase() === name.trim().toLowerCase(),
              );
              setSaved((previous) =>
                existing
                  ? previous.map((report) =>
                      report.id === existing.id
                        ? { ...report, groupBy, status }
                        : report,
                    )
                  : [
                      ...previous,
                      {
                        id: crypto.randomUUID(),
                        name: name.trim(),
                        groupBy,
                        status,
                      },
                    ],
              );
              notify(
                existing
                  ? "Saved report updated."
                  : "Report saved to this workspace.",
              );
            }}
          >
            <BookmarkSimple size={17} />
            Save view
          </button>
        </div>
        <div className="db-report-preview">
          <div className="db-report-preview-title">
            <div>
              <FileText size={24} />
              <h3>{name || "Untitled report"}</h3>
            </div>
            <span>
              {filtered.length} sessions · {formatDuration(total)} total
            </span>
          </div>
          <div className="db-table-scroll">
            <table className="sf-table db-table">
              <thead>
                <tr>
                  <th>
                    {groupBy === "project"
                      ? "Project"
                      : groupBy === "member"
                        ? "Team member"
                        : "Date"}
                  </th>
                  <th>Sessions</th>
                  <th>Tracked time</th>
                  <th>Approved time</th>
                  <th>Share of total</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((row) => (
                  <tr key={row.label}>
                    <td>
                      <strong>{row.projectId ? <ProjectLabel projectId={row.projectId} /> : row.label}</strong>
                    </td>
                    <td>{row.sessions}</td>
                    <td className="db-number">{formatDuration(row.seconds)}</td>
                    <td className="db-number">
                      {formatDuration(row.approved)}
                    </td>
                    <td>
                      <div className="db-report-share">
                        <div className="db-progress">
                          <span
                            style={{
                              width: `${(row.seconds / (total || 1)) * 100}%`,
                            }}
                          />
                        </div>
                        <span>
                          {Math.round((row.seconds / (total || 1)) * 100)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!grouped.length && (
            <EmptyState
              title="No data for this report"
              description="Choose a wider date range or include all entry statuses."
            />
          )}
        </div>
      </section>
      <section className="sf-card">
        <div className="db-card-heading">
          <div>
            <h2>Saved reports</h2>
            <p>Your go-to perspectives, ready when you are</p>
          </div>
          <span className="db-count">{saved.length}</span>
        </div>
        {saved.length ? (
          <div className="db-saved-reports">
            {saved.map((report) => (
              <div key={report.id}>
                <ChartBar size={22} />
                <button
                  onClick={() => {
                    setName(report.name);
                    setGroupBy(report.groupBy);
                    setStatus(report.status);
                    notify("Saved report loaded.");
                  }}
                >
                  <strong>{report.name}</strong>
                  <small>
                    Grouped by {report.groupBy} ·{" "}
                    {report.status === "all" ? "All entries" : report.status}
                  </small>
                </button>
                <button
                  className="sf-icon-button"
                  aria-label={`Remove saved report ${report.name}`}
                  onClick={() => {
                    setSaved((previous) =>
                      previous.filter((item) => item.id !== report.id),
                    );
                    notify("Saved report removed.");
                  }}
                >
                  <Trash size={17} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="db-saved-empty">
            <BookmarkSimple size={25} />
            <div>
              <strong>Make a useful view your own.</strong>
              <p>Set up a report above, then save it for next time.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
