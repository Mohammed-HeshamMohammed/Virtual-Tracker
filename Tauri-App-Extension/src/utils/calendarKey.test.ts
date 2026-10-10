import { describe, expect, it } from "vitest";
import { limitsCalendarKey } from "./calendarKey";

const DEVICE_DAY = "Fri Oct 09 2026";

describe("limitsCalendarKey", () => {
  it("is null until there is a response to describe", () => {
    expect(limitsCalendarKey(null, DEVICE_DAY)).toBeNull();
    expect(limitsCalendarKey(undefined, DEVICE_DAY)).toBeNull();
  });

  it("changes when the same day is cut in another zone", () => {
    // The bug: a project in New York re-cuts "today" for a member whose own zone is
    // Mexico City, and the held-over higher number never came back down.
    const member = limitsCalendarKey({ timeZone: "America/Mexico_City", todayDay: "2026-10-09" }, DEVICE_DAY);
    const project = limitsCalendarKey({ timeZone: "America/New_York", todayDay: "2026-10-09" }, DEVICE_DAY);
    expect(member).not.toEqual(project);
  });

  it("changes when the calendar day turns over, and not otherwise", () => {
    const a = limitsCalendarKey({ timeZone: "UTC", todayDay: "2026-10-09" }, DEVICE_DAY);
    expect(limitsCalendarKey({ timeZone: "UTC", todayDay: "2026-10-09" }, "Sat Oct 10 2026")).toEqual(a);
    expect(limitsCalendarKey({ timeZone: "UTC", todayDay: "2026-10-10" }, DEVICE_DAY)).not.toEqual(a);
  });

  it("only separates projects when asked to", () => {
    const base = { timeZone: "UTC", todayDay: "2026-10-09" };
    const one = { ...base, projectId: "p1" };
    const two = { ...base, projectId: "p2" };
    expect(limitsCalendarKey(one, DEVICE_DAY)).toEqual(limitsCalendarKey(two, DEVICE_DAY));
    expect(limitsCalendarKey(one, DEVICE_DAY, { includeProject: true })).not.toEqual(
      limitsCalendarKey(two, DEVICE_DAY, { includeProject: true }),
    );
  });

  it("falls back to the device's own day on a backend that doesn't say", () => {
    const older = { timeZone: "", todayDay: "" };
    expect(limitsCalendarKey(older, DEVICE_DAY)).not.toEqual(limitsCalendarKey(older, "Sat Oct 10 2026"));
  });
});
