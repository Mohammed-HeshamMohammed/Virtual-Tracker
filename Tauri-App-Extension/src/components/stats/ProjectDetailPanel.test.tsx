import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectDetailPanel } from "./ProjectDetailPanel";
import type { ProjectBudgetStatus, ProjectInfo, RecentProjectSummary } from "../../types";

const baseProject: ProjectInfo = {
  id: "p1",
  name: "Support Line",
  projectType: "calling",
  hasTasks: false,
  requireTaskToTrack: false,
  requireStopNote: false,
  budgetExhausted: false,
  budgetSpentPercent: null,
  canCreateTasks: false,
};

function render(
  project: ProjectInfo,
  projectBudget: ProjectBudgetStatus | null = null,
  recentProjects: RecentProjectSummary[] = [],
) {
  return renderToStaticMarkup(
    <ProjectDetailPanel project={project} projectBudget={projectBudget} recentProjects={recentProjects} />,
  );
}

describe("ProjectDetailPanel", () => {
  it("renders nothing without a project", () => {
    expect(
      renderToStaticMarkup(<ProjectDetailPanel project={null} projectBudget={null} recentProjects={[]} />),
    ).toBe("");
  });

  it("shows the project type as the hint", () => {
    const html = render(baseProject);
    expect(html).toContain("Calling");
    expect(html).toContain("This project");
  });

  it("flags a required stop note and an exhausted budget", () => {
    const html = render({ ...baseProject, requireStopNote: true, budgetExhausted: true });
    expect(html).toContain("Stop note required");
    expect(html).toContain("Budget spent");
  });

  it("never claims a task-less project type supports adding tasks, even if the viewer's role would allow it", () => {
    // The exact bug this guards: canCreateTasks is a pure role check with no
    // idea whether the project TYPE has tasks at all, so a manager on a
    // calling project gets canCreateTasks: true from the backend despite
    // there being no task flow on a calling project to use it in.
    const html = render({ ...baseProject, hasTasks: false, canCreateTasks: true });
    expect(html).not.toContain("You can add tasks here");
  });

  it("mentions adding tasks only when both the project type and the role allow it", () => {
    const allowed = render({ ...baseProject, hasTasks: true, canCreateTasks: true });
    expect(allowed).toContain("You can add tasks here");

    const roleOnly = render({ ...baseProject, hasTasks: false, canCreateTasks: true });
    expect(roleOnly).not.toContain("You can add tasks here");

    const typeOnly = render({ ...baseProject, hasTasks: true, canCreateTasks: false });
    expect(typeOnly).not.toContain("You can add tasks here");
  });

  it("labels the budget scope when a project budget is loaded", () => {
    const personal: ProjectBudgetStatus = {
      scope: "per_person",
      capSeconds: 36000,
      spentSeconds: 3600,
      remainingSeconds: 32400,
    };
    expect(render(baseProject, personal)).toContain("Personal budget");

    const shared: ProjectBudgetStatus = { ...personal, scope: "shared" };
    expect(render(baseProject, shared)).toContain("Team budget");

    expect(render(baseProject, null)).not.toContain("budget");
  });

  it("shows team size only when this project is found in recentProjects", () => {
    const recentProjects: RecentProjectSummary[] = [
      { id: "p1", name: "Support Line", progress: 0, memberCount: 4 },
      { id: "other", name: "Something Else", progress: 50, memberCount: 9 },
    ];
    expect(render(baseProject, null, recentProjects)).toContain("4 members");
    expect(render(baseProject, null, [])).not.toContain("members");

    const solo: RecentProjectSummary[] = [{ id: "p1", name: "Support Line", progress: 0, memberCount: 1 }];
    expect(render(baseProject, null, solo)).toContain("1 member");
    expect(render(baseProject, null, solo)).not.toContain("1 members");
  });
});
