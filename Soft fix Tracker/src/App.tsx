import { useEffect, useLayoutEffect, useState } from "react";
import { ProjectAvatar } from "./components/ProjectAvatar";
import { AppToolbar } from "./components/AppToolbar";
import { DashboardShell } from "./components/dashboard/DashboardShell";
import { LoungeShell } from "./components/LoungeShell";
import { ChatDock } from "./components/chat/ChatDock";
import { EasyShell } from "./components/mode/EasyShell";
import { FocusShell } from "./components/mode/FocusShell";
import { SettingsOverlay } from "./components/SettingsOverlay";
import { WorkShell } from "./components/work/WorkShell";
import {
  WorkspaceProvider,
  useWorkspace,
  usePersistentState,
  type Mode,
} from "./workspace";
import { applyViewMode, onTrayViewMode, syncShellPrefs } from "./shell-bridge";
import { OrganizationsProvider, useOrganizations } from "./organizations";
import { installDataMotion } from "./data-motion";
import { CheckCircle, Folder, Gear, Timer, Users } from "@phosphor-icons/react";

export type { Mode } from "./workspace";

function WorkspaceApp() {
  const { route, navigate, projects, members, notice, notify, viewMode, setViewMode, preferences } = useWorkspace();
  const mode = route.mode;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<string | undefined>();
  /** Opens Settings, on a given page if one is named (the title bar's menus forward to specific ones). */
  const openSettings = (page?: string) => {
    setSettingsPage(page);
    setSettingsOpen(true);
  };
  const [read, setRead] = usePersistentState<string[]>(
    "read-notifications",
    [],
  );
  const notifications: {
    id: string;
    title: string;
    description: string;
    mode: Mode;
    section: string;
  }[] = [
    {
      id: "timesheet",
      title: "A timesheet is ready for review",
      description: "Sara submitted her latest work session.",
      mode: "dashboard",
      section: "timesheets-submissions",
    },
    {
      id: "lounge",
      title: "Meet your team in the Lounge",
      description:
        "Your coworkers, project rooms, and conversations in one place.",
      mode: "lounge",
      section: "home",
    },
    {
      id: "tasks",
      title: "Make room for focused work",
      description: "Review your tasks and choose what to work on next.",
      mode: "work",
      section: "tasks",
    },
  ];
  // The desktop window takes the shape of the current mode (a small docked window for Focus, and
  // so on), and the tray menu can switch modes from outside the page.
  useEffect(() => {
    applyViewMode(viewMode);
  }, [viewMode]);
  useEffect(() => {
    syncShellPrefs(preferences.keepInTray, preferences.focusOnTop);
  }, [preferences.keepInTray, preferences.focusOnTop]);
  useEffect(() => onTrayViewMode(setViewMode), [setViewMode]);
  const commands = [
    {
      label: "My work",
      detail: "Timer and today's overview",
      icon: Timer,
      action: () => navigate("work", "overview"),
    },
    {
      label: "My tasks",
      detail: "Plan and complete your work",
      icon: CheckCircle,
      action: () => navigate("work", "tasks"),
    },
    {
      label: "Lounge",
      detail: "Coworkers and project conversations",
      icon: Users,
      action: () => navigate("lounge", "home"),
    },
    {
      label: "Dashboard",
      detail: "Team productivity and project health",
      icon: Folder,
      action: () => navigate("dashboard", "dashboard"),
    },
    ...["Timesheets", "Activity", "Reports", "People", "Financials"].map(
      (label) => ({
        label,
        detail: "Dashboard",
        icon: Folder,
        action: () => navigate("dashboard", label.toLowerCase()),
      }),
    ),
    ...projects.map((project) => ({
      label: project.name,
      detail: "Open project in the Dashboard",
      icon: () => <ProjectAvatar projectId={project.id} size="xs" />,
      action: () => navigate("dashboard", "pm-project", project.id),
    })),
    ...members
      .filter((member) => member.id !== "me")
      .map((member) => ({
        label: member.name,
        detail: `Message · ${member.team}`,
        icon: Users,
        action: () => navigate("lounge", "messages", member.id),
      })),
    {
      label: "Settings",
      detail: "Profile, appearance, and preferences",
      icon: Gear,
      action: () => openSettings(),
    },
  ];

  if (viewMode !== "full") {
    return (
      <div className={`shell-root view-${viewMode}`}>
        {viewMode === "focus" ? <FocusShell /> : <EasyShell />}
        {notice && (
          <div className="app-toast" role="status">
            <CheckCircle size={20} weight="fill" />
            {notice}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="shell-root">
      <a className="skip-link" href="#workspace-content" onClick={event => { event.preventDefault(); document.getElementById("workspace-content")?.focus(); }}>
        Skip to content
      </a>
      <AppToolbar
        mode={mode}
        onModeChange={(next) => navigate(next)}
        onOpenSettings={openSettings}
        commands={commands}
        inbox={notifications.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          read: read.includes(item.id),
          open: () => {
            setRead((old) => [...new Set([...old, item.id])]);
            navigate(item.mode, item.section);
          },
        }))}
        onMarkAllRead={() => {
          setRead(notifications.map((item) => item.id));
          notify("All notifications marked as read");
        }}
      />
      <div
        className={`app-shell mode-${mode}`}
        id="workspace-content"
        tabIndex={-1}
      >
        {/* Keep each mode mounted so timer, draft, selection, and scroll state survive navigation. */}
        <div className="mode-pane" hidden={mode !== "lounge"}>
          <LoungeShell onOpenSettings={() => openSettings()} />
        </div>
        <div className="mode-pane" hidden={mode !== "work"}>
          <WorkShell />
        </div>
        <div className="mode-pane" hidden={mode !== "dashboard"}>
          <DashboardShell onOpenSettings={() => openSettings()} />
        </div>
      </div>
      {settingsOpen ? (
        <SettingsOverlay page={settingsPage} onClose={() => setSettingsOpen(false)} />
      ) : null}
      {notice && (
        <div className="app-toast" role="status">
          <CheckCircle size={20} weight="fill" />
          {notice}
        </div>
      )}
      {mode !== "lounge" && <ChatDock />}
    </div>
  );
}

/** Each organization is a workspace of its own: switching to another mounts a fresh one that reads that
 *  organization's data. */
function Workspaces() {
  const { active } = useOrganizations();
  return (
    <WorkspaceProvider key={active.id}>
      <WorkspaceApp />
    </WorkspaceProvider>
  );
}

export default function App() {
  // A layout effect, so figures are put at zero before the first paint (an ordinary effect runs after
  // it, and the real values would flash first).
  useLayoutEffect(() => installDataMotion(), []);
  return (
    <OrganizationsProvider>
      <Workspaces />
    </OrganizationsProvider>
  );
}
