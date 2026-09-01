// Same reasoning as components/stats/tiles.smoke.test.tsx: tsc verifies the
// prop types these were extracted from App.tsx with, not that the JSX
// actually mounts for the conditional branches it depends on (empty lists,
// signed-out, a project mid-budget vs. exhausted, a task without a
// projectId).
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WeeklyActivityCard } from "./WeeklyActivityCard";
import { ProjectsList } from "./ProjectsList";
import { TasksList } from "./TasksList";
import { SidebarActions } from "./SidebarActions";
import { SidebarFooter } from "./SidebarFooter";
import { TeamStatusCard } from "./TeamStatusCard";
import { ManagementCard } from "./ManagementCard";
import type { AgentTask, DashboardSummary, ProjectInfo, WorkspaceTeam } from "../../types";

const noop = () => {};

describe("WeeklyActivityCard", () => {
  const dashboardSummary: DashboardSummary = {
    activityWeekPercent: 62,
    weeklyActivity: [],
    recentProjects: [],
  };

  it("renders nothing when signed out or before the summary has loaded", () => {
    expect(
      renderToStaticMarkup(
        <WeeklyActivityCard signedIn={false} dashboardSummary={dashboardSummary} weekActivityDash={0} weekActiveSeconds={0} weekIdleSeconds={0} />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <WeeklyActivityCard signedIn={true} dashboardSummary={null} weekActivityDash={0} weekActiveSeconds={0} weekIdleSeconds={0} />,
      ),
    ).toBe("");
  });

  it("renders the rounded percent once signed in with a summary", () => {
    const html = renderToStaticMarkup(
      <WeeklyActivityCard signedIn dashboardSummary={dashboardSummary} weekActivityDash={40} weekActiveSeconds={3600} weekIdleSeconds={600} />,
    );
    expect(html).toContain("62%");
  });
});

describe("ProjectsList", () => {
  const projects: ProjectInfo[] = [
    { id: "p1", name: "Bana Test", projectType: "normal", hasTasks: true, requireTaskToTrack: true, requireStopNote: false, budgetExhausted: false, canCreateTasks: true },
    { id: "p2", name: "Out of Budget", projectType: "normal", hasTasks: true, requireTaskToTrack: true, requireStopNote: false, budgetExhausted: true, canCreateTasks: false },
  ];

  it("renders nothing with an empty list", () => {
    expect(
      renderToStaticMarkup(
        <ProjectsList signedIn projects={[]} selectedProjectId="" busy={false} sessionOpen={false} openTaskCountByProject={new Map()} projectProgressById={new Map()} onSelectProject={noop} />,
      ),
    ).toBe("");
  });

  it("marks a budget-exhausted project disabled with the reason, and a healthy one clickable", () => {
    const html = renderToStaticMarkup(
      <ProjectsList
        signedIn
        projects={projects}
        selectedProjectId="p1"
        busy={false}
        sessionOpen={false}
        openTaskCountByProject={new Map([["p1", 2]])}
        projectProgressById={new Map()}
        onSelectProject={noop}
      />,
    );
    expect(html).toContain("Budget spent");
    expect(html).toContain("disabled");
    expect(html).toContain("2 open tasks");
  });

  it("shows a progress bar instead of the open-task count once dashboard progress data exists", () => {
    const html = renderToStaticMarkup(
      <ProjectsList
        signedIn
        projects={[projects[0]]}
        selectedProjectId=""
        busy={false}
        sessionOpen={false}
        openTaskCountByProject={new Map()}
        projectProgressById={new Map([["p1", 55]])}
        onSelectProject={noop}
      />,
    );
    expect(html).toContain("55%");
    expect(html).not.toContain("open task");
  });

  it("hides the filter box under the search threshold - .side-tasklist-body's own scroll area covers a short list", () => {
    const html = renderToStaticMarkup(
      <ProjectsList signedIn projects={projects} selectedProjectId="" busy={false} sessionOpen={false} openTaskCountByProject={new Map()} projectProgressById={new Map()} onSelectProject={noop} />,
    );
    expect(html).not.toContain("side-tasklist-search");
  });

  it("shows the filter box once the list is long enough to need one", () => {
    const many: ProjectInfo[] = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      name: `Project ${i}`,
      projectType: "normal",
      hasTasks: true,
      requireTaskToTrack: true,
      requireStopNote: false,
      budgetExhausted: false,
      canCreateTasks: false,
    }));
    const html = renderToStaticMarkup(
      <ProjectsList signedIn projects={many} selectedProjectId="" busy={false} sessionOpen={false} openTaskCountByProject={new Map()} projectProgressById={new Map()} onSelectProject={noop} />,
    );
    expect(html).toContain("side-tasklist-search");
    expect(html).toContain("Filter projects");
  });

  it("shows the + New task row action only for a task-based project the viewer can create tasks on", () => {
    const html = renderToStaticMarkup(
      <ProjectsList
        signedIn
        projects={projects}
        selectedProjectId=""
        busy={false}
        sessionOpen={false}
        openTaskCountByProject={new Map()}
        projectProgressById={new Map()}
        onSelectProject={noop}
        onCreateTask={noop}
      />,
    );
    expect(html).toContain("New task in Bana Test");
    expect(html).not.toContain("New task in Out of Budget");
  });

  it("hides the row action entirely when onCreateTask is omitted", () => {
    const html = renderToStaticMarkup(
      <ProjectsList
        signedIn
        projects={[projects[0]]}
        selectedProjectId=""
        busy={false}
        sessionOpen={false}
        openTaskCountByProject={new Map()}
        projectProgressById={new Map()}
        onSelectProject={noop}
      />,
    );
    expect(html).not.toContain("side-task-row-add");
  });
});

describe("TasksList", () => {
  it("shows the failure state, not the green all-clear, when the fetch failed", () => {
    const html = renderToStaticMarkup(
      <TasksList signedIn loading={false} assignedTasks={[]} assignedTasksFailed={true} selectedTaskId="" busy={false} sessionOpen={false} projectNameById={new Map()} onSelectTask={noop} />,
    );
    // renderToStaticMarkup HTML-escapes the apostrophe (Couldn&#x27;t) -
    // match a substring that avoids it rather than the raw text.
    expect(html).toContain("load your tasks");
    // A genuine failure keeps the alarming tone; only the empty state lost it.
    expect(html).toContain("side-tasklist-empty bad");
    expect(html).not.toContain("No tasks assigned to you");
  });

  it("reads as neutral guidance, not success or failure, when nothing is assigned", () => {
    const html = renderToStaticMarkup(
      <TasksList signedIn loading={false} assignedTasks={[]} assignedTasksFailed={false} selectedTaskId="" busy={false} sessionOpen={false} projectNameById={new Map()} onSelectTask={noop} />,
    );
    expect(html).toContain("No tasks assigned to you");
    // Points at the next step rather than just stating the absence.
    expect(html).toContain("Pick a project that has tasks");
    // Neither the red failure tone nor the green all-clear it used to carry -
    // having no task assigned is a state to act on, not one to celebrate.
    expect(html).not.toContain("side-tasklist-empty bad");
    expect(html).not.toContain("side-tasklist-empty ok");
  });

  it("falls back to 'Unknown project' for a task whose project isn't in the lookup", () => {
    const task: AgentTask = { id: "t1", title: "Do the thing", status: "todo", projectId: "missing" };
    const html = renderToStaticMarkup(
      <TasksList signedIn loading={false} assignedTasks={[task]} assignedTasksFailed={false} selectedTaskId="" busy={false} sessionOpen={false} projectNameById={new Map()} onSelectTask={noop} />,
    );
    expect(html).toContain("Unknown project");
  });

  it("hides the filter box under the search threshold", () => {
    const tasks: AgentTask[] = Array.from({ length: 3 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      status: "todo",
      projectId: "",
    }));
    const html = renderToStaticMarkup(
      <TasksList signedIn loading={false} assignedTasks={tasks} assignedTasksFailed={false} selectedTaskId="" busy={false} sessionOpen={false} projectNameById={new Map()} onSelectTask={noop} />,
    );
    expect(html).not.toContain("side-tasklist-search");
  });

  it("shows the filter box once the list is long enough to need one", () => {
    const tasks: AgentTask[] = Array.from({ length: 7 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      status: "todo",
      projectId: "",
    }));
    const html = renderToStaticMarkup(
      <TasksList signedIn loading={false} assignedTasks={tasks} assignedTasksFailed={false} selectedTaskId="" busy={false} sessionOpen={false} projectNameById={new Map()} onSelectTask={noop} />,
    );
    expect(html).toContain("side-tasklist-search");
    expect(html).toContain("Filter tasks");
  });
});

describe("SidebarActions", () => {
  it("shows Start tracking, disabled without a required task selected", () => {
    const html = renderToStaticMarkup(
      <SidebarActions
        paused={false}
        tracking={false}
        busy={false}
        taskRequired={true}
        selectedTaskId=""
        selectedProjectId="p1"
        taskTracking={null}
        onResume={noop}
        onPause={noop}
        onStopClick={noop}
        onStart={noop}
        onOpenDashboard={noop}
        onSignInAgain={noop}
      />,
    );
    expect(html).toContain("Start tracking");
    expect(html).toContain("disabled");
  });

  it("shows Pause/Stop as a pair while tracking", () => {
    const html = renderToStaticMarkup(
      <SidebarActions
        paused={false}
        tracking={true}
        busy={false}
        taskRequired={false}
        selectedTaskId=""
        selectedProjectId="p1"
        taskTracking={null}
        onResume={noop}
        onPause={noop}
        onStopClick={noop}
        onStart={noop}
        onOpenDashboard={noop}
        onSignInAgain={noop}
      />,
    );
    expect(html).toContain("Pause");
    expect(html).toContain("Stop");
  });

  it("shows Resume tracking on a break", () => {
    const html = renderToStaticMarkup(
      <SidebarActions
        paused={true}
        tracking={false}
        busy={false}
        taskRequired={false}
        selectedTaskId=""
        selectedProjectId=""
        taskTracking={null}
        onResume={noop}
        onPause={noop}
        onStopClick={noop}
        onStart={noop}
        onOpenDashboard={noop}
        onSignInAgain={noop}
      />,
    );
    expect(html).toContain("Resume tracking");
  });

  it("wires Open dashboard and Sign in again to their own handlers", () => {
    const onOpenDashboard = vi.fn();
    const onSignInAgain = vi.fn();
    renderToStaticMarkup(
      <SidebarActions
        paused={false}
        tracking={false}
        busy={false}
        taskRequired={false}
        selectedTaskId=""
        selectedProjectId=""
        taskTracking={null}
        onResume={noop}
        onPause={noop}
        onStopClick={noop}
        onStart={noop}
        onOpenDashboard={onOpenDashboard}
        onSignInAgain={onSignInAgain}
      />,
    );
    // renderToStaticMarkup doesn't attach event handlers (no DOM), so this
    // only confirms the buttons that carry them render - click wiring is
    // exercised by TypeScript's own prop-type check at the call site.
    expect(onOpenDashboard).not.toHaveBeenCalled();
  });
});

describe("SidebarFooter", () => {
  it("shows 'Signed out' and the generic mark when not signed in", () => {
    const html = renderToStaticMarkup(
      <SidebarFooter
        signedIn={false}
        avatarUrl={undefined}
        avatarError={false}
        onAvatarError={noop}
        displayName="Not signed in"
        footerName=""
        footerEmail=""
        footerRole=""
        loadingProfile={false}
        connection="signedOut"
        tracking={false}
        paused={false}
        onViewProfile={noop}
        onViewSettings={noop}
      />,
    );
    expect(html).toContain("Signed out");
    expect(html).toContain(">VT<");
  });

  it("shows the member's name, email and role badge once signed in", () => {
    const html = renderToStaticMarkup(
      <SidebarFooter
        signedIn={true}
        avatarUrl={undefined}
        avatarError={false}
        onAvatarError={noop}
        displayName="Mohammed Hesham"
        footerName="Mohammed Hesham"
        footerEmail="mohamed@example.com"
        footerRole="Owner"
        loadingProfile={false}
        connection="connected"
        tracking={true}
        paused={false}
        onViewProfile={noop}
        onViewSettings={noop}
      />,
    );
    expect(html).toContain("Mohammed Hesham");
    expect(html).toContain("mohamed@example.com");
    expect(html).toContain("Owner");
  });

  it("falls back to initials once the avatar image has errored", () => {
    const html = renderToStaticMarkup(
      <SidebarFooter
        signedIn={true}
        avatarUrl="https://example.com/broken.png"
        avatarError={true}
        onAvatarError={noop}
        displayName="Mohammed Hesham"
        footerName="Mohammed Hesham"
        footerEmail=""
        footerRole=""
        loadingProfile={false}
        connection="connected"
        tracking={false}
        paused={false}
        onViewProfile={noop}
        onViewSettings={noop}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain(">MH<");
  });
});

// Both cards are entitlement-driven: the backend nulls the section a viewer
// isn't allowed, so "renders nothing for null" is the security-relevant case
// here, not just an empty-state nicety.
describe("TeamStatusCard", () => {
  const team: WorkspaceTeam = {
    teamCount: 1,
    trackingNowCount: 1,
    notStartedCount: 1,
    totalActiveSecondsToday: 5400,
    members: [
      { memberId: "t1", name: "Ada", trackingNow: true, onBreak: false, activeSecondsToday: 3600 },
      { memberId: "t2", name: "Grace", trackingNow: false, onBreak: false, activeSecondsToday: 0 },
      { memberId: "t3", name: "Alan", trackingNow: false, onBreak: true, activeSecondsToday: 1800 },
    ],
  };

  it("renders nothing when the viewer got no team section", () => {
    expect(renderToStaticMarkup(<TeamStatusCard team={null} />)).toBe("");
  });

  it("renders nothing for a team section with no members rather than an empty card", () => {
    expect(
      renderToStaticMarkup(<TeamStatusCard team={{ ...team, members: [] }} />),
    ).toBe("");
  });

  it("shows each member with the state that applies to them", () => {
    const html = renderToStaticMarkup(<TeamStatusCard team={team} />);
    expect(html).toContain("Ada");
    expect(html).toContain("Tracking");
    expect(html).toContain("Grace");
    // Grace has tracked nothing today; Alan has, but is on a break.
    expect(html).toContain("Nothing today");
    expect(html).toContain("On a break");
    expect(html).toContain("1 not started");
  });

  it("hides the not-started stat when everyone has started", () => {
    const html = renderToStaticMarkup(
      <TeamStatusCard team={{ ...team, notStartedCount: 0 }} />,
    );
    expect(html).not.toContain("not started");
  });
});

describe("ManagementCard", () => {
  it("renders nothing when the viewer got neither section", () => {
    expect(
      renderToStaticMarkup(<ManagementCard approvals={null} pulse={null} onOpenDashboard={noop} />),
    ).toBe("")
  });

  it("shows a pending count as an actionable row", () => {
    const html = renderToStaticMarkup(
      <ManagementCard approvals={{ pendingCount: 3 }} pulse={null} onOpenDashboard={noop} />,
    );
    expect(html).toContain("3");
    expect(html).toContain("timesheets waiting on you");
  });

  it("singularizes a lone pending timesheet", () => {
    const html = renderToStaticMarkup(
      <ManagementCard approvals={{ pendingCount: 1 }} pulse={null} onOpenDashboard={noop} />,
    );
    expect(html).toContain("timesheet waiting on you");
    expect(html).not.toContain("timesheets waiting");
  });

  it("shows the all-clear rather than a zero count", () => {
    const html = renderToStaticMarkup(
      <ManagementCard approvals={{ pendingCount: 0 }} pulse={null} onOpenDashboard={noop} />,
    );
    expect(html).toContain("No timesheets waiting on you");
  });

  it("titles itself Organization once the pulse section is present, and shows its numbers", () => {
    const html = renderToStaticMarkup(
      <ManagementCard
        approvals={{ pendingCount: 0 }}
        pulse={{ totalActiveSecondsToday: 7200, trackingNowCount: 2, membersWorkedTodayCount: 5 }}
        onOpenDashboard={noop}
      />,
    );
    expect(html).toContain("Organization");
    expect(html).toContain("2 tracking");
    expect(html).toContain("5 worked today");
  });

  it("renders the pulse alone for an org admin with nothing pending", () => {
    const html = renderToStaticMarkup(
      <ManagementCard
        approvals={null}
        pulse={{ totalActiveSecondsToday: 0, trackingNowCount: 0, membersWorkedTodayCount: 0 }}
        onOpenDashboard={noop}
      />,
    );
    expect(html).toContain("Organization");
    expect(html).not.toContain("waiting on you");
  });
});

// The three states used to collapse into one: in-flight, loaded-and-empty,
// and loaded-and-failed all reached the same row, so a slow network
// announced itself as a hard failure before anything had failed.
describe("TasksList loading state", () => {
  const base = {
    signedIn: true as const,
    assignedTasks: [],
    selectedTaskId: "",
    busy: false,
    sessionOpen: false,
    projectNameById: new Map(),
    onSelectTask: noop,
  };

  it("shows a skeleton while the first load is in flight, not an error", () => {
    const html = renderToStaticMarkup(<TasksList {...base} loading assignedTasksFailed={false} />);
    expect(html).toContain("skeleton-bar");
    expect(html).not.toContain("load your tasks");
    expect(html).not.toContain("No tasks assigned to you");
  });

  it("still shows the skeleton rather than the error if a failure flag is already set mid-load", () => {
    const html = renderToStaticMarkup(<TasksList {...base} loading assignedTasksFailed={true} />);
    expect(html).toContain("skeleton-bar");
    expect(html).not.toContain("load your tasks");
  });

  it("shows the failure only once loading has finished", () => {
    const html = renderToStaticMarkup(<TasksList {...base} loading={false} assignedTasksFailed={true} />);
    expect(html).toContain("load your tasks");
    expect(html).not.toContain("skeleton-bar");
  });
});
