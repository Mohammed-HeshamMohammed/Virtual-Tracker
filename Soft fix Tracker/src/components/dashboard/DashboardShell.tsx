import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DashboardHome } from "./DashboardHome";
import { DashboardSidebar } from "./DashboardSidebar";
import { DashboardTopbar } from "./DashboardTopbar";
import { TimesheetsPage } from "./TimesheetsPage";
import { ActivityPage } from "./ActivityPage";
import { ProjectsPage } from "./ProjectsPage";
import { ReportsPage } from "./ReportsPage";
import { PeoplePage } from "./PeoplePage";
import { FinancialsPage } from "./FinancialsPage";
import { AppsPage, RemovalRequestsPage, ScreenshotsPage, ToolsPage, UrlsPage } from "./pages/ActivityPages";
import { CreatePaymentPage, ExpensesPage, FinanceOverviewPage, PaymentRecordsPage, PayrollPage } from "./pages/FinancePages";
import type { PageContext } from "./pages/kit";
import { NotificationsPage } from "./pages/OverviewPages";
import { BannedMembersPage, CustomerAccountsPage, TeamsPage } from "./pages/PeoplePages";
import { ClientsPage, PmOverviewPage, TasksPage, TimeOffPage } from "./pages/ProjectPages";
import { CalendarPage } from "./pages/CalendarPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ReportPage, ReportsHubPage } from "./pages/ReportPages";
import { ManualRequestsPage, TaskApprovalsPage, TimeActivityPage } from "./pages/TimesheetPages";
import { useWorkspace, downloadCsv, usePersistentState } from "../../workspace";
import type { MenuEntry } from "../MenuButton";
import {
  isReportPage,
  isSection,
  navSections,
  pageAllowed,
  pagesFor,
  reportGroups,
  reportLabel,
  resolvePage,
  sectionAllowed,
  sectionOfPage,
  type DashboardSection,
} from "../../data/dashboard";
import "./dashboard.css";
import "./dashboard-style.css";
import "./dashboard-pages.css";
/** Pages that are opened from another page (a form, one record), so the page menu leaves them out. */
const HIDDEN_PAGES = ["pm-new", "pm-project"];

export function DashboardShell({
  onOpenSettings,
}: {
  onOpenSettings?: () => void;
}) {
  const {
    route,
    navigate,
    projects,
    sessions,
    members,
    profile,
    preferences,
    notify,
  } = useWorkspace();
  const [range, setRange] = useState("week");
  const role = profile.role;
  const [storedScope, setScope] = usePersistentState<string>("dashboard.projectScope", "all");
  const raw = route.dashboardSection;
  // What the route names is a section ("timesheets") or a page ("timesheets-submissions"); either
  // way, show a page this role may open.
  const pageId = resolvePage(role, raw);
  const section: DashboardSection = sectionOfPage(pageId) ?? "dashboard";
  const routeOk = isSection(raw) ? sectionAllowed(role, raw) : sectionOfPage(raw) !== null && pageAllowed(role, raw);
  useEffect(() => {
    if (route.mode !== "dashboard") return;
    if (raw === "settings") {
      onOpenSettings?.();
      navigate("dashboard", "dashboard");
    } else if (!routeOk) navigate("dashboard", "dashboard");
  }, [route.mode, raw, routeOk, navigate, onOpenSettings]);
  const canManage = ["Owner", "Admin", "Manager"].includes(role);
  const isAdmin = ["Owner", "Admin"].includes(role);
  /** The projects this role may see. A client's list is just their own. */
  const visibleProjects =
    role === "Client"
      ? projects.filter((project) => project.id === "buffalo-campaign")
      : projects;
  /** The sidebar's project list narrows every page to one project (or, as "all", to none in particular). */
  const scope = visibleProjects.some((project) => project.id === storedScope) ? storedScope : "all";
  const scopedProjects = scope === "all" ? visibleProjects : visibleProjects.filter((project) => project.id === scope);
  /** What this role may see, over all time and across every project. */
  const unscopedSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          (role !== "Member" || session.memberId === "me") &&
          (role !== "Client" || session.projectId === "buffalo-campaign") &&
          (role !== "Manager" ||
            session.memberId === "me" ||
            ["Manager", "Member"].includes(
              members.find((member) => member.id === session.memberId)?.role ||
                "",
            )),
      ),
    [sessions, role, members],
  );
  /** ...narrowed to the project the sidebar is scoped to. */
  const roleSessions = useMemo(() => (scope === "all" ? unscopedSessions : unscopedSessions.filter((session) => session.projectId === scope)), [unscopedSessions, scope]);
  /** ...and inside the date range the top bar has selected. */
  const scopedSessions = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (range === "week")
      start.setDate(
        start.getDate() -
          (preferences.weekStart === "Sunday"
            ? start.getDay()
            : preferences.weekStart === "Saturday"
              ? (start.getDay() + 1) % 7
              : (start.getDay() + 6) % 7),
      );
    if (range === "month") start.setDate(1);
    return roleSessions.filter(
      (session) => range === "all" || new Date(session.startedAt) >= start,
    );
  }, [roleSessions, range, preferences.weekStart]);
  const go = (page: string, target?: string) =>
    page === "settings" ? onOpenSettings?.() : navigate("dashboard", page, target);
  const select = (next: DashboardSection) =>
    next === "settings" ? onOpenSettings?.() : navigate("dashboard", next);
  const exportData = () => {
    downloadCsv("softfix-workspace.csv", [
      ["Member", "Project", "Task", "Started", "Hours", "Status"],
      ...scopedSessions.map((session) => [
        members.find((member) => member.id === session.memberId)?.name ||
          "Team member",
        projects.find((project) => project.id === session.projectId)?.name ||
          "Archived",
        session.taskTitle,
        session.startedAt,
        (session.seconds / 3600).toFixed(2),
        session.status,
      ]),
    ]);
    notify("Dashboard data downloaded.");
  };
  const ctx: PageContext = {
    sessions: scopedSessions,
    allSessions: roleSessions,
    projects: scopedProjects,
    visibleProjects,
    unscopedSessions,
    role,
    canManage,
    isAdmin,
    range,
    projectScope: scope,
    go,
  };
  const sectionLabel = navSections.find((entry) => entry.id === section)?.label ?? "Overview";
  const pages = pagesFor(role, section);
  // The page menu: this section's pages, and for Reports the whole report list under its groups.
  const pageMenu: MenuEntry[] = [
    ...pages.filter((page) => !HIDDEN_PAGES.includes(page.id)).map((page): MenuEntry => ({ kind: "item", id: page.id, label: page.label, active: pageId === page.id, onSelect: () => go(page.id) })),
    ...(section === "reports"
      ? reportGroups.flatMap((group): MenuEntry[] => {
          const reports = group.reports.filter((report) => pageAllowed(role, report.id));
          return reports.length
            ? [{ kind: "heading", label: group.label }, ...reports.map((report): MenuEntry => ({ kind: "item", id: report.id, label: report.label, active: pageId === report.id, onSelect: () => go(report.id) }))]
            : [];
        })
      : []),
  ];

  const pageFor = (id: string): ReactNode => {
    if (isReportPage(id)) return <ReportPage id={id} ctx={ctx} />;
    switch (id) {
      case "notifications":
        return <NotificationsPage ctx={ctx} />;
      case "timesheets-time-activity":
        return <TimeActivityPage ctx={ctx} />;
      case "timesheets-view":
        return <TaskApprovalsPage ctx={ctx} />;
      case "timesheets-submissions":
        return <TimesheetsPage sessions={scopedSessions} canManage={canManage} />;
      case "timesheets-manual-requests":
        return <ManualRequestsPage ctx={ctx} />;
      case "activity-overview":
        return <ActivityPage sessions={scopedSessions} />;
      case "activity-screenshots":
        return <ScreenshotsPage ctx={ctx} />;
      case "activity-apps":
        return <AppsPage ctx={ctx} />;
      case "activity-urls":
        return <UrlsPage ctx={ctx} />;
      case "activity-tools":
        return <ToolsPage ctx={ctx} />;
      case "activity-removal-requests":
        return <RemovalRequestsPage ctx={ctx} />;
      case "pm-overview":
        return <PmOverviewPage ctx={ctx} />;
      case "pm-projects":
        return <ProjectsPage ctx={ctx} />;
      case "pm-project":
        return <ProjectPage ctx={ctx} />;
      case "pm-tasks":
        return <TasksPage ctx={ctx} />;
      case "pm-new":
        return <NewProjectPage ctx={ctx} />;
      case "pm-clients":
        return <ClientsPage ctx={ctx} />;
      case "calendar-view":
        return <CalendarPage ctx={ctx} />;
      case "calendar-timeoff":
        return <TimeOffPage ctx={ctx} />;
      case "reports-all":
        return <ReportsHubPage ctx={ctx} />;
      case "reports-custom":
        return <ReportsPage sessions={scopedSessions} />;
      case "people-members":
        return <PeoplePage sessions={scopedSessions} canManage={canManage} />;
      case "people-members-tree":
        return <PeoplePage sessions={scopedSessions} canManage={canManage} initialView="hierarchy" />;
      case "people-teams":
        return <TeamsPage ctx={ctx} />;
      case "people-member-bans":
        return <BannedMembersPage />;
      case "people-customer-accounts":
        return <CustomerAccountsPage ctx={ctx} />;
      case "financials-overview":
        return <FinanceOverviewPage ctx={ctx} />;
      case "financials-payroll":
        return <PayrollPage ctx={ctx} />;
      case "financials-create":
        return <CreatePaymentPage ctx={ctx} />;
      case "financials-records":
        return <PaymentRecordsPage ctx={ctx} />;
      case "financials-invoices":
        return <FinancialsPage canManage={isAdmin} />;
      case "financials-expenses":
        return <ExpensesPage ctx={ctx} />;
      default:
        return <DashboardHome ctx={ctx} />;
    }
  };

  return (
    <div className="sf-mode-layout db-layout">
      <DashboardSidebar activeSection={section} onSelect={select} projects={visibleProjects} scope={scope} onScope={setScope} />
      <main className="sf-main db-main">
        <DashboardTopbar
          sectionLabel={sectionLabel}
          pageLabel={pageId === "pm-new" && route.target ? "Edit project" : pageId === "pm-project" ? (visibleProjects.find((project) => project.id === route.target)?.name ?? "Project") : pages.find((page) => page.id === pageId)?.label ?? (isReportPage(pageId) ? reportLabel(pageId) : "")}
          pageMenu={pageMenu}
          scopeName={scope === "all" ? undefined : scopedProjects[0]?.name}
          onClearScope={() => setScope("all")}
          range={range}
          onRangeChange={setRange}
          onExport={exportData}
        />
        <div className="db-content" key={pageId}>
          {pageFor(pageId)}
        </div>
      </main>
    </div>
  );
}
