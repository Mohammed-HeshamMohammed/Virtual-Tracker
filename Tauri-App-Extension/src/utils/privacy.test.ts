import { describe, expect, it } from "vitest";
import {
  EMPTY_CAPTURE_STATUS,
  canStartBreak,
  describeCollection,
  exclusionLabel,
  formatRemaining,
  isOnBreak,
  sameCaptureStatus,
} from "./privacy";

const MIN = 60_000;

describe("formatRemaining", () => {
  it("rounds up so the last minute never reads as zero", () => {
    expect(formatRemaining(1_000 + 30_000, 1_000)).toBe("1 min left");
    expect(formatRemaining(1_000 + 61_000, 1_000)).toBe("2 min left");
  });

  it("switches to hours past an hour, dropping a zero remainder", () => {
    expect(formatRemaining(60 * MIN, 0)).toBe("1 hr left");
    expect(formatRemaining(90 * MIN, 0)).toBe("1 hr 30 min left");
  });

  it("is empty once the time has passed, rather than negative", () => {
    expect(formatRemaining(1000, 5000)).toBe("");
    expect(formatRemaining(5000, 5000)).toBe("");
  });
});

describe("isOnBreak", () => {
  it("is true only while the end time is in the future", () => {
    expect(isOnBreak({ blocked: true, reason: "", breakUntilMs: 10_000, issue: "" }, 5_000)).toBe(true);
    expect(isOnBreak({ blocked: true, reason: "", breakUntilMs: 10_000, issue: "" }, 10_000)).toBe(false);
    expect(isOnBreak(EMPTY_CAPTURE_STATUS, 5_000)).toBe(false);
  });
});

describe("sameCaptureStatus", () => {
  it("treats an unchanged answer as the same so a poll does not re-render the app", () => {
    const a = { blocked: true, reason: "Private break", breakUntilMs: 42, issue: "" };
    expect(sameCaptureStatus(a, { ...a })).toBe(true);
  });

  it("notices any field changing", () => {
    const a = { blocked: true, reason: "x", breakUntilMs: 1, issue: "" };
    expect(sameCaptureStatus(a, { ...a, blocked: false })).toBe(false);
    expect(sameCaptureStatus(a, { ...a, reason: "y" })).toBe(false);
    expect(sameCaptureStatus(a, { ...a, breakUntilMs: 2 })).toBe(false);
    // A fault appearing changes nothing else, and must still be noticed or the
    // banner would never show.
    expect(sameCaptureStatus(a, { ...a, issue: "failing" })).toBe(false);
  });
});

describe("canStartBreak", () => {
  it("needs a reason that is not just whitespace", () => {
    expect(canStartBreak("", false)).toBe(false);
    expect(canStartBreak("   ", false)).toBe(false);
    expect(canStartBreak("Doctor", false)).toBe(true);
  });

  it("cannot be started twice while a request is in flight", () => {
    expect(canStartBreak("Doctor", true)).toBe(false);
  });
});

describe("describeCollection", () => {
  const base = { timezone: "UTC", screenshots: 0, appEvents: 0, apps: 0, domains: 0, activeSeconds: 0 };

  it("says nothing was collected rather than printing zeros", () => {
    expect(describeCollection(base)).toBe("Nothing has been collected yet today.");
  });

  it("uses the singular for one and the plural otherwise", () => {
    expect(describeCollection({ ...base, screenshots: 1, apps: 3, domains: 1 })).toBe(
      "1 screenshot · 3 apps · 1 website",
    );
  });
});

describe("exclusionLabel", () => {
  it("names a domain rule a website, since members do not think in domains", () => {
    expect(exclusionLabel("domain")).toBe("Website");
    expect(exclusionLabel("app")).toBe("App");
  });
});
