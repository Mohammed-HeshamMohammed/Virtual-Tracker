import type { Session } from "../../../workspace";

/** Soft Fix has no capture agent of its own, so the Activity pages work out sample apps, sites and
 *  captures from the sessions themselves. The same session always yields the same figures, so every
 *  page agrees with the others and with the timesheets. */

export const hashOf = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export type Kind = "Productive" | "Neutral" | "Distracting";
type Mix = [name: string, share: number][];

const APPS: Record<string, { tool: string; kind: Kind }> = {
  "VS Code": { tool: "Development", kind: "Productive" },
  Terminal: { tool: "Development", kind: "Productive" },
  Figma: { tool: "Design", kind: "Productive" },
  Excel: { tool: "Productivity", kind: "Productive" },
  Notion: { tool: "Productivity", kind: "Productive" },
  Chrome: { tool: "Browsing", kind: "Neutral" },
  Slack: { tool: "Communication", kind: "Neutral" },
  Spotify: { tool: "Media", kind: "Distracting" },
};

const APP_MIX: Record<string, Mix> = {
  "nova-vanguard": [["VS Code", 0.38], ["Chrome", 0.22], ["Figma", 0.14], ["Slack", 0.12], ["Terminal", 0.1], ["Spotify", 0.04]],
  "buffalo-campaign": [["Figma", 0.4], ["Chrome", 0.2], ["Excel", 0.2], ["Slack", 0.1], ["Notion", 0.1]],
  rws: [["Excel", 0.4], ["Chrome", 0.28], ["Slack", 0.14], ["Notion", 0.14], ["Spotify", 0.04]],
  internal: [["Notion", 0.38], ["Chrome", 0.26], ["Slack", 0.2], ["VS Code", 0.12], ["Spotify", 0.04]],
};
const DEFAULT_APPS: Mix = [["Chrome", 0.4], ["Slack", 0.2], ["Notion", 0.2], ["Excel", 0.2]];

const SITES: Record<string, [domain: string, title: string, share: number][]> = {
  "nova-vanguard": [["github.com", "Pull requests", 0.34], ["figma.com", "Design files", 0.22], ["stackoverflow.com", "Questions", 0.14], ["docs.softfix.example", "Documentation", 0.3]],
  "buffalo-campaign": [["docs.google.com", "Budget report", 0.36], ["figma.com", "Campaign boards", 0.26], ["mail.google.com", "Inbox", 0.18], ["buffalostudio.example", "Client portal", 0.2]],
  rws: [["sheets.google.com", "Weekly limits", 0.42], ["rws.example", "Client site", 0.26], ["mail.google.com", "Inbox", 0.2], ["calendar.google.com", "Schedule", 0.12]],
  internal: [["notion.so", "Team wiki", 0.4], ["slack.com", "Channels", 0.24], ["github.com", "Changelog", 0.2], ["linear.example", "Planning", 0.16]],
};
const DEFAULT_SITES: [string, string, number][] = [["google.com", "Search", 1]];

export type AppUse = { app: string; tool: string; kind: Kind; seconds: number; byMember: Record<string, number> };
export type SiteUse = { domain: string; title: string; seconds: number; visits: number; byMember: Record<string, number> };
export type ToolUse = { tool: string; seconds: number; apps: string[]; kind: Kind };

export function appUsage(sessions: Session[]): AppUse[] {
  const rows = new Map<string, AppUse>();
  for (const session of sessions) {
    for (const [app, share] of APP_MIX[session.projectId] ?? DEFAULT_APPS) {
      const meta = APPS[app] ?? { tool: "Other", kind: "Neutral" as Kind };
      const row = rows.get(app) ?? { app, tool: meta.tool, kind: meta.kind, seconds: 0, byMember: {} };
      const seconds = Math.round(session.seconds * share);
      row.seconds += seconds;
      row.byMember[session.memberId] = (row.byMember[session.memberId] ?? 0) + seconds;
      rows.set(app, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.seconds - a.seconds);
}

export function siteUsage(sessions: Session[]): SiteUse[] {
  const rows = new Map<string, SiteUse>();
  for (const session of sessions) {
    for (const [domain, title, share] of SITES[session.projectId] ?? DEFAULT_SITES) {
      const row = rows.get(domain) ?? { domain, title, seconds: 0, visits: 0, byMember: {} };
      const seconds = Math.round(session.seconds * share * 0.55);
      row.seconds += seconds;
      row.visits += Math.max(1, Math.round(seconds / 240));
      row.byMember[session.memberId] = (row.byMember[session.memberId] ?? 0) + seconds;
      rows.set(domain, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.seconds - a.seconds);
}

export function toolUsage(apps: AppUse[]): ToolUse[] {
  const rows = new Map<string, ToolUse>();
  for (const app of apps) {
    const row = rows.get(app.tool) ?? { tool: app.tool, seconds: 0, apps: [], kind: app.kind };
    row.seconds += app.seconds;
    row.apps.push(app.app);
    rows.set(app.tool, row);
  }
  return [...rows.values()].sort((a, b) => b.seconds - a.seconds);
}

export type Capture = {
  id: string;
  sessionId: string;
  memberId: string;
  projectId: string;
  at: string;
  app: string;
  activity: number;
  title: string;
};

/** Sample captures, one every `interval` minutes of a session (up to six), newest first. */
export function captures(sessions: Session[], interval = 30): Capture[] {
  const all: Capture[] = [];
  for (const session of sessions) {
    if (session.seconds < interval * 30) continue;
    const count = Math.min(6, Math.floor(session.seconds / (interval * 60)) + 1);
    const start = new Date(session.startedAt).getTime();
    for (let index = 0; index < count; index++) {
      const id = `${session.id}-${index}`;
      const seed = hashOf(id);
      const mix = APP_MIX[session.projectId] ?? DEFAULT_APPS;
      all.push({
        id,
        sessionId: session.id,
        memberId: session.memberId,
        projectId: session.projectId,
        at: new Date(start + ((index + 1) * session.seconds * 1000) / (count + 1)).toISOString(),
        app: mix[seed % mix.length][0],
        activity: 52 + (seed % 44),
        title: session.taskTitle,
      });
    }
  }
  return all.sort((a, b) => b.at.localeCompare(a.at));
}

/** An activity level (0-100) for one member on one day, steady per member and day. */
export const activityLevel = (memberId: string, day: string) => 58 + (hashOf(`${memberId}|${day}`) % 38);
