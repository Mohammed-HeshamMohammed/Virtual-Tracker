import { useState } from "react";
import { DashboardHome } from "./DashboardHome";
import { DashboardSidebar } from "./DashboardSidebar";
import { DashboardTopbar } from "./DashboardTopbar";

/** Dashboard mode: the web dashboard's own UI, copied in structure and content from
 *  Dashboard-Web (sidebar sections, topbar, Command Center) into this app's design system.
 *  Presentational only - it does not sign in, call the real API, or embed the live site. */
export function DashboardShell() {
  const [section, setSection] = useState("dashboard");
  return (
    <>
      <DashboardSidebar activeSection={section} onSelect={setSection} />
      <div className="dashboard-main">
        <DashboardTopbar activeSection={section} />
        {section === "dashboard" ? <DashboardHome /> : (
          <div className="dashboard-content dashboard-placeholder"><p>{section} is not part of this UI copy yet.</p></div>
        )}
      </div>
    </>
  );
}
