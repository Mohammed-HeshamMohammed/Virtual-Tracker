import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TitleBarStats } from "./TitleBarStats";
import { clampSeenTimesheets, timesheetNotification } from "../../utils/approvalNotification";

const weekly = { percent: 62, dash: 40, activeSeconds: 3600, idleSeconds: 600 };
const pulse = { totalActiveSecondsToday: 7200, trackingNowCount: 2, membersWorkedTodayCount: 5 };

describe("TitleBarStats", () => {
  it("renders nothing without either section", () => {
    expect(renderToStaticMarkup(<TitleBarStats weekly={null} pulse={null} />)).toBe("");
  });

  it("shows the percent and the week's active and idle time", () => {
    const html = renderToStaticMarkup(<TitleBarStats weekly={weekly} pulse={null} />);
    expect(html).toContain("62%");
    expect(html).toContain("active");
    expect(html).toContain("idle");
    expect(html).not.toContain("worked today");
  });

  it("shows a dash rather than 0% before anything is tracked this week", () => {
    const html = renderToStaticMarkup(
      <TitleBarStats weekly={{ ...weekly, percent: null, dash: 0, activeSeconds: 0, idleSeconds: 0 }} pulse={null} />,
    );
    expect(html).toContain("—");
    expect(html).not.toContain("0%");
  });

  it("shows the organization pulse for a manager", () => {
    const html = renderToStaticMarkup(<TitleBarStats weekly={weekly} pulse={pulse} />);
    expect(html).toContain("tracking");
    expect(html).toContain("worked today");
    expect(html).toContain("total");
  });

  it("labels the pulse with whom it covers, by the server's scope", () => {
    const label = (scope: "organization" | "people" | "projects") =>
      renderToStaticMarkup(<TitleBarStats weekly={null} pulse={{ ...pulse, scope }} />);
    expect(label("organization")).toContain("Organization");
    expect(label("people")).toContain("Your people");
    expect(label("projects")).toContain("Your projects");
  });

  it("leaves the label off for an older server that sends no scope", () => {
    const html = renderToStaticMarkup(<TitleBarStats weekly={null} pulse={pulse} />);
    expect(html).not.toContain("titlebar-stat-scope");
  });

  it("renders the pulse alone when the week is not loaded", () => {
    const html = renderToStaticMarkup(<TitleBarStats weekly={null} pulse={pulse} />);
    expect(html).toContain("worked today");
    expect(html).not.toContain("idle");
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
