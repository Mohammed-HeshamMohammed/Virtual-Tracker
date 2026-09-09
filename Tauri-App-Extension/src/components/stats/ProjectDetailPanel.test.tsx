import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectDetailPanel } from "./ProjectDetailPanel";
import type { ProjectInfo } from "../../types";

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

describe("ProjectDetailPanel", () => {
  it("renders nothing without a project", () => {
    expect(renderToStaticMarkup(<ProjectDetailPanel project={null} />)).toBe("");
  });

  it("shows the project type as the hint", () => {
    const html = renderToStaticMarkup(<ProjectDetailPanel project={baseProject} />);
    expect(html).toContain("Calling");
    expect(html).toContain("This project");
  });

  it("flags a required stop note and an exhausted budget", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailPanel project={{ ...baseProject, requireStopNote: true, budgetExhausted: true }} />,
    );
    expect(html).toContain("Stop note required");
    expect(html).toContain("Budget spent");
  });

  it("never claims a task-less project type supports adding tasks, even if the viewer's role would allow it", () => {
    // The exact bug this guards: canCreateTasks is a pure role check with no
    // idea whether the project TYPE has tasks at all, so a manager on a
    // calling project gets canCreateTasks: true from the backend despite
    // there being no task flow on a calling project to use it in.
    const html = renderToStaticMarkup(<ProjectDetailPanel project={{ ...baseProject, hasTasks: false, canCreateTasks: true }} />);
    expect(html).not.toContain("You can add tasks here");
  });

  it("mentions adding tasks only when both the project type and the role allow it", () => {
    const allowed = renderToStaticMarkup(
      <ProjectDetailPanel project={{ ...baseProject, hasTasks: true, canCreateTasks: true }} />,
    );
    expect(allowed).toContain("You can add tasks here");

    const roleOnly = renderToStaticMarkup(
      <ProjectDetailPanel project={{ ...baseProject, hasTasks: false, canCreateTasks: true }} />,
    );
    expect(roleOnly).not.toContain("You can add tasks here");

    const typeOnly = renderToStaticMarkup(
      <ProjectDetailPanel project={{ ...baseProject, hasTasks: true, canCreateTasks: false }} />,
    );
    expect(typeOnly).not.toContain("You can add tasks here");
  });

  it("no longer duplicates budget scope or member count - those moved to ProjectBudgetTile and the sidebar row", () => {
    const html = renderToStaticMarkup(<ProjectDetailPanel project={baseProject} />);
    expect(html).not.toContain("Team budget");
    expect(html).not.toContain("Personal budget");
    expect(html).not.toContain("members");
  });
});
