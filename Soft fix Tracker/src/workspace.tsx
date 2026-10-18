import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { projects as initialProjects, type WorkProject } from "./data/work";
import type { ProjectMeta, AvatarCrop } from "./data/projectMeta";
import { initialLoungeData, type LoungeData } from "./components/lounge-model";
import { activeOrg, isSampleOrg, storageKeyFor } from "./organizations";

export type Mode = "lounge" | "work" | "dashboard";
/** How much of Soft Fix is showing: everything, a small always-on-top timer, or large-text basics. */
export type ViewMode = "full" | "focus" | "easy";
const viewModes: ViewMode[] = ["full", "focus", "easy"];
export type Role = "Owner" | "Admin" | "Manager" | "Member" | "Client";
export type Member = {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: string;
  team: string;
  status: "Available" | "Focusing" | "Away" | "Offline";
  email: string;
  managerId?: string;
};
export type Session = {
  id: string;
  projectId: string;
  taskId?: string;
  taskTitle: string;
  startedAt: string;
  endedAt: string;
  seconds: number;
  note: string;
  status: "Draft" | "Submitted" | "Approved";
  memberId: string;
};
export type TimerState = {
  projectId: string;
  taskId: string | null;
  startedAt: number | null;
  elapsed: number;
};
export type Profile = {
  name: string;
  email: string;
  title: string;
  status: string;
  role: Role;
  username?: string;
  pronouns?: string;
  bio?: string;
  avatar?: string;
  avatarCredit?: string;
  avatarCrop?: AvatarCrop;
  banner?: string;
  bannerColor?: string;
  accentColor?: string;
  decoration?: "none" | "ring" | "double";
  nameStyle?: "default" | "rounded" | "serif";
  widgets?: string[];
};
export type Preferences = {
  theme: "dark" | "light" | "system";
  compact: boolean;
  reducedMotion: boolean;
  notifications: boolean;
  sounds: boolean;
  weeklyDigest: boolean;
  activityVisible: boolean;
  timezone: string;
  weekStart: string;
  dailyGoal: number;
  startOfDay: string;
  /** Closing the window hides Soft Fix to the tray icon instead of quitting. */
  keepInTray: boolean;
  /** The Focus window stays in front of other windows. */
  focusOnTop: boolean;
  /** Text size in Easy mode, as a multiple of its base size. */
  easyScale: number;
  /** Whether the Activity pages show screenshots, and how often one is taken (minutes). */
  captureScreenshots: boolean;
  captureInterval: number;
  /** Whether the Activity pages show the apps and sites used. */
  trackAppsUrls: boolean;
  /** Whether the timer shows milliseconds beside the seconds. */
  showMilliseconds: boolean;
};
export type Route = {
  mode: Mode;
  workSection: string;
  dashboardSection: string;
  loungeSection: string;
  target?: string;
  revision: number;
};

type StoredRecord = Record<string, unknown>;
const storedRecord = (value: unknown): value is StoredRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const storedText = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const storedNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
const storedChoice = (
  value: unknown,
  choices: readonly string[],
  fallback: string,
) => (typeof value === "string" && choices.includes(value) ? value : fallback);
const storedDate = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const optionalStoredText = (value: unknown) =>
  typeof value === "string" ? value : undefined;

function restoreStoredList(
  value: unknown,
  fallback: unknown[],
  normalize: (item: unknown) => unknown | null,
) {
  if (!Array.isArray(value)) return fallback;
  const items = value.map(normalize).filter((item) => item !== null);
  return value.length > 0 && items.length === 0 ? fallback : items;
}
const storedStrings = (value: unknown, fallback: unknown[] = []) =>
  restoreStoredList(value, fallback, (item) =>
    typeof item === "string" ? item : null,
  );
function restoreStoredMap(
  value: unknown,
  fallback: StoredRecord,
  normalize: (item: unknown, key: string) => unknown,
) {
  return storedRecord(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, normalize(item, key)]),
      )
    : fallback;
}
function normalizeStoredMember(value: unknown): StoredRecord | null {
  if (
    !storedRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    !value.name.trim()
  )
    return null;
  return {
    ...value,
    initials: storedText(
      value.initials,
      value.name
        .split(" ")
        .map((word) => word[0])
        .slice(0, 2)
        .join(""),
    ),
    color: storedText(value.color, "blue"),
    role: storedText(value.role, "Member"),
    team: storedText(value.team, "General"),
    email: storedText(value.email),
    status: storedChoice(
      value.status,
      ["Available", "Focusing", "Away", "Offline"],
      "Offline",
    ),
    managerId: optionalStoredText(value.managerId),
  };
}
function normalizeStoredTask(value: unknown): StoredRecord | null {
  if (
    !storedRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.title !== "string"
  )
    return null;
  return {
    ...value,
    done: typeof value.done === "boolean" ? value.done : undefined,
    priority:
      value.priority === undefined
        ? undefined
        : storedChoice(value.priority, ["Low", "Medium", "High"], "Medium"),
    due: optionalStoredText(value.due),
    description: optionalStoredText(value.description),
  };
}
function normalizeStoredProject(value: unknown): StoredRecord | null {
  if (
    !storedRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string"
  )
    return null;
  return {
    ...value,
    color: storedText(value.color, "blue"),
    tasks: restoreStoredList(value.tasks, [], normalizeStoredTask),
  };
}
function normalizeStoredSession(value: unknown): StoredRecord | null {
  if (
    !storedRecord(value) ||
    !["id", "projectId", "taskTitle", "memberId"].every(
      (key) => typeof value[key] === "string",
    ) ||
    !storedDate(value.startedAt) ||
    !storedDate(value.endedAt)
  )
    return null;
  return {
    ...value,
    taskId: optionalStoredText(value.taskId),
    seconds: storedNumber(value.seconds),
    note: storedText(value.note),
    status: storedChoice(
      value.status,
      ["Draft", "Submitted", "Approved"],
      "Draft",
    ),
  };
}
function normalizeStoredRoom(value: unknown): StoredRecord | null {
  if (
    !storedRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string"
  )
    return null;
  return {
    ...value,
    description: storedText(value.description),
    category: storedChoice(
      value.category,
      ["Workspace", "Project"],
      "Workspace",
    ),
    members: storedStrings(value.members),
    joined: typeof value.joined === "boolean" ? value.joined : false,
    projectId: optionalStoredText(value.projectId),
  };
}
function normalizeStoredMessage(value: unknown): StoredRecord | null {
  if (
    !storedRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.personId !== "string" ||
    !storedDate(value.time)
  )
    return null;
  return {
    ...value,
    body: storedText(value.body),
    attachment: optionalStoredText(value.attachment),
    replyTo: optionalStoredText(value.replyTo),
    reactions: storedStrings(value.reactions),
  };
}
function sameStoredShape(value: unknown, example: unknown): boolean {
  if (example === null) return value === null;
  if (Array.isArray(example))
    return (
      Array.isArray(value) &&
      (!example.length ||
        value.every((item) => sameStoredShape(item, example[0])))
    );
  if (storedRecord(example))
    return (
      storedRecord(value) &&
      Object.entries(example).every(([key, item]) =>
        sameStoredShape(value[key], item),
      )
    );
  return (
    typeof value === typeof example &&
    (typeof value !== "number" || Number.isFinite(value))
  );
}
function restorePersistentValue<T>(key: string, value: unknown, initial: T): T {
  let restored: unknown = initial;
  if (key === "projects")
    restored = restoreStoredList(
      value,
      initial as unknown[],
      normalizeStoredProject,
    );
  else if (key === "members")
    restored = restoreStoredList(
      value,
      initial as unknown[],
      normalizeStoredMember,
    );
  else if (key === "sessions")
    restored = restoreStoredList(
      value,
      initial as unknown[],
      normalizeStoredSession,
    );
  else if (key === "lounge" && storedRecord(initial) && storedRecord(value)) {
    restored = {
      ...initial,
      ...value,
      voiceRooms: restoreStoredList(value.voiceRooms, [], normalizeStoredRoom),
      rooms: restoreStoredList(
        value.rooms,
        initial.rooms as unknown[],
        normalizeStoredRoom,
      ),
      messages: restoreStoredMap(
        value.messages,
        initial.messages as StoredRecord,
        (messages, conversation) =>
          restoreStoredList(
            messages,
            (initial.messages as Record<string, unknown[]>)[conversation] ?? [],
            normalizeStoredMessage,
          ),
      ),
      drafts: restoreStoredMap(
        value.drafts,
        initial.drafts as StoredRecord,
        (draft) => storedText(draft),
      ),
      bookmarks: storedStrings(value.bookmarks, initial.bookmarks as unknown[]),
      contacts: storedStrings(value.contacts, initial.contacts as unknown[]),
      blocked: storedStrings(value.blocked, (initial.blocked as unknown[]) || []),
      mutedRooms: storedStrings(
        value.mutedRooms,
        initial.mutedRooms as unknown[],
      ),
      requests: restoreStoredList(
        value.requests,
        initial.requests as unknown[],
        normalizeStoredMember,
      ),
      invites: restoreStoredList(
        value.invites,
        initial.invites as unknown[],
        (item) =>
          storedRecord(item) &&
          typeof item.id === "string" &&
          typeof item.email === "string"
            ? { ...item, role: storedText(item.role, "Member") }
            : null,
      ),
    };
  } else if (key === "integration-preferences")
    restored = restoreStoredMap(value, {}, (item) => storedText(item));
  else if (key === "dashboard.project-meta")
    restored = restoreStoredMap(value, {}, (item) =>
      storedRecord(item)
        ? {
            ...item,
            description: storedText(item.description),
            budget: storedNumber(item.budget),
            due: storedText(item.due),
          }
        : { description: "", budget: 0, due: "" },
    );
  else if (key === "dashboard.reports")
    restored = restoreStoredList(value, initial as unknown[], (item) =>
      storedRecord(item) &&
      ["id", "name", "groupBy", "status"].every(
        (field) => typeof item[field] === "string",
      )
        ? item
        : null,
    );
  else if (key === "read-notifications")
    restored = storedStrings(value, initial as unknown[]);
  else if (key === "work.sessionBeganAt")
    restored =
      value === null
        ? null
        : typeof value === "number" && Number.isFinite(value) && value >= 0
          ? value
          : initial;
  else if (Array.isArray(initial))
    // With nothing to compare against (a new organization's empty list), trust what was saved.
    restored = !initial.length
      ? Array.isArray(value)
        ? value
        : initial
      : restoreStoredList(value, initial, (item) =>
          sameStoredShape(item, initial[0]) ? item : null,
        );
  else if (storedRecord(initial) && storedRecord(value)) {
    const merged = {
      ...value,
      ...Object.fromEntries(
        Object.entries(initial).map(([field, fallback]) => [
          field,
          sameStoredShape(value[field], fallback) ? value[field] : fallback,
        ]),
      ),
    };
    if (key === "profile") {
      for (const field of ["username", "pronouns", "bio", "avatar", "avatarCredit", "banner", "bannerColor", "accentColor"]) merged[field] = storedText(value[field]);
      merged.decoration = storedChoice(value.decoration, ["none", "ring", "double"], "none");
      merged.nameStyle = storedChoice(value.nameStyle, ["default", "rounded", "serif"], "default");
      merged.widgets = storedStrings(value.widgets, ["focus", "projects"]);
      merged.name = storedText(merged.name).trim() || initial.name;
      merged.role = storedChoice(
        value.role,
        ["Owner", "Admin", "Manager", "Member", "Client"],
        storedText(initial.role),
      );
      merged.status = storedChoice(
        value.status,
        ["Available", "Focusing", "Away", "Offline"],
        storedText(initial.status),
      );
    }
    if (key === "preferences") {
      merged.theme = storedChoice(
        value.theme,
        ["dark", "light", "system"],
        storedText(initial.theme),
      );
      merged.dailyGoal =
        storedNumber(value.dailyGoal, Number(initial.dailyGoal)) ||
        initial.dailyGoal;
    }
    if (key === "timer") {
      merged.taskId =
        value.taskId === null
          ? null
          : storedText(value.taskId, storedText(initial.taskId));
      merged.startedAt =
        value.startedAt === null || value.startedAt === undefined
          ? null
          : typeof value.startedAt === "number" &&
              Number.isFinite(value.startedAt) &&
              value.startedAt >= 0
            ? value.startedAt
            : initial.startedAt;
      merged.elapsed = storedNumber(value.elapsed, Number(initial.elapsed));
    }
    restored = merged;
  } else if (sameStoredShape(value, initial)) restored = value;
  return restored as T;
}

export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  // Which organization's copy this is, decided once, when the hook is made.
  const [storageKey] = useState(() => storageKeyFor(key));
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored
        ? restorePersistentValue(key, JSON.parse(stored), initial)
        : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* Keep the app usable when storage is unavailable. */
    }
  }, [storageKey, value]);
  return [value, setValue];
}

const initialMembers: Member[] = [
  {
    id: "me",
    name: "Aria Morgan",
    initials: "AM",
    color: "blue",
    role: "Owner",
    team: "Design",
    status: "Available",
    email: "aria@softfix.work",
  },
  {
    id: "sara",
    managerId: "me",
    name: "Sara Ahmed",
    initials: "SA",
    color: "violet",
    role: "Admin",
    team: "Design",
    status: "Focusing",
    email: "sara@softfix.work",
  },
  {
    id: "youssef",
    managerId: "sara",
    name: "Youssef Khaled",
    initials: "YK",
    color: "cyan",
    role: "Manager",
    team: "Engineering",
    status: "Available",
    email: "youssef@softfix.work",
  },
  {
    id: "mariam",
    managerId: "youssef",
    name: "Mariam Nabil",
    initials: "MN",
    color: "gold",
    role: "Member",
    team: "Design",
    status: "Away",
    email: "mariam@softfix.work",
  },
  {
    id: "omar",
    managerId: "youssef",
    name: "Omar Adel",
    initials: "OA",
    color: "green",
    role: "Member",
    team: "Engineering",
    status: "Available",
    email: "omar@softfix.work",
  },
  {
    id: "nour",
    managerId: "me",
    name: "Nour Hany",
    initials: "NH",
    color: "orange",
    role: "Client",
    team: "Partners",
    status: "Offline",
    email: "nour@example.com",
  },
];
const day = (offset: number, hour: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};
const initialSessions: Session[] = [
  {
    id: "s1",
    projectId: "nova-vanguard",
    taskId: "t1",
    taskTitle: "Ship the Lounge navigation revision",
    startedAt: day(0, 9),
    endedAt: day(0, 11),
    seconds: 7200,
    note: "Navigation and component exploration",
    status: "Draft",
    memberId: "me",
  },
  {
    id: "s2",
    projectId: "buffalo-campaign",
    taskId: "t4",
    taskTitle: "Draft the client budget report",
    startedAt: day(0, 11),
    endedAt: day(0, 12),
    seconds: 3600,
    note: "Weekly report review",
    status: "Draft",
    memberId: "me",
  },
  {
    id: "s3",
    projectId: "nova-vanguard",
    taskId: "t2",
    taskTitle: "Pair on the authentication flow",
    startedAt: day(-1, 9),
    endedAt: day(-1, 12),
    seconds: 10800,
    note: "Flow review with the team",
    status: "Submitted",
    memberId: "sara",
  },
  {
    id: "s4",
    projectId: "rws",
    taskId: "t6",
    taskTitle: "Reconcile weekly limits for the team",
    startedAt: day(-1, 13),
    endedAt: day(-1, 15),
    seconds: 7200,
    note: "Planning and estimation",
    status: "Approved",
    memberId: "youssef",
  },
  {
    id: "s5",
    projectId: "internal",
    taskId: "t8",
    taskTitle: "Write this week's changelog",
    startedAt: day(-2, 10),
    endedAt: day(-2, 12),
    seconds: 7200,
    note: "Release notes",
    status: "Approved",
    memberId: "me",
  },
];

type WorkspaceValue = {
  projects: WorkProject[];
  setProjects: Dispatch<SetStateAction<WorkProject[]>>;
  projectMeta: Record<string, ProjectMeta>;
  setProjectMeta: Dispatch<SetStateAction<Record<string, ProjectMeta>>>;
  members: Member[];
  setMembers: Dispatch<SetStateAction<Member[]>>;
  sessions: Session[];
  setSessions: Dispatch<SetStateAction<Session[]>>;
  timer: TimerState;
  setTimer: Dispatch<SetStateAction<TimerState>>;
  profile: Profile;
  setProfile: Dispatch<SetStateAction<Profile>>;
  preferences: Preferences;
  setPreferences: Dispatch<SetStateAction<Preferences>>;
  viewMode: ViewMode;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  /** The Lounge's conversations, rooms and contacts. They live here so the chat box and the Lounge are one conversation. */
  lounge: LoungeData;
  setLounge: Dispatch<SetStateAction<LoungeData>>;
  /** The chat box in the corner: whether it is open, and the person whose thread it shows. */
  chat: { open: boolean; personId?: string };
  openChat: (personId?: string) => void;
  closeChat: () => void;
  route: Route;
  navigate: (mode: Mode, section?: string, target?: string) => void;
  notify: (message: string) => void;
  notice: string;
};
const WorkspaceContext = createContext<WorkspaceValue | null>(null);

function routeFromLocation(): Partial<Route> {
  const [path, query] = window.location.hash.slice(1).split("?");
  const [mode, section] = path.split("/");
  if (!["work", "lounge", "dashboard"].includes(mode)) return {};
  return {
    mode: mode as Mode,
    ...(section ? { [`${mode}Section`]: section } : {}),
    target: new URLSearchParams(query).get("target") || undefined,
  };
}

/** What a new organization starts with: one project to get going. */
const starterProjects: WorkProject[] = [
  {
    id: "getting-started",
    name: "Getting started",
    color: "blue",
    tasks: [
      { id: "gs-1", title: "Invite your team" },
      { id: "gs-2", title: "Create your first project" },
      { id: "gs-3", title: "Track your first focus session" },
    ],
  },
];

/** What every preference is until someone changes it. */
const defaultPreferences: Preferences = {
  theme: "dark",
  compact: false,
  reducedMotion: false,
  notifications: true,
  sounds: false,
  weeklyDigest: true,
  activityVisible: true,
  timezone: "Africa/Cairo",
  weekStart: "Monday",
  dailyGoal: 8,
  startOfDay: "09:00",
  keepInTray: true,
  focusOnTop: true,
  easyScale: 1.25,
  captureScreenshots: true,
  captureInterval: 30,
  trackAppsUrls: true,
  showMilliseconds: true,
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  // The first organization holds the sample data; a new one starts with just its owner and a starter project.
  const org = activeOrg();
  const sample = isSampleOrg();
  const owner = org.owner ?? { name: "Aria Morgan", email: "aria@softfix.work", title: "Product designer", status: "Available" };
  const seedProjects = sample ? initialProjects : starterProjects;
  const seedMembers: Member[] = sample
    ? initialMembers
    : [{ id: "me", name: owner.name, initials: owner.name.split(" ").map((word) => word[0]).slice(0, 2).join(""), color: "blue", role: "Owner", team: "General", status: owner.status as Member["status"], email: owner.email }];
  const [projects, setProjects] = usePersistentState("projects", seedProjects);
  const [members, setMembers] = usePersistentState("members", seedMembers);
  const [sessions, setSessions] = usePersistentState(
    "sessions",
    sample ? initialSessions : initialSessions.slice(0, 0),
  );
  const [timer, setTimer] = usePersistentState<TimerState>("timer", {
    projectId: seedProjects[0].id,
    taskId: seedProjects[0].tasks[0]?.id ?? null,
    startedAt: null,
    elapsed: 0,
  });
  const [profile, setProfile] = usePersistentState<Profile>("profile", {
    name: owner.name,
    email: owner.email,
    title: owner.title,
    status: owner.status,
    role: "Owner",
  });
  const [storedPreferences, setPreferences] = usePersistentState<Preferences>("preferences", defaultPreferences);
  // A setting added after this person's saved copy was made (or while the app was hot-reloaded, which
  // keeps the old copy in memory) is missing from it. Fill it from the defaults rather than leave it
  // undefined, so a new setting never reads as "off" by accident.
  const preferences = useMemo(() => ({ ...defaultPreferences, ...storedPreferences }), [storedPreferences]);
  const [storedViewMode, setViewMode] = usePersistentState<ViewMode>("view-mode", "full");
  const viewMode = viewModes.includes(storedViewMode) ? storedViewMode : "full";
  const [seedLounge] = useState(() => initialLoungeData(members, projects, sample));
  const [lounge, setLounge] = usePersistentState<LoungeData>("lounge", seedLounge);
  // Save Lounge first so moving its old pictures frees space before metadata is persisted.
  const [projectMeta, setProjectMeta] = usePersistentState<Record<string, ProjectMeta>>("dashboard.project-meta", {});
  // Consume the old Lounge-only icons once, preserving existing project pictures as authoritative.
  useEffect(() => {
    const legacy = projects.filter((project) => lounge.serverIcons?.[project.id]);
    if (!legacy.length) return;
    setProjectMeta((old) => {
      const next = { ...old };
      for (const project of legacy) {
        if (next[project.id]?.avatar || next[project.id]?.avatarGlyph) continue;
        const icon = lounge.serverIcons![project.id];
        next[project.id] = { ...(next[project.id] ?? { description: "", budget: 80, due: "" }), avatar: icon.image, avatarGlyph: icon.image ? undefined : icon.glyph };
      }
      return next;
    });
    setLounge((old) => {
      const serverIcons = { ...old.serverIcons };
      for (const project of legacy) delete serverIcons[project.id];
      return { ...old, serverIcons };
    });
  }, [projects, lounge.serverIcons, setProjectMeta, setLounge]);
  const [chat, setChat] = useState<{ open: boolean; personId?: string }>({ open: false });
  const openChat = useCallback((personId?: string) => setChat({ open: true, personId }), []);
  const closeChat = useCallback(() => setChat((old) => ({ ...old, open: false })), []);
  const [route, setRoute] = useState<Route>(() => ({
    mode: "work",
    workSection: "overview",
    dashboardSection: "dashboard",
    loungeSection: "home",
    revision: 0,
    ...routeFromLocation(),
  }));
  const [notice, setNotice] = useState("");
  const firstRoute = useRef(true);
  const targetByMode = useRef<Partial<Record<Mode, string>>>({
    [route.mode]: route.target,
  });
  const navigate = useCallback(
    (mode: Mode, section?: string, target?: string) =>
      setRoute((old) => {
        const next = {
          ...old,
          mode,
          ...(section ? { [`${mode}Section`]: section } : {}),
          target: section ? target : targetByMode.current[mode],
          revision: old.revision + 1,
        };
        return next;
      }),
    [],
  );
  useEffect(() => {
    const section = route[`${route.mode}Section`];
    targetByMode.current[route.mode] = route.target;
    const hash = `#${route.mode}/${section}${route.target ? `?target=${encodeURIComponent(route.target)}` : ""}`;
    if (window.location.hash !== hash) {
      if (firstRoute.current) window.history.replaceState(null, "", hash);
      else window.history.pushState(null, "", hash);
    }
    firstRoute.current = false;
  }, [route]);
  useEffect(() => {
    const restore = () =>
      setRoute((old) => ({
        ...old,
        ...routeFromLocation(),
        revision: old.revision + 1,
      }));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4200);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === "system"
          ? query.matches
            ? "light"
            : "dark"
          : preferences.theme;
      document.documentElement.dataset.compact = String(preferences.compact);
      document.documentElement.dataset.reducedMotion = String(
        preferences.reducedMotion,
      );
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [preferences]);
  return (
    <WorkspaceContext.Provider
      value={{
        projects,
        setProjects,
        projectMeta,
        setProjectMeta,
        members,
        setMembers,
        sessions,
        setSessions,
        timer,
        setTimer,
        profile,
        setProfile,
        preferences,
        setPreferences,
        viewMode,
        setViewMode,
        lounge,
        setLounge,
        chat,
        openChat,
        closeChat,
        route,
        navigate,
        notify,
        notice,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("WorkspaceProvider is required");
  return context;
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value);
          const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
          return `"${safe.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
