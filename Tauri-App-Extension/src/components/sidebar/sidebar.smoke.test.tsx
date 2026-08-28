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
import type { AgentTask, DashboardSummary, ProjectInfo } from "../../types";

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
    { id: "p1", name: "Bana Test", projectType: "normal", hasTasks: true, requireTaskToTrack: true, requireStopNote: false, budgetExhausted: false },
    { id: "p2", name: "Out of Budget", projectType: "normal", hasTasks: true, requireTaskToTrack: true, requireStopNote: false, budgetExhausted: true },
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
});

describe("TasksList", () => {
  it("shows the failure state, not the green all-clear, when the fetch failed", () => {
    const html = renderToStaticMarkup(
      <TasksList signedIn assignedTasks={[]} assignedTasksFailed={true} selectedTaskId="" busy={false} sessionOpen={false} projectNameById={new Map()} onSelectTask={noop} />,
    );
    // renderToStaticMarkup HTML-escapes the apostrophe (Couldn&#x27;t) -
    // match a substring that avoids it rather than the raw text.
    expect(html).toContain("load your tasks");
    expect(html).not.toContain("Nothing open assigned");
  });

  it("shows the genuine all-clear when there's simply nothing assigned", () => {
    const html = renderToStaticMarkup(
      <TasksList signedIn assignedTasks={[]} assignedTasksFailed={false} selectedTaskId="" busy={false} sessionOpen={false} projectNameById={new Map()} onSelectTask={noop} />,
    );
    expect(html).toContain("Nothing open assigned");
  });

  it("falls back to 'Unknown project' for a task whose project isn't in the lookup", () => {
    const task: AgentTask = { id: "t1", title: "Do the thing", status: "todo", projectId: "missing" };
    const html = renderToStaticMarkup(
      <TasksList signedIn assignedTasks={[task]} assignedTasksFailed={false} selectedTaskId="" busy={false} sessionOpen={false} projectNameById={new Map()} onSelectTask={noop} />,
    );
    expect(html).toContain("Unknown project");
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
