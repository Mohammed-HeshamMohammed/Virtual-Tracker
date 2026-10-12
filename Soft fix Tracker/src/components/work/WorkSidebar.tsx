import { ArrowUpRight, CalendarBlank, CheckSquare, Clock, House } from "@phosphor-icons/react";
import type { WorkProject } from "../../data/work";
import { formatDuration, useWorkspace } from "../../workspace";
import { OrganizationMenu } from "../OrganizationMenu";
import { Tip } from "../Tip";

/** Work keeps what you use while you work: today, your own tasks, your time and your day, and a
 *  project picker that decides which tasks Up next shows. Making and managing projects and tasks
 *  lives in the Dashboard (the arrow on a project opens it there). */
export type WorkView = "overview" | "tasks" | "timesheet" | "schedule";
type Props = {
  view: WorkView;
  onNavigate: (view: WorkView) => void;
  projects: WorkProject[];
  /** The project whose tasks Up next shows. */
  viewProjectId: string;
  /** The project the timer is running on, if it is running. */
  trackingProjectId: string | null;
  onPickProject: (id: string) => void;
  onOpenProject: (id: string) => void;
  weekSeconds: number;
};

const navigation = [
  { id: "overview" as const, title: "Overview", icon: House },
  { id: "tasks" as const, title: "My tasks", icon: CheckSquare },
  { id: "timesheet" as const, title: "My timesheet", icon: Clock },
  { id: "schedule" as const, title: "My schedule", icon: CalendarBlank }
];

/** More rows than this and the project list scrolls on its own; nothing else in the sidebar does. */
const SCOPE_ROWS = 5;

export function WorkSidebar({ view, onNavigate, projects, viewProjectId, trackingProjectId, onPickProject, onOpenProject, weekSeconds }: Props) {
  const { preferences, sessions, navigate } = useWorkspace();
  const hours = weekSeconds / 3600;
  const weeklyGoal = preferences.dailyGoal * 5;
  const mine = sessions.filter(session => session.memberId === "me");
  return (
    <aside className="sf-sidebar db-sidebar wk-sidebar">
      {/* The Dashboard's own sidebar, piece for piece (its classes, not look-alikes): the menu, the
          project list, then the bottom block with the organization switcher. */}
      <nav className="wk-nav" aria-label="Work navigation">
        {navigation.map(({ id, title, icon: Icon }) => <button key={id} className={`db-nav-item ${view === id ? "active" : ""}`} onClick={() => onNavigate(id)} aria-current={view === id ? "page" : undefined}><Icon size={19} /><span>{title}</span></button>)}
      </nav>
      <div className="db-scope wk-scope">
        <div className="db-sidebar-caption db-scope-caption"><span>YOUR PROJECTS</span><small>{projects.length}</small></div>
        <div className={`db-scope-list ${projects.length > SCOPE_ROWS ? "scrolls" : ""}`} role="group" aria-label="Pick a project">
          {projects.map(project => {
            const picked = project.id === viewProjectId;
            const tracking = project.id === trackingProjectId;
            const open = project.tasks.filter(task => !task.done).length;
            const tracked = mine.filter(session => session.projectId === project.id).reduce((sum, session) => sum + session.seconds, 0);
            return (
              <div key={project.id} className={`wk-project-row ${picked ? "active" : ""}`}>
                <Tip content={<><strong>{project.name}</strong><small>{open} open · {project.tasks.length - open} done</small><small>{formatDuration(tracked)} tracked in total</small>{tracking && <small>Your timer is running here</small>}</>}>
                  <button className={`db-scope-row ${picked ? "active" : ""}`} aria-pressed={picked} onClick={() => onPickProject(project.id)}>
                    <span className={`db-scope-dot ${project.color} ${tracking ? "pulse" : ""}`} />
                    <span>{project.name}</span>
                    <small>{open}</small>
                  </button>
                </Tip>
                <button className="wk-project-open" aria-label={`Open ${project.name} in the Dashboard`} title="Open in the Dashboard" onClick={() => onOpenProject(project.id)}><ArrowUpRight size={14} /></button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="db-sidebar-bottom">
        <div className="wk-week-card"><div><Clock size={17} /><span>This week</span><strong>{hours.toFixed(1)}<small> / {weeklyGoal}h</small></strong></div><div className="wk-progress"><i style={{ width: `${Math.min(100, hours / weeklyGoal * 100)}%` }} /></div><p>{Math.max(0, weeklyGoal - hours).toFixed(1)} hours to your weekly goal</p></div>
        <OrganizationMenu variant="sidebar" onOpenSettings={() => navigate("dashboard", "settings")} />
      </div>
    </aside>
  );
}
