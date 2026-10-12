import type { ReactElement } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  AppWindow,
  ArrowsOutSimple,
  Airplane,
  Bell,
  Buildings,
  CalendarBlank,
  Camera,
  ChatCircle,
  CheckSquare,
  Clock,
  Gear,
  Headphones,
  Info,
  Moon,
  PaintBrushBroad,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Target,
  TextAa,
  User,
  UserCircle,
  UsersThree,
} from "@phosphor-icons/react";
import { BriefcaseBusiness, LayoutDashboard, MessagesSquare } from "lucide-react";
import { logos } from "../brand";
import { useWorkspace, type ViewMode } from "../workspace";
import { Avatar } from "./Avatar";
import { MenuButton, type MenuEntry } from "./MenuButton";
import { WindowControls } from "./WindowControls";
import { ToolbarSearch, type SearchCommand } from "./ToolbarSearch";
import type { Mode } from "../App";

const modes: { id: Mode; label: string; hint: string; icon: ReactElement }[] = [
  { id: "lounge", label: "Lounge", hint: "Chat with your team", icon: <MessagesSquare /> },
  { id: "work", label: "Work", hint: "Track your time and tasks", icon: <BriefcaseBusiness /> },
  { id: "dashboard", label: "Dashboard", hint: "Team progress and reports", icon: <LayoutDashboard /> },
];

const views: { id: ViewMode; label: string; detail: string; icon: ReactElement }[] = [
  { id: "full", label: "Full app", detail: "Everything, in a big window", icon: <ArrowsOutSimple /> },
  { id: "focus", label: "Focus mode", detail: "A small timer that stays in front", icon: <Target /> },
  { id: "easy", label: "Easy mode", detail: "Large text, just the basics", icon: <TextAa /> },
];

/** The app's header: the Lounge / Work / Dashboard switch on the left, the search in the middle,
 *  and the bell, Settings and profile on the right.
 *
 *  In the desktop shell the window has no native title bar, so this header is the window's whole
 *  top row: its empty space drags the window (double-click maximizes) and `WindowControls` sit
 *  flush at the right edge at the header's own height. In a browser it is an ordinary header.
 *
 *  The three modes are buttons like the window buttons (same size, same hover and press shading) and
 *  only the current one shows its name, so the switch stays narrow.
 *  The two small windows (Focus, Easy) share one View menu instead of taking two buttons. */
export function AppToolbar({
  mode,
  onModeChange,
  onOpenSettings,
  commands,
  inbox,
  onMarkAllRead,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  /** Opens Settings, on a given page if one is named. */
  onOpenSettings: (page?: string) => void;
  /** What the search can jump to. */
  commands: SearchCommand[];
  /** The inbox, for the bell's drop-down. */
  inbox: { id: string; title: string; description: string; read: boolean; open: () => void }[];
  onMarkAllRead: () => void;
}) {
  const desktop = isTauri();
  const { profile, setProfile, timer, navigate, preferences, setPreferences, viewMode, setViewMode } = useWorkspace();
  const unread = inbox.filter((item) => !item.read).length;
  // Everything on the right opens a drop-down under its own icon, like the View menu, never a dialog.
  const inboxEntries: MenuEntry[] = [
    { kind: "heading", label: unread ? `Inbox · ${unread} new` : "Inbox" },
    ...inbox.map((item): MenuEntry => ({ kind: "item", id: item.id, label: item.title, detail: item.description, icon: <Bell weight={item.read ? "regular" : "fill"} />, active: false, onSelect: item.open })),
    { kind: "item", id: "read-all", label: "Mark all as read", disabled: !unread, icon: <Bell />, onSelect: onMarkAllRead },
  ];
  // Settings differ by mode (see SettingsOverlay's layouts), so the gear lists the pages of the mode you
  // are in and each opens Settings straight on that page.
  const pages: Record<Mode, { id: string; label: string; detail: string; icon: ReactElement }[]> = {
    lounge: [
      { id: "account", label: "My account", detail: "Name, photo and status", icon: <UserCircle /> },
      { id: "privacy", label: "Privacy & safety", detail: "Who can message you", icon: <ShieldCheck /> },
      { id: "notifications", label: "Notifications", detail: "Badges and message sounds", icon: <Bell /> },
      { id: "voice", label: "Voice & audio", detail: "Microphone, speakers and volume", icon: <Headphones /> },
    ],
    work: [
      { id: "work", label: "Work preferences", detail: "Daily goal, timer and milliseconds", icon: <SlidersHorizontal /> },
      { id: "focus", label: "Focus & Easy mode", detail: "The two small windows", icon: <Target /> },
      { id: "notifications", label: "Reminders", detail: "When Soft Fix nudges you", icon: <Bell /> },
      { id: "account", label: "Account", detail: "Your profile", icon: <UserCircle /> },
    ],
    dashboard: [
      { id: "organization", label: "Organization", detail: "Name, time zone and your organizations", icon: <Buildings /> },
      { id: "tracking", label: "Activity & tracking", detail: "Screenshots, apps and sites", icon: <Camera /> },
      { id: "team", label: "Team permissions", detail: "Who can see and do what", icon: <UsersThree /> },
      { id: "integrations", label: "Integrations", detail: "Connected tools", icon: <Plug /> },
      { id: "notifications", label: "Notifications", detail: "What you are told about", icon: <Bell /> },
    ],
  };
  const quickEntries: MenuEntry[] = [
    { kind: "heading", label: "Settings" },
    ...pages[mode].map((page): MenuEntry => ({ kind: "item", id: page.id, label: page.label, detail: page.detail, icon: page.icon, onSelect: () => onOpenSettings(page.id) })),
    { kind: "heading", label: "Look" },
    { kind: "item", id: "appearance", label: "Appearance", detail: "Theme, text size and motion", icon: <PaintBrushBroad />, onSelect: () => onOpenSettings("appearance") },
    ...(
      [
        { id: "dark", label: "Dark theme", icon: <Moon /> },
        { id: "light", label: "Light theme", icon: <Sun /> },
        { id: "system", label: "Match my system", icon: <AppWindow /> },
      ] as const
    ).map((choice): MenuEntry => ({ kind: "item", id: choice.id, label: choice.label, icon: choice.icon, active: preferences.theme === choice.id, onSelect: () => setPreferences((old) => ({ ...old, theme: choice.id })) })),
    { kind: "heading", label: "Help" },
    { kind: "item", id: "about", label: "About & shortcuts", detail: "Version and keyboard shortcuts", icon: <Info />, onSelect: () => onOpenSettings("about") },
  ];
  const statuses = ["Available", "Focusing", "Away", "Offline"] as const;
  const client = profile.role === "Client";
  const profileEntries: MenuEntry[] = [
    { kind: "heading", label: `${profile.name} · ${profile.role}` },
    ...statuses.map((status): MenuEntry => ({ kind: "item", id: status, label: status, active: profile.status === status, icon: <i className={`toolbar-status ${status.toLowerCase()}`} />, onSelect: () => setProfile((old) => ({ ...old, status })) })),
    { kind: "heading", label: "Go to" },
    ...(client
      ? []
      : [
          { kind: "item" as const, id: "timesheet", label: "My timesheet", detail: "Your hours this week", icon: <Clock />, onSelect: () => navigate("work", "timesheet") },
          { kind: "item" as const, id: "tasks", label: "My tasks", detail: "What is on your plate", icon: <CheckSquare />, onSelect: () => navigate("work", "tasks") },
          { kind: "item" as const, id: "schedule", label: "My schedule", detail: "Your planned day", icon: <CalendarBlank />, onSelect: () => navigate("work", "schedule") },
        ]),
    { kind: "item", id: "calendar", label: "Team calendar", detail: "Deadlines, reviews and time off", icon: <CalendarBlank />, onSelect: () => navigate("dashboard", "calendar") },
    ...(client ? [] : [{ kind: "item" as const, id: "timeoff", label: "Request time off", detail: "Ask for a day away", icon: <Airplane />, onSelect: () => navigate("dashboard", "calendar-timeoff") }]),
    { kind: "item", id: "messages", label: "Messages", detail: "Your conversations in the Lounge", icon: <ChatCircle />, onSelect: () => navigate("lounge", "messages") },
    { kind: "heading", label: "Account" },
    { kind: "item", id: "profile", label: "Profile & account", detail: profile.email, icon: <User />, onSelect: () => onOpenSettings("account") },
  ];
  const viewEntries: MenuEntry[] = [
    { kind: "heading", label: "Window" },
    ...views.map((view) => ({
      kind: "item" as const,
      id: view.id,
      label: view.label,
      detail: view.detail,
      icon: view.icon,
      active: viewMode === view.id,
      onSelect: () => setViewMode(view.id),
    })),
  ];
  return (
    <header
      className={`app-toolbar ${desktop ? "in-title-bar" : ""} mode-${mode}`}
      data-tauri-drag-region="deep"
    >
      <div className="toolbar-left">
        <div className="toolbar-brand" role="img" aria-label="Soft Fix">
          <span className="logo-wordmarks" aria-hidden="true">
            <span className="logo-crop logo-wordmark on-dark">
              <img src={logos.wordmarkOnDark} alt="" draggable={false} />
            </span>
            <span className="logo-crop logo-wordmark on-light">
              <img src={logos.wordmarkOnLight} alt="" draggable={false} />
            </span>
          </span>
          <span className="logo-crop logo-mark" aria-hidden="true">
            <img src={logos.mark} alt="" draggable={false} />
          </span>
        </div>
        <nav className="app-toolbar-modes" aria-label="Modes">
          {modes.map((entry) => (
            <button
              key={entry.id}
              className={`app-toolbar-mode ${mode === entry.id ? "active" : ""}`}
              aria-pressed={mode === entry.id}
              aria-label={entry.label}
              title={`${entry.label}: ${entry.hint}`}
              onClick={() => onModeChange(entry.id)}
            >
              {entry.icon}
              <span>{entry.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="toolbar-center">
        <ToolbarSearch commands={commands} />
      </div>

      <div className="toolbar-right">
        <div className="toolbar-actions">
          {timer.startedAt && (
            <button className="toolbar-timer" onClick={() => navigate("work", "overview")}>
              <i /> Timer running
            </button>
          )}
          <MenuButton label="Change the window" title="Window: full app, Focus or Easy mode" align="end" className="toolbar-menu" entries={viewEntries}>
            <AppWindow />
          </MenuButton>
          <MenuButton label={`Notifications, ${unread} unread`} title="Notifications" align="end" fixed className="toolbar-menu toolbar-bell" entries={inboxEntries}>
            <Bell weight={unread && preferences.notifications ? "fill" : "regular"} />
            {unread > 0 && preferences.notifications && <i className="toolbar-dot" aria-hidden="true" />}
          </MenuButton>
          <MenuButton label="Quick settings" title="Settings" align="end" fixed className="toolbar-menu" entries={quickEntries}>
            <Gear />
          </MenuButton>
          <MenuButton label="Your profile" title="Profile and status" align="end" fixed className="toolbar-menu toolbar-profile-menu" entries={profileEntries}>
            <Avatar
              initials={profile.name
                .split(" ")
                .map((word) => word[0])
                .slice(0, 2)
                .join("")}
              color="blue"
              size="sm"
            />
          </MenuButton>
        </div>
        {desktop && <WindowControls />}
      </div>
    </header>
  );
}
