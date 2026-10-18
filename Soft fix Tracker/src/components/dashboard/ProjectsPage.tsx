import { useEffect, useMemo, useState } from "react";
import { List, Plus, SquaresFour } from "@phosphor-icons/react";
import { useWorkspace, usePersistentState, formatDuration } from "../../workspace";
import { EmptyState, SearchField } from "../ui";
import { FilterSelect, PageHeading } from "./DashboardParts";
import { Kpis, dateLabel, type PageContext } from "./pages/kit";
import { BudgetMeter, PeopleStack, ProjectAvatar, StatusPill, hoursText, needsAttention, projectFacts, refillText } from "./pages/project-facts";
import { useDashboardStores } from "./pages/stores";

const RANGE_TEXT: Record<string, string> = { week: "this week", month: "this month", all: "all time" };

/** Projects > Projects: every project as a card (or a table row) that says where it stands - its status,
 *  tasks, budget, people and time - and opens the project's own page. */
export function ProjectsPage({ ctx }: { ctx: PageContext }) {
  const { members, route, navigate } = useWorkspace();
  const stores = useDashboardStores();
  const { projectMeta: meta } = useWorkspace();
  const [layout, setLayout] = usePersistentState<string>("dashboard.projects-layout", "grid");
  const [sort, setSort] = usePersistentState<string>("dashboard.projects-sort", "recent");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  /** Projects just made on the New project page, marked until they have been seen. */
  const [fresh, setFresh] = useState<string[]>([]);
  const canManage = ctx.canManage;

  useEffect(() => {
    if (route.mode !== "dashboard" || route.dashboardSection !== "pm-projects" || !route.target) return;
    if (route.target.startsWith("new:")) {
      // Back from the New project page: show what was just made, in place.
      setFresh(route.target.slice(4).split(","));
      setFilter("all");
      setQuery("");
      window.setTimeout(() => document.querySelector(".pj-card.fresh, .pj-table tr.fresh")?.scrollIntoView({ block: "center", behavior: "smooth" }), 120);
      const timer = window.setTimeout(() => setFresh([]), 7000);
      return () => window.clearTimeout(timer);
    }
    // Older links name a project here; a project has its own page now.
    if (ctx.projects.some((project) => project.id === route.target)) navigate("dashboard", "pm-project", route.target);
  }, [route.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => ctx.projects.map((project) => projectFacts(project, ctx.allSessions, meta, stores.clients)), [ctx.projects, ctx.allSessions, meta, stores.clients]);
  /** Tracked on each project inside the top bar's date range. */
  const inRange = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const session of ctx.sessions) totals[session.projectId] = (totals[session.projectId] ?? 0) + session.seconds;
    return totals;
  }, [ctx.sessions]);

  const matches = (kind: string) => rows.filter((row) => kind === "all" || (kind === "attention" ? needsAttention(row.status) : kind === "complete" ? row.status === "Completed" : row.status !== "Completed"));
  const shown = matches(filter)
    .filter((row) => `${row.project.name} ${row.client?.name ?? ""} ${row.def.label}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) =>
      sort === "name"
        ? a.project.name.localeCompare(b.project.name)
        : sort === "tracked"
          ? b.seconds - a.seconds
          : sort === "due"
            ? (a.due || "9999").localeCompare(b.due || "9999")
            : // Recently active, with what was just made first.
              Number(fresh.includes(b.project.id)) - Number(fresh.includes(a.project.id)) || b.lastActive - a.lastActive,
    );

  const open = (id: string) => ctx.go("pm-project", id);
  const openForm = () => ctx.go("pm-new");
  const rangeSeconds = rows.reduce((sum, row) => sum + (inRange[row.project.id] ?? 0), 0);
  const attention = matches("attention").length;
  const openTasks = rows.reduce((sum, row) => sum + (row.total - row.done), 0);
  const filtering = Boolean(query.trim()) || filter !== "all";

  return (
    <div className="sf-page db-page pj-list">
      <PageHeading eyebrow="GOOD THINGS, IN PROGRESS" title="Projects" description="Where every project stands: its tasks, budget, people and time.">
        {canManage && (
          <button className="sf-button primary" onClick={openForm}>
            <Plus size={17} />
            New project
          </button>
        )}
      </PageHeading>

      {rows.length > 0 && (
        <Kpis
          items={[
            { label: "Projects", value: rows.length, unit: `${matches("active").length} active` },
            { label: "Open tasks", value: openTasks },
            { label: `Tracked ${RANGE_TEXT[ctx.range] ?? ""}`, value: formatDuration(rangeSeconds) },
            { label: "Need attention", value: attention, unit: attention ? "over budget or overdue" : "all on track", tone: attention ? "warn" : "good" },
          ]}
        />
      )}

      <div className="db-project-toolbar pj-toolbar">
        <div className="pj-toolbar-start">
          <FilterSelect
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", text: "All projects", count: rows.length },
              { value: "active", text: "In progress", count: matches("active").length },
              { value: "attention", text: "Need attention", count: attention },
              { value: "complete", text: "Completed", count: matches("complete").length },
            ]}
          />
          <FilterSelect
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "recent", text: "Recently active" },
              { value: "name", text: "Name" },
              { value: "tracked", text: "Most tracked" },
              { value: "due", text: "End date" },
            ]}
          />
        </div>
        <div className="db-project-toolbar-end">
          <SearchField value={query} onChange={setQuery} placeholder="Find a project or client" />
          <div className="db-view-toggle">
            <button aria-label="Cards" title="Cards" aria-pressed={layout !== "list"} className={layout !== "list" ? "active" : ""} onClick={() => setLayout("grid")}>
              <SquaresFour size={18} />
            </button>
            <button aria-label="Table" title="Table" aria-pressed={layout === "list"} className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")}>
              <List size={18} />
            </button>
          </div>
        </div>
      </div>

      {!rows.length ? (
        <EmptyState title="No projects yet" description={canManage ? "Make the first one to give the team's work a place." : "Projects you are on will show up here."} action={canManage ? "New project" : undefined} onAction={openForm} />
      ) : !shown.length ? (
        <EmptyState
          title="No projects match"
          description="Try a different name, or show all projects."
          action="Clear filters"
          onAction={() => {
            setQuery("");
            setFilter("all");
          }}
        />
      ) : layout === "list" ? (
        <section className="sf-card db-table-card">
          <div className="db-table-scroll">
            <table className="sf-table db-table pj-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Tasks</th>
                  <th>Budget</th>
                  <th>People</th>
                  <th className="db-number">Tracked {RANGE_TEXT[ctx.range]}</th>
                  <th>End date</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.project.id} className={fresh.includes(row.project.id) ? "fresh" : undefined} tabIndex={0} onClick={() => open(row.project.id)} onKeyDown={(event) => event.key === "Enter" && open(row.project.id)}>
                    <td>
                      <span className="pj-cell-name">
                        <ProjectAvatar projectId={row.project.id} size="sm" />
                        <span>
                          <strong>{row.project.name}</strong>
                          <small>
                            {row.def.label}
                            {row.client ? ` · ${row.client.name}` : ""}
                          </small>
                        </span>
                      </span>
                    </td>
                    <td>
                      <StatusPill status={row.status} />
                    </td>
                    <td>
                      {row.def.hasTasks ? (
                        <span className="pj-budget compact" title={`${row.done} of ${row.total} tasks done`}>
                          <span className="db-progress">
                            <span style={{ width: `${row.progress}%` }} />
                          </span>
                          <b>
                            {row.done}/{row.total}
                          </b>
                        </span>
                      ) : (
                        <span className="db-muted pj-nobudget">No tasks</span>
                      )}
                    </td>
                    <td>
                      <BudgetMeter facts={row} compact />
                    </td>
                    <td>
                      <PeopleStack ids={row.peopleIds} members={members} open={row.open} max={3} />
                    </td>
                    <td className="db-number">{formatDuration(inRange[row.project.id] ?? 0)}</td>
                    <td>{row.due ? dateLabel(row.due) : <span className="db-muted">None</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="db-table-footer">
            <span>
              {shown.length} {shown.length === 1 ? "project" : "projects"}
            </span>
            <span>{formatDuration(shown.reduce((sum, row) => sum + row.seconds, 0))} tracked in all</span>
          </div>
        </section>
      ) : (
        <div className="pj-grid">
          {shown.map((row) => {
            const isFresh = fresh.includes(row.project.id);
            return (
              <button key={row.project.id} className={`sf-card pj-card ${isFresh ? "fresh" : ""}`} onClick={() => open(row.project.id)}>
                <span className="pj-card-head">
                  <ProjectAvatar projectId={row.project.id} />
                  <span className="pj-card-name">
                    <strong>{row.project.name}</strong>
                    <small>
                      {row.def.label}
                      {row.client ? ` · ${row.client.name}` : ""}
                      {row.project.billable === false ? " · not billable" : ""}
                    </small>
                  </span>
                  {isFresh ? <span className="pj-pill done">New</span> : <StatusPill status={row.status} />}
                </span>
                {row.description && <span className="pj-card-desc">{row.description}</span>}
                <span className="pj-meters">
                  <span className="pj-meter">
                    <span>
                      <em>Tasks</em>
                      <b>{row.def.hasTasks ? (row.total ? `${row.done} of ${row.total} done` : "None yet") : "Not used"}</b>
                    </span>
                    {row.def.hasTasks ? (
                      <span className="db-progress">
                        <span style={{ width: `${row.progress}%` }} />
                      </span>
                    ) : (
                      <small>Members time themselves on it.</small>
                    )}
                  </span>
                  <span className="pj-meter">
                    <span>
                      <em>Budget</em>
                      <b>{row.budget > 0 ? `${hoursText(row.used)} of ${row.budget}h${row.resets === "Never" ? "" : ` ${refillText(row.resets)}`}` : "None set"}</b>
                    </span>
                    {row.budget > 0 ? (
                      <span className={`db-progress ${row.used >= row.budget ? "over" : (row.used / row.budget) * 100 >= row.notifyAt ? "near" : ""}`}>
                        <span style={{ width: `${Math.min(100, Math.round((row.used / row.budget) * 100))}%` }} />
                      </span>
                    ) : (
                      <small>Not measured against a limit.</small>
                    )}
                  </span>
                </span>
                <span className="pj-card-foot">
                  <PeopleStack ids={row.peopleIds} members={members} open={row.open} />
                  <span className="pj-foot-facts">
                    <span>
                      {formatDuration(inRange[row.project.id] ?? 0)} {RANGE_TEXT[ctx.range]}
                    </span>
                    {row.due && <span className={row.status === "Overdue" ? "late" : ""}>Ends {dateLabel(row.due)}</span>}
                  </span>
                </span>
              </button>
            );
          })}
          {canManage && !filtering && (
            <button className="db-create-project pj-create" onClick={openForm}>
              <strong>New project</strong>
              <p>Start one for your next piece of work</p>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
