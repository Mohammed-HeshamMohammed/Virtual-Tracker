import type { ReactElement } from "react";
import { ChartBar, Clock, CurrencyDollar, Folder, Gear, Lightning, SquaresFour, UsersThree } from "@phosphor-icons/react";
import { navSections } from "../../data/dashboard";

const icons: Record<string, ReactElement> = {
  dashboard: <SquaresFour weight="fill" />,
  timesheets: <Clock weight="fill" />,
  activity: <Lightning weight="fill" />,
  "project-management": <Folder weight="fill" />,
  reports: <ChartBar weight="fill" />,
  people: <UsersThree weight="fill" />,
  financials: <CurrencyDollar weight="fill" />,
  settings: <Gear weight="fill" />
};

type Props = { activeSection: string; onSelect: (id: string) => void };

/** The dashboard's own left nav, copied from Dashboard-Web's real section list
 *  (shared/ui/layout/config/nav-sections.ts) in structure and wording. */
export function DashboardSidebar({ activeSection, onSelect }: Props) {
  return (
    <aside className="dashboard-sidebar">
      <div className="dashboard-brand"><strong>My Virtual Tracker</strong><small>PRODUCTIVITY SUITE</small></div>
      <nav className="dashboard-nav">
        {navSections.map(section => (
          <button key={section.id} className={activeSection === section.id ? "active" : ""} onClick={() => onSelect(section.id)}>
            {icons[section.id]}<span>{section.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
