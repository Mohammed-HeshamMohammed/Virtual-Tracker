import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TitleBarStats } from "./TitleBarStats";
import { clampSeenTimesheets, timesheetNotification } from "../../utils/approvalNotification";

const pulse = { totalActiveSecondsToday: 7200, trackingNowCount: 2, membersWorkedTodayCount: 5 };

describe("TitleBarStats", () => {
  it("renders nothing without a pulse", () => {
    expect(renderToStaticMarkup(<TitleBarStats pulse={null} />)).toBe("");
  });

  it("shows the live team numbers", () => {
    const html = renderToStaticMarkup(<TitleBarStats pulse={pulse} />);
    expect(html).toContain("tracking");
    expect(html).toContain("worked today");
    expect(html).toContain("total");
  });

  it("does not label whom the numbers cover on screen - only in the help text", () => {
    for (const scope of ["organization", "people", "projects"] as const) {
      const html = renderToStaticMarkup(<TitleBarStats pulse={{ ...pulse, scope }} />);
      expect(html).not.toContain(">Organization<");
      expect(html).not.toContain(">Your people<");
      expect(html).not.toContain(">Your projects<");
      expect(html).not.toContain("titlebar-stat-scope");
    }
    expect(renderToStaticMarkup(<TitleBarStats pulse={{ ...pulse, scope: "organization" }} />)).toContain(
      "everyone in the organization",
    );
  });

  it("no longer carries the week's own activity - that is back in the sidebar", () => {
    const html = renderToStaticMarkup(<TitleBarStats pulse={pulse} />);
    expect(html).not.toContain("idle");
    expect(html).not.toContain("titlebar-ring");
  });
});

describe("timesheetNotification", () => {
  it("is absent with nothing pending", () => {
    expect(timesheetNotification(0, 0)).toBeNull();
  });

  it("names the count and singularizes one", () => {
    expect(timesheetNotification(3, 0)?.title).toBe("3 timesheets waiting on you");
    expect(timesheetNotification(1, 0)?.title).toBe("1 timesheet waiting on you");
  });

  it("is unread until opened, and unread again when more arrive", () => {
    expect(timesheetNotification(2, 0)?.read).toBe(false);
    expect(timesheetNotification(2, 2)?.read).toBe(true);
    expect(timesheetNotification(3, 2)?.read).toBe(false);
  });

  it("carries a Review action", () => {
    expect(timesheetNotification(1, 0)?.actionLabel).toBe("Review");
  });
});

describe("clampSeenTimesheets", () => {
  it("lowers the seen mark when timesheets are approved, so a later arrival reads unread", () => {
    let seen = 3;
    seen = clampSeenTimesheets(seen, 1); // two approved
    expect(seen).toBe(1);
    expect(timesheetNotification(2, seen)?.read).toBe(false); // a new one arrives
  });

  it("leaves the mark alone while the count is at or above it, and never goes negative", () => {
    expect(clampSeenTimesheets(2, 5)).toBe(2);
    expect(clampSeenTimesheets(2, 0)).toBe(0);
  });
});
