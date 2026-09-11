import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectDetailPanel, radarRadius } from "./ProjectDetailPanel";
import type { ProjectAppBreakdown, ProjectAppTime, ProjectInfo, ScreenshotRef } from "../../types";

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

/** Most cases only care about which apps are plotted, so they keep passing a
 *  plain list and this fills in the totals the panel now also receives. */
function breakdownOf(apps: ProjectAppTime[]): ProjectAppBreakdown {
  const shown = apps.reduce((sum, a) => sum + a.totalSeconds, 0);
  return { apps, totalSeconds: shown, appCount: apps.length, shownSeconds: shown };
}

function render(
  project: ProjectInfo | null,
  overrides: Partial<{
    appBreakdown: ProjectAppTime[];
    breakdown: ProjectAppBreakdown;
    screenshots: ScreenshotRef[];
    screenshotImages: Record<string, string>;
    selectedScreenshotId: string | null;
    loading: boolean;
  }> = {},
) {
  return renderToStaticMarkup(
    <ProjectDetailPanel
      project={project}
      breakdown={
        overrides.breakdown ?? breakdownOf(overrides.appBreakdown ?? [])
      }
      screenshots={overrides.screenshots ?? []}
      screenshotImages={overrides.screenshotImages ?? {}}
      selectedScreenshotId={overrides.selectedScreenshotId ?? null}
      loading={overrides.loading ?? false}
      onSelectScreenshot={noop}
    />,
  );
}

describe("ProjectDetailPanel", () => {
  it("renders nothing without a project", () => {
    expect(render(null)).toBe("");
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

  it("no longer duplicates budget scope or member count - those moved to ProjectBudgetTile and the sidebar header", () => {
    const html = render(baseProject);
    expect(html).not.toContain("Team budget");
    expect(html).not.toContain("Personal budget");
    expect(html).not.toContain("members");
  });

  // This used to hide the whole section when there was nothing to plot, which
  // reads as a missing feature rather than an empty week - people asked where
  // the top-apps card had gone. It stays and says what it knows.
  it("keeps the top-apps section and explains the absence when nothing is tracked", () => {
    const html = render(baseProject);
    expect(html).toContain("top apps");
    expect(html).toContain("No app activity recorded for this project this week yet");
  });

  it("plots one point per app around a radar, one axis per app", () => {
    const html = render(baseProject, {
      appBreakdown: [
        { appName: "Zoom", totalSeconds: 3600 },
        { appName: "Browser", totalSeconds: 3600 },
        { appName: "Notepad", totalSeconds: 1800 },
      ],
    });
    expect(html).toContain("Zoom");
    expect(html).toContain("Browser");
    expect(html).toContain("Notepad");
    expect(html).toContain("project-radar-svg");
    expect(html).toContain("project-radar-shape");
    // One dot per app.
    expect((html.match(/project-radar-dot/g) ?? []).length).toBe(3);

    const points = [...html.matchAll(/class="project-radar-point" style="left:([\d.]+)%;top:([\d.]+)%"/g)].map(
      (m) => ({ x: Number(m[1]), y: Number(m[2]) }),
    );
    expect(points.length).toBe(3);
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - 50, p.y - 50);
    // Notepad (half the time) sits closer to the center than either
    // full-value app.
    expect(dist(points[2])).toBeLessThan(dist(points[0]));
    expect(dist(points[2])).toBeLessThan(dist(points[1]));
  });

  it("holds the chart's shape with a pulsing grid while this project's stats load", () => {
    // The skeleton IS the chart here - the grid carries no data of its
    // own, so it stays up and the plate/points/labels fade against it.
    const html = render(baseProject, { loading: true });
    expect(html).toContain("project-radar is-loading");
    expect(html).toContain("project-radar-grid");
    expect(html).toContain('aria-busy="true"');
    // No plotted shape without rows to build one from.
    expect(html).not.toContain("project-radar-shape");
    // The screenshots half holds its space too, rather than collapsing -
    // the row skeletons AND a preview-shaped block filling the rest of
    // the column, so there's no empty gap where the big image will go.
    expect(html).toContain("shot-chip-skeleton");
    expect(html).toContain("shot-preview-loading");
  });

  it("puts the outgoing project's rows out of reach while the next one loads", () => {
    // The rows stay mounted through the switch so the plate can animate
    // out - which makes it easy to leave the PREVIOUS project's numbers
    // readable underneath. They must be gone from the tab order and the
    // a11y tree, and their chips replaced outright.
    const html = render(baseProject, {
      loading: true,
      appBreakdown: [{ appName: "Zoom", totalSeconds: 3600 }],
      screenshots: [{ id: "s1", capturedAt: "2024-01-01T12:00:00Z" }],
    });
    expect(html).not.toContain('tabindex="0"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-hidden="true"');
    // The outgoing capture times are replaced by skeletons, not shown.
    expect(html).toContain("shot-chip-skeleton");
    expect(html).not.toContain("shot-chip ");
  });

  it("never leaves a stale value or a skeleton on screen once loading finishes with nothing", () => {
    const html = render(baseProject, { loading: false });
    // The chart markup is present but hidden; what must not survive is any
    // number from a previous project, or a skeleton implying work in flight.
    expect(html).toContain("project-radar-empty");
    expect(html).not.toContain("project-radar-skeleton");
    expect(html).not.toContain("shot-chip-skeleton");
    expect(html).not.toContain("project-radar-label");
  });

  it("shows each app's time as a direct label, focusable for a keyboard-reachable tooltip", () => {
    const html = render(baseProject, {
      appBreakdown: [
        { appName: "Zoom", totalSeconds: 3600 },
        { appName: "Browser", totalSeconds: 1800 },
      ],
    });
    // Duration is always visible as a label under the chart - the tooltip
    // only adds the share percentage on top of it, never gates the value.
    expect(html).toContain("1h 0s");
    expect(html).toContain("30m 0s");
    // Every point is focusable (tooltip must be reachable without a mouse).
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(2);
    // Tooltip states the app's share of the apps actually shown (2/3 of the
    // combined 5400s = 67%), not a claim about total tracked time overall.
    expect(html).toContain("67% of the apps shown");
    expect(html).toContain("33% of the apps shown");
  });

  it("hides the screenshots section when there are none for this project", () => {
    expect(render(baseProject)).not.toContain("Recent screenshots");
  });

  it("never shows more than the newest 12 screenshots, even if handed more", () => {
    // Belt-and-suspenders: App.tsx already fetches 12, and the card is
    // built for up to 12 chips (4 rows of 3) - a longer list must still be cut
    // down here rather than relying solely on the caller.
    const shots: ScreenshotRef[] = Array.from({ length: 15 }, (_, i) => ({
      id: `s${i + 1}`,
      capturedAt: `2024-01-01T12:${String(i).padStart(2, "0")}:00Z`,
    }));
    const html = render(baseProject, { screenshots: shots, selectedScreenshotId: "s1" });
    expect((html.match(/class="shot-chip/g) ?? []).length).toBe(12);
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

describe("radar scale", () => {
  // The bug in the screenshot: Chrome at 6h alongside File Explorer at 30s.
  // A linear radius put the second app 0.05px from the centre, so the chart
  // rendered as a single dot while the labels clearly listed five apps.
  it("keeps a tiny app visibly off the centre next to a dominant one", () => {
    const dominant = radarRadius(6 * 3600, 6 * 3600);
    const tiny = radarRadius(30, 6 * 3600);
    expect(dominant).toBeCloseTo(35, 5);
    expect(tiny).toBeGreaterThan(4);
    // Linear scaling gave 35 * (30 / 21600) = 0.049 - indistinguishable from
    // the origin, and from every other small app.
    expect(tiny).toBeGreaterThan(35 * (30 / (6 * 3600)) * 10);
  });

  it("still orders marks by time, so the shape reads correctly", () => {
    const max = 3600;
    const radii = [3600, 1800, 600, 60].map((s) => radarRadius(s, max));
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeLessThan(radii[i - 1]!);
    }
  });

  // The v1.0.2 scale square-rooted the share, which put an app with 5% of the
  // top one's time a third of the way out - a six-fold exaggeration that made
  // two-minute apps look substantial next to a 47-minute one. Above the floor,
  // distance must be proportional to time.
  it("plots distance above the floor in proportion to time, not inflated", () => {
    const floor = radarRadius(0, 3600);
    const span = radarRadius(3600, 3600) - floor;
    expect(radarRadius(1800, 3600) - floor).toBeCloseTo(span * 0.5, 5);
    expect(radarRadius(360, 3600) - floor).toBeCloseTo(span * 0.1, 5);

    // The real week from the bug report: Telegram had 150s against 2820s.
    const telegram = radarRadius(150, 2820);
    const shareOfSpan = (telegram - floor) / span;
    expect(shareOfSpan).toBeCloseTo(150 / 2820, 5);
    expect(telegram / radarRadius(2820, 2820)).toBeLessThan(0.2);
  });

  it("never plots outside the chart or exactly on the origin", () => {
    expect(radarRadius(0, 3600)).toBe(4);
    expect(radarRadius(7200, 3600)).toBeLessThanOrEqual(35);
    expect(radarRadius(100, 0)).toBe(4);
  });

  it("says it is a top-N when the week holds more apps than are plotted", () => {
    const html = render(baseProject, {
      breakdown: {
        apps: [
          { appName: "Google Chrome", totalSeconds: 21720 },
          { appName: "Telegram", totalSeconds: 420 },
        ],
        totalSeconds: 50760,
        appCount: 9,
        shownSeconds: 22140,
      },
    });
    expect(html).toContain("Top 2 of 9 apps");
  });

  it("says nothing extra when every app in the week is plotted", () => {
    const html = render(baseProject, {
      appBreakdown: [{ appName: "Google Chrome", totalSeconds: 600 }],
    });
    expect(html).not.toContain("of 1 apps");
  });
});
