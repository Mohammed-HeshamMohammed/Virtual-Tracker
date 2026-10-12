import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle,
  DownloadSimple,
  Clock,
  Funnel,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import {
  useWorkspace,
  formatDuration,
  downloadCsv,
  type Session,
} from "../../workspace";
import { EmptyState, Modal, SearchField } from "../ui";
import { Avatar, Badge, FilterSelect, PageHeading, ShortDate } from "./DashboardParts";
export function TimesheetsPage({
  sessions,
  canManage,
}: {
  sessions: Session[];
  canManage: boolean;
}) {
  const { members, projects, setSessions, navigate, route, notify } =
    useWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All entries");
  const [projectFilter, setProjectFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (
      route.mode === "dashboard" &&
      route.dashboardSection === "timesheets-submissions" &&
      route.target &&
      projects.some((project) => project.id === route.target)
    )
      setProjectFilter(route.target);
    if (
      route.mode === "dashboard" &&
      route.dashboardSection === "timesheets-submissions" &&
      route.target &&
      sessions.some((session) => session.id === route.target)
    ) {
      setDetail(route.target);
      setNote(
        sessions.find((session) => session.id === route.target)?.note || "",
      );
    }
  }, [route.revision]);
  const personName = (id: string) =>
    members.find((member) => member.id === id)?.name || "Team member";
  const projectName = (id: string) =>
    projects.find((project) => project.id === id)?.name || "Archived project";
  const filtered = sessions.filter(
    (session) =>
      (status === "All entries" || session.status === status) &&
      (projectFilter === "all" || session.projectId === projectFilter) &&
      `${personName(session.memberId)} ${projectName(session.projectId)} ${session.taskTitle}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const active = sessions.find((session) => session.id === detail);
  const selectedVisible = selected.filter((id) =>
    filtered.some(
      (session) => session.id === id && session.status === "Submitted",
    ),
  );
  const updateStatus = (ids: string[], next: Session["status"]) => {
    setSessions((previous) =>
      previous.map((session) =>
        ids.includes(session.id) ? { ...session, status: next } : session,
      ),
    );
    notify(
      `${ids.length} ${ids.length === 1 ? "entry" : "entries"} ${next.toLowerCase()} locally.`,
    );
    setSelected([]);
  };
  const exportRows = () => {
    downloadCsv("softfix-timesheets.csv", [
      ["Member", "Project", "Task", "Date", "Hours", "Status", "Note"],
      ...filtered.map((session) => [
        personName(session.memberId),
        projectName(session.projectId),
        session.taskTitle,
        new Date(session.startedAt).toLocaleDateString("en-CA"),
        (session.seconds / 3600).toFixed(2),
        session.status,
        session.note,
      ]),
    ]);
    notify("Timesheet export downloaded.");
  };
  return (
    <div className="sf-page db-page">
      <PageHeading
        eyebrow="TIME, WELL SPENT"
        title="Timesheets"
        description="Every session, clearly accounted for."
      >
        <button className="sf-button" onClick={exportRows}>
          <DownloadSimple size={17} />
          Export
        </button>
        <button
          className="sf-button primary"
          onClick={() => navigate("work", "timesheet")}
        >
          <Clock size={17} />
          My work log
        </button>
      </PageHeading>
      <div className="db-summary-strip">
        <div>
          <span>Tracked time</span>
          <strong>
            {formatDuration(
              filtered.reduce((sum, session) => sum + session.seconds, 0),
            )}
          </strong>
        </div>
        <div>
          <span>Awaiting review</span>
          <strong>
            {
              sessions.filter((session) => session.status === "Submitted")
                .length
            }
            <small>entries</small>
          </strong>
        </div>
        <div>
          <span>Approved time</span>
          <strong>
            {formatDuration(
              sessions
                .filter((session) => session.status === "Approved")
                .reduce((sum, session) => sum + session.seconds, 0),
            )}
          </strong>
        </div>
      </div>
      <section className="sf-card db-table-card">
        <div className="db-filter-row">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search people, projects or tasks"
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setSelected([]);
            }}
            options={[
              { value: "All entries", text: "All entries" },
              { value: "Submitted", text: "Submitted", count: sessions.filter((session) => session.status === "Submitted").length },
              { value: "Approved", text: "Approved" },
              { value: "Draft", text: "Draft" },
            ]}
          />
          <label className="db-select-wrap">
            <Funnel size={16} />
            <select
              aria-label="Filter timesheets by project"
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="all">All projects</option>
              {projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          {selectedVisible.length > 0 && canManage && (
            <button
              className="sf-button primary"
              onClick={() => updateStatus(selectedVisible, "Approved")}
            >
              <Check size={16} />
              Approve {selectedVisible.length}
            </button>
          )}
        </div>
        <div className="db-table-scroll">
          <table className="sf-table db-table">
            <thead>
              <tr>
                {canManage && (
                  <th>
                    <input
                      aria-label="Select all visible submitted timesheets"
                      type="checkbox"
                      checked={
                        filtered.filter((row) => row.status === "Submitted")
                          .length > 0 &&
                        filtered
                          .filter((row) => row.status === "Submitted")
                          .every((row) => selected.includes(row.id))
                      }
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? filtered
                                .filter((row) => row.status === "Submitted")
                                .map((row) => row.id)
                            : [],
                        )
                      }
                    />
                  </th>
                )}
                <th>Member / task</th>
                <th>Project</th>
                <th>Date</th>
                <th>Duration</th>
                <th>Status</th>
                <th>
                  <span className="db-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((session) => (
                <tr key={session.id}>
                  {canManage && (
                    <td>
                      <input
                        aria-label={`Select ${personName(session.memberId)} timesheet`}
                        type="checkbox"
                        disabled={session.status !== "Submitted"}
                        checked={selected.includes(session.id)}
                        onChange={(event) =>
                          setSelected((previous) =>
                            event.target.checked
                              ? [...previous, session.id]
                              : previous.filter((id) => id !== session.id),
                          )
                        }
                      />
                    </td>
                  )}
                  <td>
                    <div className="db-person-cell">
                      <Avatar
                        name={personName(session.memberId)}
                        color={
                          members.find(
                            (member) => member.id === session.memberId,
                          )?.color
                        }
                      />
                      <div>
                        <strong>{personName(session.memberId)}</strong>
                        <small>{session.taskTitle}</small>
                      </div>
                    </div>
                  </td>
                  <td>{projectName(session.projectId)}</td>
                  <td>
                    <ShortDate value={session.startedAt} />
                  </td>
                  <td className="db-number">
                    {formatDuration(session.seconds)}
                  </td>
                  <td>
                    <Badge text={session.status} />
                  </td>
                  <td>
                    <button
                      className="db-text-button"
                      onClick={() => {
                        setDetail(session.id);
                        setNote(session.note);
                      }}
                    >
                      Details <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <EmptyState
            title="No timesheets here"
            description="Try a different filter, or add a session in Work."
            action="Clear filters"
            onAction={() => {
              setQuery("");
              setStatus("All entries");
              setProjectFilter("all");
            }}
          />
        )}
        <div className="db-table-footer">
          <span>
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          </span>
          <span>Time records are shared with your Work space</span>
        </div>
      </section>
      {active && (
        <Modal
          title="Session details"
          description={`${personName(active.memberId)} · ${projectName(active.projectId)}`}
          onClose={() => setDetail(null)}
        >
          <div className="db-detail-summary">
            <div>
              <span>Duration</span>
              <strong>{formatDuration(active.seconds)}</strong>
            </div>
            <div>
              <span>Date</span>
              <strong>
                <ShortDate value={active.startedAt} />
              </strong>
            </div>
            <Badge text={active.status} />
          </div>
          <h3>{active.taskTitle}</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSessions((previous) =>
                previous.map((session) =>
                  session.id === active.id ? { ...session, note } : session,
                ),
              );
              notify("Session note saved.");
              setDetail(null);
            }}
          >
            <label className="db-field">
              Session note
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                readOnly={!canManage && active.memberId !== "me"}
                rows={3}
              />
            </label>
            <div className="db-modal-actions">
              {canManage && active.status === "Submitted" && (
                <>
                  <button
                    type="button"
                    className="sf-button"
                    onClick={() => {
                      updateStatus([active.id], "Draft");
                      setDetail(null);
                    }}
                  >
                    Return to draft
                  </button>
                  <button
                    type="button"
                    className="sf-button primary"
                    onClick={() => {
                      updateStatus([active.id], "Approved");
                      setDetail(null);
                    }}
                  >
                    <CheckCircle size={17} />
                    Approve
                  </button>
                </>
              )}
              {(canManage || active.memberId === "me") && (
                <button type="submit" className="sf-button">
                  Save note
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
