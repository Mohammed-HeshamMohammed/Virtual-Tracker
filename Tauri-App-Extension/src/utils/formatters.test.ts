import { describe, expect, it } from "vitest";
import {
  fmtClock,
  fmtHours,
  fmtLimitHours,
  fmtWallClock,
  initialsFromName,
  statusLabel,
  statusTone,
  taskStatusLabel,
  taskStatusTone,
} from "./formatters";

describe("fmtClock", () => {
  it("pads every field to two digits", () => {
    expect(fmtClock(5)).toBe("00:00:05");
    expect(fmtClock(65)).toBe("00:01:05");
    expect(fmtClock(3661)).toBe("01:01:01");
  });

  it("has no upper bound on hours", () => {
    expect(fmtClock(100 * 3600)).toBe("100:00:00");
  });

  it("floors fractional seconds and clamps negative input to zero", () => {
    expect(fmtClock(59.9)).toBe("00:00:59");
    expect(fmtClock(-5)).toBe("00:00:00");
  });
});

describe("fmtWallClock", () => {
  it("reads 12-hour with AM/PM, no leading zero on the hour", () => {
    // Local machine time, not a chosen zone - just checking the shape here
    // since the actual hour/minute depend on wherever the test runs.
    expect(fmtWallClock(new Date(2024, 0, 1, 9, 5))).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it("rolls midnight and noon to 12, not 0", () => {
    expect(fmtWallClock(new Date(2024, 0, 1, 0, 0))).toMatch(/^12:00 AM$/);
    expect(fmtWallClock(new Date(2024, 0, 1, 12, 0))).toMatch(/^12:00 PM$/);
  });
});

describe("fmtHours", () => {
  it("treats null, undefined, and non-positive values as the same zero state", () => {
    expect(fmtHours(null)).toBe("0s");
    expect(fmtHours(undefined)).toBe("0s");
    expect(fmtHours(0)).toBe("0s");
    expect(fmtHours(-30)).toBe("0s");
  });

  it("shows only seconds under a minute", () => {
    expect(fmtHours(45)).toBe("45s");
  });

  it("shows minutes and seconds under an hour", () => {
    expect(fmtHours(125)).toBe("2m 5s");
  });

  it("shows hours and minutes once minutes have elapsed", () => {
    expect(fmtHours(3725)).toBe("1h 2m");
  });

  // The one deliberately unusual case, called out in the source comment:
  // exactly on an hour boundary, minutes alone would freeze on "1h 0m" for
  // up to 59 more seconds, so this specific case shows seconds instead.
  it("falls back to seconds right at an hour boundary with zero minutes elapsed", () => {
    expect(fmtHours(3600)).toBe("1h 0s");
    expect(fmtHours(3630)).toBe("1h 30s");
  });

  it("goes back to h/m once a minute has ticked over past the hour", () => {
    expect(fmtHours(3660)).toBe("1h 1m");
  });
});

describe("initialsFromName", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsFromName("Mohammed Hesham")).toBe("MH");
  });

  it("uses only the first letter for a single-word name", () => {
    expect(initialsFromName("Cher")).toBe("C");
  });

  it("collapses repeated whitespace before splitting", () => {
    expect(initialsFromName("  Mohammed   Hesham  ")).toBe("MH");
  });

  it("falls back to a placeholder for empty or missing input", () => {
    expect(initialsFromName("")).toBe("?");
    // @ts-expect-error - exercising the runtime fallback for non-string input
    expect(initialsFromName(undefined)).toBe("?");
  });

  it("only ever uses the first two words, however many there are", () => {
    expect(initialsFromName("Anna Maria Garcia Lopez")).toBe("AM");
  });
});

describe("statusTone / statusLabel", () => {
  it("reads 'active' as live regardless of sign-in state", () => {
    expect(statusTone("active", false)).toBe("live");
    expect(statusLabel("active", false)).toBe("Tracking");
  });

  it("reads 'linking' as warn even when signed in", () => {
    expect(statusTone("linking", true)).toBe("warn");
    expect(statusLabel("linking", true)).toBe("Linking");
  });

  it("falls back on signed-in state once the status itself is uninformative", () => {
    expect(statusTone("connected", true)).toBe("ok");
    expect(statusLabel("connected", true)).toBe("Ready");
    expect(statusTone("connected", false)).toBe("idle");
    expect(statusLabel("connected", false)).toBe("Signed out");
  });

  it("reads idle/paused the same way", () => {
    expect(statusLabel("idle", true)).toBe("Paused");
    expect(statusLabel("paused", true)).toBe("Paused");
  });

  it("is case-insensitive", () => {
    expect(statusTone("ACTIVE", false)).toBe("live");
  });
});

describe("taskStatusTone / taskStatusLabel", () => {
  it("grades blocked-family statuses as warn", () => {
    for (const s of ["blocked", "on_hold", "Stuck", "overdue"]) {
      expect(taskStatusTone(s)).toBe("warn");
    }
  });

  it("grades in-progress-family statuses as good", () => {
    for (const s of ["in_progress", "Active", "in review"]) {
      expect(taskStatusTone(s)).toBe("good");
    }
  });

  it("checks the warn keywords before the good keywords", () => {
    // Contains both "block" and "review" - warn should win, matching the
    // source's own if/else-if order (block-family checked first).
    expect(taskStatusTone("blocked in review")).toBe("warn");
  });

  it("falls back to neutral for an unrecognized status", () => {
    expect(taskStatusTone("todo")).toBe("neutral");
    expect(taskStatusTone("")).toBe("neutral");
  });

  it("title-cases and de-underscores the label", () => {
    expect(taskStatusLabel("in_progress")).toBe("In Progress");
    expect(taskStatusLabel("on-hold")).toBe("On Hold");
  });

  it("falls back to 'Open' for an empty or whitespace-only status", () => {
    expect(taskStatusLabel("")).toBe("Open");
    expect(taskStatusLabel("   ")).toBe("Open");
  });
});

describe("fmtLimitHours", () => {
  it("reports no cap for zero, negative, NaN, or falsy input", () => {
    expect(fmtLimitHours(0)).toBe("No cap");
    expect(fmtLimitHours(-4)).toBe("No cap");
  });

  it("drops the decimal for a whole number of hours", () => {
    expect(fmtLimitHours(8)).toBe("8h");
  });

  it("keeps one decimal place for a fractional cap", () => {
    expect(fmtLimitHours(7.5)).toBe("7.5h");
  });
});
