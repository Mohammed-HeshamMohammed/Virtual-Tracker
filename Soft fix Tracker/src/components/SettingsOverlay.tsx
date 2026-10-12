import { useState, type ReactNode } from "react";
import {
  Bell,
  Buildings,
  CalendarBlank,
  Camera,
  Check,
  Cloud,
  DownloadSimple,
  GearSix,
  HardDrives,
  Headphones,
  PaintBrushBroad,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  UserCircle,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";
import { Avatar } from "./Avatar";
import { Modal } from "./ui";
import { easyScales } from "./mode/EasyShell";
import { isOpenOrgKey, peekOrg, useOrganizations, type Organization } from "../organizations";
import { NewOrganizationDialog, orgInitial } from "./OrganizationMenu";
import { Plus } from "lucide-react";
import {
  useWorkspace,
  usePersistentState,
  type Preferences,
  type Member,
  type Mode,
} from "../workspace";
import "./settings.css";

type CategoryId =
  | "account"
  | "privacy"
  | "notifications"
  | "voice"
  | "appearance"
  | "about"
  | "work"
  | "focus"
  | "data"
  | "storage"
  | "organization"
  | "schedules"
  | "tracking"
  | "team"
  | "integrations";
const icons: Record<CategoryId, Icon> = {
  account: UserCircle,
  privacy: ShieldCheck,
  notifications: Bell,
  voice: Headphones,
  appearance: PaintBrushBroad,
  about: GearSix,
  work: SlidersHorizontal,
  focus: Target,
  data: ShieldCheck,
  storage: HardDrives,
  organization: Buildings,
  schedules: CalendarBlank,
  tracking: Camera,
  team: UsersThree,
  integrations: Plug,
};
type Layout = {
  title: string;
  description: string;
  /** The category that opens first. */
  landing: CategoryId;
  groups: { label: string; items: { id: CategoryId; label: string }[] }[];
};
/** Settings is not one list for the whole app: each mode shows the settings that belong to it, in
 *  the order that suits it. The Lounge is a chat app (profile, privacy, voice), Work is about the
 *  workday and the timer, and the Dashboard is about running the workspace. */
const layouts: Record<Mode, Layout> = {
  lounge: {
    title: "User settings",
    description: "Your profile, privacy, voice and how the Lounge looks.",
    landing: "account",
    groups: [
      {
        label: "User settings",
        items: [
          { id: "account", label: "My account" },
          { id: "privacy", label: "Privacy & safety" },
          { id: "notifications", label: "Notifications" },
          { id: "voice", label: "Voice & audio" },
        ],
      },
      {
        label: "App settings",
        items: [
          { id: "appearance", label: "Appearance" },
          { id: "about", label: "About & shortcuts" },
        ],
      },
    ],
  },
  work: {
    title: "Work settings",
    description: "Your workday, the timer and your reminders.",
    landing: "work",
    groups: [
      {
        label: "Your workday",
        items: [
          { id: "work", label: "Work preferences" },
          { id: "focus", label: "Focus & Easy mode" },
          { id: "notifications", label: "Reminders" },
        ],
      },
      {
        label: "You",
        items: [
          { id: "account", label: "Account" },
          { id: "appearance", label: "Appearance" },
          { id: "data", label: "Data & privacy" },
          { id: "storage", label: "Storage & sync" },
          { id: "about", label: "About Soft Fix" },
        ],
      },
    ],
  },
  dashboard: {
    title: "Dashboard settings",
    description: "Your workspace, how it tracks and who can see what.",
    landing: "organization",
    groups: [
      {
        label: "Workspace",
        items: [
          { id: "organization", label: "Organization" },
          { id: "schedules", label: "Schedules" },
          { id: "tracking", label: "Activity & tracking" },
          { id: "team", label: "Team permissions" },
          { id: "integrations", label: "Integrations" },
        ],
      },
      {
        label: "Account & data",
        items: [
          { id: "notifications", label: "Notifications" },
          { id: "data", label: "Data & privacy" },
          { id: "storage", label: "Storage & sync" },
          { id: "appearance", label: "Appearance" },
          { id: "account", label: "Account" },
          { id: "about", label: "About Soft Fix" },
        ],
      },
    ],
  },
};
/** The toggles on the Notifications page, which differ because each mode notifies about
 *  different things. They all save to the same three preferences. */
const notificationCopy: Record<Mode, { intro: string; toggles: { key: "notifications" | "sounds" | "weeklyDigest"; title: string; description: string }[] }> = {
  lounge: {
    intro: "Choose how the Lounge lets you know about messages. Preferences are saved locally.",
    toggles: [
      { key: "notifications", title: "Unread badges", description: "Show the unread indicator in the top bar." },
      { key: "sounds", title: "Message sounds", description: "Save your sound preference for new messages." },
    ],
  },
  work: {
    intro: "Choose the reminders you want while you work. Preferences are saved locally.",
    toggles: [
      { key: "notifications", title: "Reminders", description: "Show the unread indicator in the top bar." },
      { key: "sounds", title: "Reminder sounds", description: "Save your sound preference for timer reminders." },
      { key: "weeklyDigest", title: "Weekly summary", description: "Include your weekly progress in the updates you get." },
    ],
  },
  dashboard: {
    intro: "Choose what the Dashboard tells you about. Preferences are saved locally.",
    toggles: [
      { key: "notifications", title: "Review requests", description: "Show the unread indicator when timesheets, requests or invoices need you." },
      { key: "weeklyDigest", title: "Weekly team summary", description: "Include team progress in the updates you get." },
      { key: "sounds", title: "Notification sounds", description: "Save your sound preference for workspace updates." },
    ],
  },
};
const timeZones = ["Africa/Cairo", "Europe/London", "America/New_York", "Asia/Dubai", "Asia/Kolkata", "UTC"];
function Toggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="st-toggle">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="st-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
export function SettingsOverlay({ onClose, page }: { onClose: () => void; /** A page to open on, if this mode has it; otherwise the mode's own first page. */ page?: string }) {
  const {
    profile,
    setProfile,
    members,
    setMembers,
    preferences,
    setPreferences,
    viewMode,
    setViewMode,
    projects,
    sessions,
    navigate,
    notify,
    route,
  } = useWorkspace();
  const mode: Mode = route.mode in layouts ? route.mode : "work";
  const layout = layouts[mode];
  const notifications = notificationCopy[mode];
  const [active, setActive] = useState<CategoryId>(() => (layout.groups.some((group) => group.items.some((item) => item.id === page)) ? (page as CategoryId) : layout.landing));
  const { orgs, active: openOrg, switchTo: switchOrg, rename: renameOrg, remove: removeOrg } = useOrganizations();
  const [orgName, setOrgName] = useState(openOrg.name);
  const [orgError, setOrgError] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [deletingOrg, setDeletingOrg] = useState<Organization | null>(null);
  const labelOf = (id: CategoryId) => layout.groups.flatMap((group) => group.items).find((item) => item.id === id)?.label ?? "Settings";
  const [draft, setDraft] = useState(profile);
  const [audio, setAudio] = usePersistentState("audio-preferences", {
    input: "System default",
    output: "System default",
    volume: 75,
    noise: true,
    pushToTalk: false,
  });
  const [integrations, setIntegrations] = usePersistentState<
    Record<string, string>
  >("integration-preferences", {});
  const [integration, setIntegration] = useState("");
  const [integrationValue, setIntegrationValue] = useState("");
  const [backup, setBackup] = usePersistentState<string>("last-backup", "");
  const setPreference = <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => setPreferences((old) => ({ ...old, [key]: value }));
  const fields = {
    dailyGoal: (
      <label key="dailyGoal">
        Daily goal
        <select className="sf-input" value={preferences.dailyGoal} onChange={(event) => setPreference("dailyGoal", Number(event.target.value))}>
          {[4, 6, 7, 8, 9, 10].map((hours) => (
            <option value={hours} key={hours}>
              {hours} hours
            </option>
          ))}
        </select>
      </label>
    ),
    startOfDay: (
      <label key="startOfDay">
        Start of workday
        <input className="sf-input" type="time" value={preferences.startOfDay} onChange={(event) => setPreference("startOfDay", event.target.value)} />
      </label>
    ),
    timezone: (
      <label key="timezone">
        Time zone
        <select className="sf-input" value={preferences.timezone} onChange={(event) => setPreference("timezone", event.target.value)}>
          {timeZones.map((zone) => (
            <option key={zone}>{zone}</option>
          ))}
        </select>
      </label>
    ),
    weekStart: (
      <label key="weekStart">
        First day of the week
        <select className="sf-input" value={preferences.weekStart} onChange={(event) => setPreference("weekStart", event.target.value)}>
          <option>Monday</option>
          <option>Sunday</option>
          <option>Saturday</option>
        </select>
      </label>
    ),
  };
  function exportWorkspace() {
    const uiState: Record<string, unknown> = {};
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key && isOpenOrgKey(key)) {
        try {
          uiState[key] = JSON.parse(localStorage.getItem(key) || "null");
        } catch {}
      }
    }
    const data = {
      version: 2,
      exportedAt: new Date().toISOString(),
      profile,
      preferences,
      projects,
      members,
      sessions,
      uiState,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "soft-fix-workspace.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackup(new Date().toISOString());
    notify("Workspace exported to your downloads");
  }
  return (
    <Modal
      title={layout.title}
      description={layout.description}
      className={`st-for-${mode}`}
      onClose={onClose}
      wide
    >
      <div className="st-layout">
        <nav className="st-nav" aria-label="Settings categories">
          {layout.groups.map((group) => (
            <div className="st-nav-group" role="group" aria-label={group.label} key={group.label}>
              <span className="st-nav-heading">{group.label}</span>
              {group.items.map(({ id, label }) => {
                const Icon = icons[id];
                return (
                  <button key={id} className={active === id ? "active" : ""} aria-current={active === id ? "page" : undefined} onClick={() => setActive(id)}>
                    <Icon size={18} />
                    {label}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="st-local">
            <span className="st-dot" />
            Local workspace preview
          </div>
        </nav>
        <div className="st-content">
          <h2>{labelOf(active)}</h2>
          {active === "account" && (
            <>
              <div className="st-profile">
                <Avatar
                  initials={profile.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                  size="lg"
                  color="blue"
                />
                <div>
                  <strong>{profile.name}</strong>
                  <small>{profile.title}</small>
                </div>
                <span className="sf-badge blue">{profile.role}</span>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const clean = {
                    ...draft,
                    name: draft.name.trim(),
                    title: draft.title.trim(),
                  };
                  if (!clean.name) return;
                  setProfile(clean);
                  setMembers((old) =>
                    old.map((member) =>
                      member.id === "me"
                        ? {
                            ...member,
                            name: clean.name,
                            email: clean.email,
                            status: clean.status as Member["status"],
                            initials: clean.name
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join(""),
                          }
                        : member,
                    ),
                  );
                  notify("Profile updated across your workspace");
                }}
              >
                <label>
                  Display name
                  <input
                    className="sf-input"
                    required
                    maxLength={60}
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Work email
                  <input
                    className="sf-input"
                    required
                    type="email"
                    value={draft.email}
                    onChange={(event) =>
                      setDraft({ ...draft, email: event.target.value })
                    }
                  />
                </label>
                <label>
                  Job title
                  <input
                    className="sf-input"
                    maxLength={80}
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                  />
                </label>
                <label>
                  Status
                  <select
                    className="sf-input"
                    value={draft.status}
                    onChange={(event) =>
                      setDraft({ ...draft, status: event.target.value })
                    }
                  >
                    {["Available", "Focusing", "Away", "Offline"].map(
                      (status) => (
                        <option key={status}>{status}</option>
                      ),
                    )}
                  </select>
                </label>
                <div className="sf-form-actions">
                  <button className="sf-button primary">Save changes</button>
                </div>
              </form>
            </>
          )}
          {active === "appearance" && (
            <>
              <p className="st-description">
                Choose a workspace that feels right for you.
              </p>
              <div className="st-themes">
                {(["dark", "light", "system"] as const).map((theme) => (
                  <button
                    key={theme}
                    aria-pressed={preferences.theme === theme}
                    className={preferences.theme === theme ? "selected" : ""}
                    onClick={() => setPreference("theme", theme)}
                  >
                    <span className={`st-theme-preview ${theme}`}>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>
                      {theme[0].toUpperCase() + theme.slice(1)}
                      {preferences.theme === theme && <Check size={16} />}
                    </span>
                  </button>
                ))}
              </div>
              <Section title="Comfort & accessibility">
                <Toggle
                  title="Compact spacing"
                  description="Fit more information into cards and pages."
                  checked={preferences.compact}
                  onChange={(value) => setPreference("compact", value)}
                />
                <Toggle
                  title="Reduce motion"
                  description="Keep transitions and animations to a minimum."
                  checked={preferences.reducedMotion}
                  onChange={(value) => setPreference("reducedMotion", value)}
                />
              </Section>
            </>
          )}
          {active === "notifications" && (
            <>
              <p className="st-description">{notifications.intro}</p>
              <Section title="Updates">
                {notifications.toggles.map((toggle) => (
                  <Toggle key={toggle.key} title={toggle.title} description={toggle.description} checked={preferences[toggle.key]} onChange={(value) => setPreference(toggle.key, value)} />
                ))}
              </Section>
              <button className="sf-button" onClick={() => notify("This is how a Soft Fix notification looks")}>
                Preview a notification
              </button>
            </>
          )}
          {active === "focus" && (
            <>
              <p className="st-description">
                Don&apos;t need all of Soft Fix? Use a small timer that stays in front of your
                work, or a calm large-text view with only the basics. You can also open either one
                from the Soft Fix icon in the tray, next to the clock.
              </p>
              <div className="st-fields">
                <label>
                  Window
                  <select
                    className="sf-input"
                    value={viewMode}
                    onChange={(event) => {
                      setViewMode(event.target.value as typeof viewMode);
                      onClose();
                    }}
                  >
                    <option value="full">Full app</option>
                    <option value="focus">Focus mode: small always-on-top timer</option>
                    <option value="easy">Easy mode: large text, just the basics</option>
                  </select>
                </label>
                <label>
                  Easy mode text size
                  <select
                    className="sf-input"
                    value={easyScales.reduce(
                      (best, step) =>
                        Math.abs(step - preferences.easyScale) < Math.abs(best - preferences.easyScale) ? step : best,
                      easyScales[0],
                    )}
                    onChange={(event) => setPreference("easyScale", Number(event.target.value))}
                  >
                    {easyScales.map((step) => (
                      <option value={step} key={step}>
                        {Math.round(step * 100)}%
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Section title="Desktop app">
                <Toggle
                  title="Keep running in the tray"
                  description="Closing the window hides Soft Fix next to the clock so your timer keeps going. Quit from the tray icon."
                  checked={preferences.keepInTray}
                  onChange={(value) => setPreference("keepInTray", value)}
                />
                <Toggle
                  title="Focus mode stays in front"
                  description="Keep the small timer above your other windows."
                  checked={preferences.focusOnTop}
                  onChange={(value) => setPreference("focusOnTop", value)}
                />
              </Section>
            </>
          )}
          {active === "work" && (
            <>
              <p className="st-description">Set your workday defaults.</p>
              <div className="st-fields">
                {fields.dailyGoal}
                {fields.startOfDay}
                {fields.timezone}
                {fields.weekStart}
              </div>
              <Section title="Timer">
                <Toggle title="Show milliseconds" description="Run the milliseconds beside the seconds on the timer. Turn this off if the moving numbers distract you." checked={preferences.showMilliseconds} onChange={(value) => setPreference("showMilliseconds", value)} />
              </Section>
              <p className="st-footnote">Your daily goal is used in Work. Calendar and time-zone preferences are saved on this device.</p>
            </>
          )}
          {active === "organization" && (
            <>
              <p className="st-description">
                An organization is a workspace of its own: its projects, tasks, people, time and messages are kept apart from your other organizations.
              </p>
              <form
                className="org-name-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  const problem = renameOrg(openOrg.id, orgName);
                  if (problem) setOrgError(problem);
                  else {
                    setOrgError("");
                    notify("Organization renamed.");
                  }
                }}
              >
                <label>
                  Name
                  <input className="sf-input" maxLength={40} value={orgName} onChange={(event) => { setOrgName(event.target.value); setOrgError(""); }} />
                </label>
                <button className="sf-button primary" disabled={!orgName.trim() || orgName.trim() === openOrg.name}>
                  Save name
                </button>
              </form>
              {orgError && <p className="org-error" role="alert">{orgError}</p>}
              <div className="st-fields">{fields.timezone}</div>
              <Section title="Your organizations">
                <div className="org-list">
                  {orgs.map((org) => {
                    const info = org.id === openOrg.id ? { role: profile.role, people: members.length } : peekOrg(org.id);
                    return (
                      <div key={org.id} className={`org-row ${org.id === openOrg.id ? "current" : ""}`}>
                        <span className="org-mark small">{orgInitial(org.name)}</span>
                        <span className="org-copy">
                          <strong>{org.name}</strong>
                          <small>{info.role} · {info.people} {info.people === 1 ? "person" : "people"}</small>
                        </span>
                        {org.id === openOrg.id ? (
                          <span className="org-badge">Open now</span>
                        ) : (
                          <div className="org-row-actions">
                            <button type="button" className="sf-button" onClick={() => switchOrg(org.id)}>Open</button>
                            {org.id !== "main" && <button type="button" className="sf-button ghost" onClick={() => setDeletingOrg(org)}>Delete</button>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button type="button" className="sf-button" onClick={() => setCreatingOrg(true)}>
                  <Plus size={16} /> New organization
                </button>
              </Section>
              {creatingOrg && <NewOrganizationDialog onClose={() => setCreatingOrg(false)} />}
              {deletingOrg && (
                <Modal title={`Delete ${deletingOrg.name}?`} description="Its projects, tasks, people, time and messages are removed from this device. This can't be undone." onClose={() => setDeletingOrg(null)}>
                  <div className="org-actions">
                    <button type="button" className="sf-button" onClick={() => setDeletingOrg(null)}>Keep it</button>
                    <button type="button" className="sf-button primary" onClick={() => { removeOrg(deletingOrg.id); setDeletingOrg(null); notify("Organization deleted."); }}>Delete organization</button>
                  </div>
                </Modal>
              )}
            </>
          )}
          {active === "schedules" && (
            <>
              <p className="st-description">When the workday starts and what a full day means. Reports use these for limits and shift attendance.</p>
              <div className="st-fields">
                {fields.dailyGoal}
                {fields.startOfDay}
                {fields.weekStart}
              </div>
              <p className="st-footnote">The weekly limit is five times the daily goal ({preferences.dailyGoal * 5} hours).</p>
            </>
          )}
          {active === "tracking" && (
            <>
              <div className="st-info">
                <Camera size={26} />
                <p>Soft Fix has no capture agent of its own, so the Activity pages work out sample captures, apps and sites from your sessions. These settings choose what they show.</p>
              </div>
              <Toggle title="Screenshots" description="Show sample screenshots in Activity." checked={preferences.captureScreenshots} onChange={(value) => setPreference("captureScreenshots", value)} />
              <div className="st-fields">
                <label>
                  One screenshot every
                  <select className="sf-input" disabled={!preferences.captureScreenshots} value={preferences.captureInterval} onChange={(event) => setPreference("captureInterval", Number(event.target.value))}>
                    {[10, 15, 30, 60].map((minutes) => (
                      <option value={minutes} key={minutes}>
                        {minutes} minutes
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Toggle title="Apps and websites" description="Show the apps and sites used in Activity, and in the Apps & URLs report." checked={preferences.trackAppsUrls} onChange={(value) => setPreference("trackAppsUrls", value)} />
            </>
          )}
          {active === "privacy" && (
            <>
              <div className="st-info">
                <ShieldCheck size={26} />
                <p>Your conversations are sample data saved in this browser. Nothing is sent to anyone.</p>
              </div>
              <Toggle title="Share my availability" description="Show your status to teammates in the Lounge." checked={preferences.activityVisible} onChange={(value) => setPreference("activityVisible", value)} />
            </>
          )}
          {active === "voice" && (
            <>
              <p className="st-description">
                Prepare your room preferences. Audio rooms currently run as a
                local UI preview.
              </p>
              <div className="st-fields">
                <label>
                  Microphone
                  <select
                    className="sf-input"
                    value={audio.input}
                    onChange={(event) =>
                      setAudio({ ...audio, input: event.target.value })
                    }
                  >
                    <option>System default</option>
                    <option>Headset microphone</option>
                  </select>
                </label>
                <label>
                  Speaker
                  <select
                    className="sf-input"
                    value={audio.output}
                    onChange={(event) =>
                      setAudio({ ...audio, output: event.target.value })
                    }
                  >
                    <option>System default</option>
                    <option>Headphones</option>
                  </select>
                </label>
                <label>
                  Output volume · {audio.volume}%
                  <input
                    aria-label="Output volume"
                    type="range"
                    min={0}
                    max={100}
                    value={audio.volume}
                    onChange={(event) =>
                      setAudio({ ...audio, volume: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
              <Toggle
                title="Noise suppression"
                description="Prefer a quieter background in rooms."
                checked={audio.noise}
                onChange={(value) => setAudio({ ...audio, noise: value })}
              />
              <Toggle
                title="Push to talk"
                description="Save push-to-talk as your preferred input mode."
                checked={audio.pushToTalk}
                onChange={(value) => setAudio({ ...audio, pushToTalk: value })}
              />
            </>
          )}
          {active === "team" && (
            <>
              <p className="st-description">
                Roles define the dashboard experience. This preview demonstrates
                each role locally.
              </p>
              <div className="st-role-list">
                {[
                  {
                    role: "Owner",
                    detail:
                      "Workspace overview, people, approvals, and finances",
                  },
                  {
                    role: "Admin",
                    detail: "Workspace operations and member management",
                  },
                  {
                    role: "Manager",
                    detail: "Team projects, time reviews, and reporting",
                  },
                  {
                    role: "Member",
                    detail: "Personal time, tasks, and assigned projects",
                  },
                  {
                    role: "Client",
                    detail: "Client project progress and shared reports",
                  },
                ].map((item) => (
                  <div key={item.role}>
                    <strong>{item.role}</strong>
                    <small>{item.detail}</small>
                  </div>
                ))}
              </div>
              <button
                className="sf-button primary"
                onClick={() => {
                  navigate("dashboard", "people");
                  onClose();
                }}
              >
                Manage people & roles
              </button>
            </>
          )}
          {active === "integrations" && (
            <>
              <p className="st-description">
                Prepare your team's tools. Configuration is saved locally; no
                external accounts are connected.
              </p>
              {["Slack", "Google Calendar", "GitHub"].map((name) => (
                <div className="st-integration" key={name}>
                  <span className="st-integration-icon">
                    <Plug size={22} />
                  </span>
                  <span>
                    <strong>{name}</strong>
                    <small>
                      {integrations[name]
                        ? "Configuration saved"
                        : "No configuration"}
                    </small>
                  </span>
                  <button
                    className="sf-button"
                    onClick={() => {
                      setIntegration(name);
                      setIntegrationValue(integrations[name] || "");
                    }}
                  >
                    Configure
                  </button>
                </div>
              ))}
              {integration && (
                <form
                  className="st-integration-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setIntegrations({
                      ...integrations,
                      [integration]: integrationValue.trim(),
                    });
                    notify(`${integration} configuration saved locally`);
                    setIntegration("");
                  }}
                >
                  <label>
                    {integration} workspace URL
                    <input
                      className="sf-input"
                      type="url"
                      required
                      placeholder="https://…"
                      value={integrationValue}
                      onChange={(event) =>
                        setIntegrationValue(event.target.value)
                      }
                    />
                  </label>
                  <div className="sf-form-actions">
                    <button
                      type="button"
                      className="sf-button ghost"
                      onClick={() => setIntegration("")}
                    >
                      Cancel
                    </button>
                    <button className="sf-button primary">
                      Save configuration
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
          {active === "data" && (
            <>
              <div className="st-info">
                <ShieldCheck size={26} />
                <p>
                  Your workspace currently uses sample data saved in this
                  browser. No tracking or activity capture runs in this UI.
                </p>
              </div>
              <Toggle
                title="Share my availability"
                description="Show your status to teammates in the Lounge."
                checked={preferences.activityVisible}
                onChange={(value) => setPreference("activityVisible", value)}
              />
              <Section title="Your workspace data">
                <p className="st-description">
                  Export your profile, preferences, projects, members, and time
                  entries as a JSON file.
                </p>
                <button className="sf-button" onClick={exportWorkspace}>
                  <DownloadSimple />
                  Export workspace data
                </button>
              </Section>
            </>
          )}
          {active === "storage" && (
            <>
              <div className="st-info">
                <Cloud size={26} />
                <p>
                  Your changes are saved on this device. Cloud sync is not
                  connected.
                </p>
              </div>
              <div className="st-storage">
                <div>
                  <span>Projects</span>
                  <strong>{projects.length}</strong>
                </div>
                <div>
                  <span>People</span>
                  <strong>{members.length}</strong>
                </div>
                <div>
                  <span>Time entries</span>
                  <strong>{sessions.length}</strong>
                </div>
              </div>
              <Section title="Local backup">
                <p className="st-description">
                  {backup
                    ? `Last export: ${new Date(backup).toLocaleString()}`
                    : "Create a portable copy of your workspace data."}
                </p>
                <button className="sf-button primary" onClick={exportWorkspace}>
                  <DownloadSimple />
                  Download backup
                </button>
              </Section>
            </>
          )}
          {active === "about" && (
            <>
              <div className="st-about">
                <span className="brand-symbol">
                  <GearSix weight="fill" size={24} />
                </span>
                <h3>One place for your workday.</h3>
                <p>
                  Soft Fix brings focused work, team conversations, and a clear
                  view of progress together.
                </p>
                <span className="sf-badge">Soft Fix · 0.1.0</span>
              </div>
              <Section title="Keyboard shortcuts">
                <div className="st-shortcut">
                  <span>Search pages, projects, and people</span>
                  <kbd>Ctrl / ⌘ K</kbd>
                </div>
                <div className="st-shortcut">
                  <span>Close a dialog</span>
                  <kbd>Esc</kbd>
                </div>
                <div className="st-shortcut">
                  <span>Navigate interactive controls</span>
                  <kbd>Tab</kbd>
                </div>
              </Section>
              <p className="st-footnote">
                This frontend preview uses local sample data. App updates and
                account authentication are managed separately.
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
