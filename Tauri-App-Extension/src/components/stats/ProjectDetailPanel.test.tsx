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

  it("mentions adding tasks only when the viewer is allowed to", () => {
    const allowed = renderToStaticMarkup(
      <ProjectDetailPanel project={{ ...baseProject, canCreateTasks: true }} />,
    );
    expect(allowed).toContain("You can add tasks here");

    const notAllowed = renderToStaticMarkup(<ProjectDetailPanel project={baseProject} />);
    expect(notAllowed).not.toContain("You can add tasks here");
  });
});
