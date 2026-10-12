import type { CSSProperties } from "react";
import type { Member, Session } from "../../../workspace";
import type { WorkProject } from "../../../data/work";
import { projectTypeDef, type ProjectTypeDef } from "../../../data/projectTypes";
import { Avatar } from "../DashboardParts";
import { hours } from "./kit";
import type { ProjectMeta } from "./NewProjectPage";
import { dayKey, type Client } from "./stores";
import "../projects.css";

/** Which part of a picture shows in its square: the centre of the frame as fractions of the picture
 *  (0 to 1), how far it is zoomed in (1 = the whole short side), and the picture's width / height. */
export type AvatarCrop = { cx: number; cy: number; zoom: number; ratio: number };

/** Places a picture inside a square of any size so that the framed part fills it. Everything is a
 *  percentage of the square, so one crop draws the same at every avatar size. */
export function cropStyle(crop: AvatarCrop): CSSProperties {
  const width = crop.zoom * Math.max(crop.ratio, 1);
  const height = crop.zoom * Math.max(1 / crop.ratio, 1);
  return { position: "absolute", maxWidth: "none", width: `${width * 100}%`, height: `${height * 100}%`, left: `${(0.5 - crop.cx * width) * 100}%`, top: `${(0.5 - crop.cy * height) * 100}%` };
}

export type ProjectStatus = "Completed" | "Over budget" | "Overdue" | "Not started" | "In progress";

/** Everything the Projects list and a project's own page say about a project, worked out once so the
 *  card, the table row and the page can never disagree. */
export type ProjectFacts = {
  project: WorkProject;
  def: ProjectTypeDef;
  description: string;
  /** The project's picture, as a data URL; empty when it has none. */
  avatar: string;
  /** How an animated picture is framed (a still one is already cut to its frame). */
  avatarCrop?: AvatarCrop;
  /** Who to credit for a picture that came from the search. */
  avatarCredit: string;
  client?: Client;
  /** Tracked on it, ever. */
  seconds: number;
  done: number;
  total: number;
  /** Tasks done, as a whole percentage (0 when it has none). */
  progress: number;
  /** Hours the budget allows: 0 means it has none. */
  budget: number;
  resets: "Never" | "Weekly" | "Monthly";
  notifyAt: number;
  /** Hours spent against the budget, in the period it covers (all time unless it refills). */
  used: number;
  due: string;
  status: ProjectStatus;
  /** The newest session on it, as a time (0 when nothing was tracked). */
  lastActive: number;
  /** Who is on it; when nobody was picked, whoever has tracked on it. */
  peopleIds: string[];
  /** Nobody was picked, so the whole workspace can track on it. */
  open: boolean;
};

/** When the budget's current period began: the start of this week or month for one that refills. */
function periodStart(resets: ProjectFacts["resets"]): number {
  if (resets === "Never") return 0;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (resets === "Weekly") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else start.setDate(1);
  return start.getTime();
}

/** `sessions` is everything this role may see on the project, of all time. */
export function projectFacts(project: WorkProject, sessions: Session[], meta: Record<string, ProjectMeta>, clients: Client[]): ProjectFacts {
  const def = projectTypeDef(project.type);
  const kept = meta[project.id];
  const own = sessions.filter((session) => session.projectId === project.id);
  const seconds = own.reduce((sum, session) => sum + session.seconds, 0);
  const done = project.tasks.filter((task) => task.done).length;
  const total = project.tasks.length;
  // A project made with no budget stores 0; one from before budgets existed has none stored and gets 80h.
  const budget = kept?.budget ?? 80;
  const resets = kept?.resets ?? def.resets;
  const from = periodStart(resets);
  const used = hours(own.filter((session) => new Date(session.startedAt).getTime() >= from).reduce((sum, session) => sum + session.seconds, 0));
  const due = kept?.due ?? "";
  const status: ProjectStatus =
    def.hasTasks && total > 0 && done === total ? "Completed" : budget > 0 && used > budget ? "Over budget" : due && due < dayKey(0) ? "Overdue" : !seconds && !done ? "Not started" : "In progress";
  const picked = project.memberIds ?? [];
  return {
    project,
    def,
    description: kept?.description ?? "",
    avatar: kept?.avatar ?? "",
    avatarCrop: kept?.avatarCrop,
    avatarCredit: kept?.avatarCredit ?? "",
    client: clients.find((client) => client.projectIds.includes(project.id)),
    seconds,
    done,
    total,
    progress: total ? Math.round((done / total) * 100) : 0,
    budget,
    resets,
    notifyAt: kept?.notifyAt ?? 80,
    used,
    due,
    status,
    lastActive: own.reduce((latest, session) => Math.max(latest, new Date(session.startedAt).getTime()), 0),
    peopleIds: picked.length ? picked : [...new Set(own.map((session) => session.memberId))],
    open: !picked.length,
  };
}

export const needsAttention = (status: ProjectStatus) => status === "Over budget" || status === "Overdue";
export const refillText = (resets: ProjectFacts["resets"]) => (resets === "Weekly" ? "a week" : resets === "Monthly" ? "a month" : "");
/** Hours without a trailing ".0". */
export const hoursText = (value: number) => `${Math.round(value * 10) / 10}h`;

/** A project's picture: its image (framed by `crop` when it has one), or its initials on its colour. */
export function ProjectAvatar({ name, color, src, crop, size }: { name: string; color: string; src?: string; crop?: AvatarCrop; size?: "sm" | "lg" }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className={`db-project-icon pj-avatar ${color} ${size ?? ""}`} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} style={crop ? cropStyle(crop) : undefined} /> : initials || "?"}
    </span>
  );
}

const TONE: Record<ProjectStatus, string> = { Completed: "done", "Over budget": "bad", Overdue: "warn", "Not started": "quiet", "In progress": "live" };

export function StatusPill({ status }: { status: ProjectStatus }) {
  return <span className={`pj-pill ${TONE[status]}`}>{status}</span>;
}

/** Hours used against a budget: amber from the warning point, red past the limit. */
export function BudgetMeter({ facts, compact = false }: { facts: ProjectFacts; compact?: boolean }) {
  if (facts.budget <= 0) return <span className="db-muted pj-nobudget">No budget</span>;
  const percent = Math.round((facts.used / facts.budget) * 100);
  const tone = percent >= 100 ? "over" : percent >= facts.notifyAt ? "near" : "";
  return (
    <span className={`pj-budget ${tone} ${compact ? "compact" : ""}`} title={`${hoursText(facts.used)} of ${facts.budget}h${facts.resets === "Never" ? "" : ` ${refillText(facts.resets)}`}`}>
      <span className={`db-progress ${tone}`}>
        <span style={{ width: `${Math.min(100, percent)}%` }} />
      </span>
      <b>{percent}%</b>
    </span>
  );
}

/** The first few people on a project as overlapping avatars, then how many more. */
export function PeopleStack({ ids, members, open, max = 4 }: { ids: string[]; members: Member[]; open: boolean; max?: number }) {
  const people = ids.map((id) => members.find((member) => member.id === id)).filter((member): member is Member => Boolean(member));
  if (!people.length) return <span className="pj-people-none">{open ? "Open to everyone" : "Nobody yet"}</span>;
  const names = people.map((member) => member.name).join(", ");
  return (
    <span className="pj-people" title={names} aria-label={names}>
      <span className="db-avatar-stack">
        {people.slice(0, max).map((member) => (
          <Avatar key={member.id} name={member.name} color={member.color} />
        ))}
      </span>
      {people.length > max && <small>+{people.length - max}</small>}
    </span>
  );
}
