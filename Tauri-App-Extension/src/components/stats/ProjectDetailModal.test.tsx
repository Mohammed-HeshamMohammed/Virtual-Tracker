import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectDetailModal } from "./ProjectDetailModal";
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
    open: boolean;
    appBreakdown: ProjectAppTime[];
    screenshots: ScreenshotRef[];
    screenshotImages: Record<string, string>;
    selectedScreenshotId: string | null;
  }> = {},
) {
  return renderToStaticMarkup(
    <ProjectDetailModal
      open={overrides.open ?? true}
      project={project}
      appBreakdown={overrides.appBreakdown ?? []}
      screenshots={overrides.screenshots ?? []}
      screenshotImages={overrides.screenshotImages ?? {}}
      selectedScreenshotId={overrides.selectedScreenshotId ?? null}
      onSelectScreenshot={noop}
      onClose={noop}
    />,
  );
}

describe("ProjectDetailModal", () => {
  it("renders nothing without a project, or while closed", () => {
    expect(render(null)).toBe("");
    expect(render(baseProject, { open: false })).toBe("");
  });

  it("shows the project name as the title and its type as the subtitle", () => {
    const html = render(baseProject);
    expect(html).toContain("Support Line");
    expect(html).toContain("Calling");
    expect(html).toContain("modal-backdrop");
  });

  it("flags a required stop note and an exhausted budget", () => {
    const html = render({ ...baseProject, requireStopNote: true, budgetExhausted: true });
    expect(html).toContain("Stop note required");
    expect(html).toContain("Budget spent");
  });

  it("never claims a task-less project type supports adding tasks, even if the viewer's role would allow it", () => {
    const html = render({ ...baseProject, hasTasks: false, canCreateTasks: true });
    expect(html).not.toContain("You can add tasks here");
  });

  it("mentions adding tasks only when both the project type and the role allow it", () => {
    expect(render({ ...baseProject, hasTasks: true, canCreateTasks: true })).toContain("You can add tasks here");
    expect(render({ ...baseProject, hasTasks: false, canCreateTasks: true })).not.toContain("You can add tasks here");
    expect(render({ ...baseProject, hasTasks: true, canCreateTasks: false })).not.toContain("You can add tasks here");
  });

  it("no longer duplicates budget scope or member count - those live in ProjectBudgetTile and the sidebar header", () => {
    const html = render(baseProject);
    expect(html).not.toContain("Team budget");
    expect(html).not.toContain("Personal budget");
    expect(html).not.toContain("members");
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
    expect(html).toMatch(/width:100%/);
    expect(html).toMatch(/width:50%/);
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

  it("says there's nothing tracked yet when both sections are empty", () => {
    expect(render(baseProject)).toContain("Nothing tracked here yet this week.");
  });
});
