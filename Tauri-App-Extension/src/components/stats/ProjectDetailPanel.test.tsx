import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectDetailPanel } from "./ProjectDetailPanel";
import type { ProjectAppTime, ProjectInfo, ScreenshotRef } from "../../types";

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

const noop = () => {};

function render(
  project: ProjectInfo | null,
  overrides: Partial<{
    appBreakdown: ProjectAppTime[];
    screenshots: ScreenshotRef[];
    screenshotImages: Record<string, string>;
    selectedScreenshotId: string | null;
  }> = {},
) {
  return renderToStaticMarkup(
    <ProjectDetailPanel
      project={project}
      appBreakdown={overrides.appBreakdown ?? []}
      screenshots={overrides.screenshots ?? []}
      screenshotImages={overrides.screenshotImages ?? {}}
      selectedScreenshotId={overrides.selectedScreenshotId ?? null}
      onSelectScreenshot={noop}
    />,
  );
}

describe("ProjectDetailPanel", () => {
  it("renders nothing without a project", () => {
    expect(render(null)).toBe("");
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
    expect(render({ ...baseProject, hasTasks: true, canCreateTasks: true })).toContain("You can add tasks here");
    expect(render({ ...baseProject, hasTasks: false, canCreateTasks: true })).not.toContain("You can add tasks here");
    expect(render({ ...baseProject, hasTasks: true, canCreateTasks: false })).not.toContain("You can add tasks here");
  });

  it("no longer duplicates budget scope or member count - those moved to ProjectBudgetTile and the sidebar row", () => {
    const html = render(baseProject);
    expect(html).not.toContain("Team budget");
    expect(html).not.toContain("Personal budget");
    expect(html).not.toContain("members");
  });

  it("hides the top-apps section when there is nothing tracked yet", () => {
    expect(render(baseProject)).not.toContain("top apps");
  });

  it("shows each app's time, and sizes its bar relative to the largest one", () => {
    const html = render(baseProject, {
      appBreakdown: [
        { appName: "Zoom", totalSeconds: 3600 },
        { appName: "Browser", totalSeconds: 1800 },
      ],
    });
    expect(html).toContain("Zoom");
    expect(html).toContain("Browser");
    expect(html).toMatch(/width:100%/); // Zoom, the largest, fills the bar
    expect(html).toMatch(/width:50%/); // Browser is half of Zoom's time
  });

  it("hides the screenshots section when there are none for this project", () => {
    expect(render(baseProject)).not.toContain("Recent screenshots");
  });

  it("shows a screenshot strip and the selected image once loaded", () => {
    const shots: ScreenshotRef[] = [{ id: "s1", capturedAt: "2024-01-01T12:00:00Z" }];
    const withoutImage = render(baseProject, { screenshots: shots, selectedScreenshotId: "s1" });
    expect(withoutImage).toContain("Recent screenshots");
    expect(withoutImage).toContain("shot-preview-loading");

    const withImage = render(baseProject, {
      screenshots: shots,
      selectedScreenshotId: "s1",
      screenshotImages: { s1: "data:image/png;base64,abc" },
    });
    expect(withImage).toContain("data:image/png;base64,abc");
    expect(withImage).not.toContain("shot-preview-loading");
  });
});
