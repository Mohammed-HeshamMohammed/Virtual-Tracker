import { Bell, MagnifyingGlass, Play, Question } from "@phosphor-icons/react";
import { navSections } from "../../data/dashboard";

/** Breadcrumb + search + notifications, matching Dashboard-Web's real topbar. */
export function DashboardTopbar({ activeSection }: { activeSection: string }) {
  const section = navSections.find(entry => entry.id === activeSection);
  return (
    <header className="dashboard-topbar">
      <span className="dashboard-breadcrumb"><span>Dashboard</span><i>›</i><strong>{activeSection === "dashboard" ? "Command Center" : section?.label}</strong></span>
      <label className="people-search dashboard-search"><MagnifyingGlass /><input placeholder="Search pages, buttons, reports..." readOnly /></label>
      <div className="dashboard-topbar-actions">
        <button className="dock-tooltip" data-tooltip="Notifications"><Bell weight="fill" /><b>99+</b></button>
        <button className="dock-tooltip" data-tooltip="Help"><Question /></button>
        <button className="dashboard-start" title="Start tracking"><Play weight="fill" /></button>
      </div>
    </header>
  );
}
