import { ProjectAvatar } from "../ProjectAvatar";
import type { ReactElement } from "react";
import {
  CalendarBlank,
  ChartBar,
  Clock,
  CurrencyDollar,
  Folder,
  Gear,
  Lightning,
  SquaresFour,
  UsersThree,
  ArrowUpRight,
} from "@phosphor-icons/react";
import { navSections, sectionAllowed, type DashboardSection } from "../../data/dashboard";
import { useWorkspace } from "../../workspace";
import type { WorkProject } from "../../data/work";
import { OrganizationMenu } from "../OrganizationMenu";
const icons: Record<string, ReactElement> = {
  dashboard: <SquaresFour />,
  timesheets: <Clock />,
  activity: <Lightning />,
  "project-management": <Folder />,
  calendar: <CalendarBlank />,
  reports: <ChartBar />,
  people: <UsersThree />,
  financials: <CurrencyDollar />,
  settings: <Gear />,
};
/** More rows than this and the project list gets its own scrollbar (and nothing else does). */
const SCOPE_ROWS = 5;

export function DashboardSidebar({
  activeSection,
  onSelect,
  projects,
  scope,
  onScope,
}: {
  activeSection: string;
  onSelect: (id: DashboardSection) => void;
  /** The projects this role may see, for the list that narrows the Dashboard to one. */
  projects: WorkProject[];
  scope: string;
  onScope: (id: string) => void;
}) {
  const { profile, members, navigate } = useWorkspace();
  const visible = navSections.filter((section) => sectionAllowed(profile.role, section.id));
  return (
    <aside className="sf-sidebar db-sidebar">
      <nav aria-label="Dashboard navigation">
        {visible.map((section, index) => (
          <div key={section.id}>
            {index > 0 && section.group !== visible[index - 1].group && (
              <div className="db-sidebar-caption db-manage-label">MANAGE</div>
            )}
            <button
              className={`db-nav-item ${activeSection === section.id ? "active" : ""}`}
              aria-current={activeSection === section.id ? "page" : undefined}
              onClick={() => onSelect(section.id)}
            >
              {icons[section.id]}
              <span>{section.label}</span>
              {section.id === "people" && <small>{members.length}</small>}
            </button>
          </div>
        ))}
      </nav>
      {projects.length > 0 && (
        <div className="db-scope">
          <div className="db-sidebar-caption db-scope-caption">
            <span>PROJECTS</span>
            <small>{projects.length}</small>
          </div>
          <div className={`db-scope-list ${projects.length + 1 > SCOPE_ROWS ? "scrolls" : ""}`} role="group" aria-label="Narrow the Dashboard to one project">
            <button className={`db-scope-row ${scope === "all" ? "active" : ""}`} aria-pressed={scope === "all"} onClick={() => onScope("all")}>
              <span className="db-scope-dot all" />
              <span>All projects</span>
            </button>
            {projects.map((project) => (
              <button
                key={project.id}
                className={`db-scope-row ${scope === project.id ? "active" : ""}`}
                aria-pressed={scope === project.id}
                title={scope === project.id ? "Show every project again" : `Show only ${project.name}`}
                onClick={() => onScope(scope === project.id ? "all" : project.id)}
              >
                <ProjectAvatar projectId={project.id} size="xs" />
                <span>{project.name}</span>
                <small>{project.tasks.filter((task) => !task.done).length}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="db-sidebar-bottom">
        <div className="db-sidebar-note">
          <span className="db-live-dot" />A little clarity. A lot of progress.
          <p>Everything your team needs, in one place.</p>
          <button onClick={() => navigate("work", "overview")}>
            Go to your work <ArrowUpRight size={15} />
          </button>
        </div>
        <OrganizationMenu variant="sidebar" onOpenSettings={() => onSelect("settings")} />
      </div>
    </aside>
  );
}
