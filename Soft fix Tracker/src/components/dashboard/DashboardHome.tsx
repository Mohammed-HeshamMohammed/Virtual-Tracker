import { ArrowUpRight, ArrowRight, ArrowDownRight, CheckCircle, Clock, Folder, Play } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { useWorkspace, formatDuration } from "../../workspace";
import { Avatar, Badge, StatTile } from "./DashboardParts";
import { FocusTile } from "./FocusTile";
import { useAttention } from "./pages/OverviewPages";
import type { PageContext } from "./pages/kit";

const GAUGE_RADIUS = 80;
const GAUGE_LENGTH = Math.PI * GAUGE_RADIUS;

type Lens = "team" | "member" | "client";

const COPY: Record<Lens, { title: string; lead: string; projects: string; projectsLead: string; recent: string; recentLead: string; focus: string; focusNote: string; chart: string }> = {
  team: { title: "A clear view of your team.", lead: "Good work starts with knowing where things stand.", projects: "Projects in motion", projectsLead: "Small steps toward the bigger picture", recent: "Recent work", recentLead: "The latest from your workspace", focus: "Focus time today", focusNote: "across your team", chart: "A week of progress" },
  member: { title: "A clear view of your work.", lead: "Your time, your tasks, and what comes next.", projects: "My projects", projectsLead: "Where your tasks live", recent: "My recent work", recentLead: "What you tracked lately", focus: "Your focus today", focusNote: "from you", chart: "My week" },
  client: { title: "Your projects, at a glance.", lead: "Progress on the work being done for you.", projects: "Your projects", projectsLead: "Progress on each one", recent: "Latest work", recentLead: "What the team logged lately", focus: "Focus time today", focusNote: "on your projects", chart: "A week of progress" },
};

/** The Overview. Every role gets the same bento of tiles, but each tile says something that makes
 *  sense for them: a team lead sees the team, a member sees their own time and tasks, and a client
 *  sees how their projects are going. */
export function DashboardHome({ ctx }: { ctx: PageContext }) {
  const { sessions, projects, go } = ctx;
  const { members, profile, preferences, navigate } = useWorkspace();
  const lens: Lens = profile.role === "Member" ? "member" : profile.role === "Client" ? "client" : "team";
  const copy = COPY[lens];
  const attention = useAttention(ctx);
  const seconds = sessions.reduce((sum, session) => sum + session.seconds, 0);
  const tasks = projects.flatMap((project) => project.tasks);
  const done = tasks.filter((task) => task.done).length;
  const open = tasks.length - done;
  const donePercent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - 6 + index);
    const daySessions = sessions.filter((session) => new Date(session.startedAt).toDateString() === date.toDateString());
    return {
      label: date.toLocaleDateString("en", { weekday: "short" }),
      date: date.toLocaleDateString("en", { day: "numeric", month: "short" }),
      hours: daySessions.reduce((sum, session) => sum + session.seconds, 0) / 3600,
    };
  });
  const maxHours = Math.max(...days.map((day) => day.hours), 4);
  const peakIndex = days.reduce((best, day, index) => (day.hours > days[best].hours ? index : best), 0);
  const todaySessions = sessions.filter((session) => new Date(session.startedAt).toDateString() === new Date().toDateString());
  const todaySeconds = todaySessions.reduce((sum, session) => sum + session.seconds, 0);
  const goalSeconds = preferences.dailyGoal * 3600;
  const goalPercent = Math.min(100, Math.round((todaySeconds / goalSeconds) * 100));
  const activeMembers = new Set(sessions.map((session) => session.memberId)).size;
  const teamSize = members.filter((member) => member.role !== "Client").length;
  const highPriority = tasks.filter((task) => !task.done && task.priority === "High").length;
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? "Project";
  const headline = attention[0];

  return (
    <div className="sf-page db-page">
      <div className="sf-page-header db-page-heading">
        <div>
          <div className="db-eyebrow">THE BIG PICTURE</div>
          <h1>{copy.title}</h1>
          <p>{copy.lead}</p>
        </div>
        {lens === "member" ? (
          <button className="sf-button primary" onClick={() => navigate("work", "overview")}>
            <Play size={17} weight="fill" /> Start tracking
          </button>
        ) : (
          <button className="sf-button primary" onClick={() => go("reports")}>
            <ArrowUpRight size={17} weight="bold" /> View reports
          </button>
        )}
      </div>

      <div className="db-bento">
        <StatTile hero title={lens === "member" ? "My time tracked" : "Time tracked"} action="Open timesheets" onOpen={() => go(lens === "client" ? "timesheets-time-activity" : "timesheets-submissions")}>
          <strong>{formatDuration(seconds)}</strong>
          <small>
            <span className="db-chip">
              {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
            </span>{" "}
            in your selected period
          </small>
        </StatTile>
        {lens === "member" ? (
          <StatTile title="Today's goal" action="Open Work" onOpen={() => navigate("work", "overview")}>
            <strong>
              {formatDuration(todaySeconds)}
              <em> / {preferences.dailyGoal}h</em>
            </strong>
            <div className="db-progress">
              <span style={{ width: `${goalPercent}%` }} />
            </div>
          </StatTile>
        ) : (
          <StatTile title={lens === "client" ? "People on your projects" : "Active members"} action="Open people" onOpen={() => go(lens === "client" ? "timesheets-time-activity" : "people-members")}>
            <strong>
              {activeMembers}
              {lens === "team" && <em> / {teamSize}</em>}
            </strong>
            <small>{lens === "client" ? "Working on what you asked for" : "People who tracked time"}</small>
          </StatTile>
        )}
        {lens === "member" ? (
          <StatTile title="Open tasks" action="Open tasks" onOpen={() => go("pm-tasks")}>
            <strong>{open.toString().padStart(2, "0")}</strong>
            <small>{highPriority ? `${highPriority} high priority` : "Nothing urgent"}</small>
          </StatTile>
        ) : (
          <StatTile title="Active projects" action="Open projects" onOpen={() => go("pm-projects")}>
            <strong>{projects.length.toString().padStart(2, "0")}</strong>
            <small>{open} tasks ready for the next step</small>
          </StatTile>
        )}
        <StatTile title="Tasks completed" action="Open tasks" onOpen={() => go("pm-tasks")}>
          <strong>
            {done}
            <em> / {tasks.length}</em>
          </strong>
          <div className="db-progress">
            <span style={{ width: `${donePercent}%` }} />
          </div>
        </StatTile>

        <section className="sf-card db-chart-tile">
          <div className="db-card-heading">
            <div>
              <h2>{copy.chart}</h2>
              <p>Tracked hours over the last seven days</p>
            </div>
            <button className="db-pill-button" onClick={() => go("timesheets-time-activity")}>
              Time &amp; Activity <ArrowRight size={14} weight="bold" />
            </button>
          </div>
          <div className="db-bars" role="img" aria-label={days.map((day) => `${day.date}: ${Math.round(day.hours * 100) / 100} hours tracked`).join("; ")}>
            {days.map((day, index) => (
              <div className="db-bar-col" key={day.date} title={`${day.date}: ${Math.round(day.hours * 100) / 100}h`}>
                <div className="db-bar-track">
                  <div className={`db-bar ${index === peakIndex && day.hours > 0 ? "peak" : ""}`} style={{ "--h": `${Math.max((day.hours / maxHours) * 100, 9)}%` } as CSSProperties}>
                    <em className="db-bar-bubble">{Math.round(day.hours * 10) / 10}h</em>
                  </div>
                </div>
                <span>{day.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="sf-card db-attention">
          <div className="db-card-heading">
            <div>
              <h2>Needs your attention</h2>
              <p>A few small things to keep moving</p>
            </div>
          </div>
          <div className="db-attention-body">
            {attention.length ? (
              <ul className="db-attention-list">
                {attention.slice(0, 3).map((item) => (
                  <li key={item.id}>
                    <button onClick={() => go(item.page)}>
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="db-attention-clear">
                <span className="db-attention-check" aria-hidden="true">
                  <CheckCircle weight="fill" />
                </span>
                <p className="db-attention-title">You&apos;re all caught up</p>
                <p className="db-muted">{lens === "member" ? "Nothing is waiting on you." : "Your team is ready for what comes next."}</p>
              </div>
            )}
          </div>
          {headline ? (
            <button className="sf-button primary db-wide" onClick={() => go(headline.page)}>
              <CheckCircle size={18} weight="fill" />
              {attention.length > 3 ? `See all ${attention.length}` : headline.action}
            </button>
          ) : (
            <button className="sf-button primary db-wide" onClick={() => (lens === "member" ? navigate("work", "overview") : lens === "client" ? go("reports") : go("notifications"))}>
              <CheckCircle size={18} weight="fill" />
              {lens === "member" ? "Start tracking" : lens === "client" ? "Open reports" : "Open notifications"}
            </button>
          )}
        </section>

        <section className="sf-card db-projects-tile">
          <div className="db-card-heading">
            <div>
              <h2>{copy.projects}</h2>
              <p>{copy.projectsLead}</p>
            </div>
            <button className="db-pill-button" onClick={() => go("pm-projects")}>
              View all <ArrowRight size={14} weight="bold" />
            </button>
          </div>
          <div className="db-prows">
            {projects.map((project) => {
              const complete = project.tasks.filter((task) => task.done).length;
              const percent = project.tasks.length ? Math.round((complete / project.tasks.length) * 100) : 0;
              return (
                <button key={project.id} className="db-prow" onClick={() => go("pm-project", project.id)}>
                  <span className={`db-project-icon ${project.color}`}>
                    <Folder weight="fill" />
                  </span>
                  <span className="db-prow-copy">
                    <strong>{project.name}</strong>
                    <small>
                      {complete} of {project.tasks.length} tasks complete
                    </small>
                    <span className="db-prow-bar" aria-hidden="true">
                      <i style={{ width: `${percent}%` }} />
                    </span>
                  </span>
                  <span className="db-prow-percent">{percent}%</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="sf-card db-recent-tile">
          <div className="db-card-heading">
            <div>
              <h2>{copy.recent}</h2>
              <p>{copy.recentLead}</p>
            </div>
            <Badge text="Shared with Work" />
          </div>
          <div className="db-recent-rows">
            {sessions.slice(0, 4).map((session) => {
              const member = members.find((person) => person.id === session.memberId);
              return (
                <button key={session.id} className="db-recent" onClick={() => go("timesheets-submissions", session.id)}>
                  <Avatar name={lens === "member" ? projectName(session.projectId) : member?.name || "Team member"} color={member?.color} />
                  <span className="db-recent-copy">
                    <strong>{lens === "member" ? session.taskTitle : member?.name || "Team member"}</strong>
                    <small>{lens === "member" ? projectName(session.projectId) : session.taskTitle}</small>
                  </span>
                  <span className="db-recent-time">{formatDuration(session.seconds)}</span>
                  <Badge text={session.status} />
                </button>
              );
            })}
            {!sessions.length && (
              <div className="db-no-recent">
                <Clock size={28} />
                <p>Your next work session starts here.</p>
                <button className="sf-button" onClick={() => navigate("work", "overview")}>
                  Open Work <ArrowDownRight />
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="sf-card db-gauge-tile">
          <div className="db-card-heading">
            <div>
              <h2>Task progress</h2>
              <p>{lens === "member" ? "Across your projects" : "Across every active project"}</p>
            </div>
          </div>
          <div className="db-gauge" role="img" aria-label={`${donePercent}% of tasks completed`}>
            <svg viewBox="0 0 200 112" aria-hidden="true">
              <path className="db-gauge-track" d="M 20 100 A 80 80 0 0 1 180 100" />
              <path className="db-gauge-fill" d="M 20 100 A 80 80 0 0 1 180 100" style={{ "--len": (GAUGE_LENGTH * donePercent) / 100 } as CSSProperties} />
            </svg>
            <div className="db-gauge-value">
              <strong>{donePercent}%</strong>
              <span>Tasks completed</span>
            </div>
          </div>
          <div className="db-gauge-legend">
            <span>
              <i className="done" /> Completed · {done}
            </span>
            <span>
              <i /> Remaining · {tasks.length - done}
            </span>
          </div>
          <div className="db-gauge-facts">
            <div>
              <strong>{open}</strong>
              <span>Open tasks</span>
            </div>
            <div>
              <strong>{highPriority}</strong>
              <span>High priority</span>
            </div>
          </div>
        </section>

        <FocusTile todaySeconds={todaySeconds} todaySessions={todaySessions.length} note={copy.focusNote} canTrack={lens !== "client"} onActivity={() => go("activity")} />
      </div>
    </div>
  );
}
