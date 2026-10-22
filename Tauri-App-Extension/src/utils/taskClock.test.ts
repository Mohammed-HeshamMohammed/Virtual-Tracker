import { describe, expect, it } from "vitest";
import { nextTaskClockSeconds } from "./taskClock";

describe("nextTaskClockSeconds", () => {
  it("keeps the locally ticked value when a poll lands behind it", () => {
    expect(nextTaskClockSeconds(1000, 990, { sameTask: true, idleRewind: false })).toBe(1000);
  });

  it("takes the server's figure when it is ahead", () => {
    expect(nextTaskClockSeconds(1000, 1020, { sameTask: true, idleRewind: false })).toBe(1020);
  });

  it("drops to the server's figure after an idle stop took time back", () => {
    expect(nextTaskClockSeconds(1450, 1000, { sameTask: true, idleRewind: true })).toBe(1000);
  });

  it("jumps to the new task's figure when another task is selected", () => {
    expect(nextTaskClockSeconds(1450, 200, { sameTask: false, idleRewind: false })).toBe(200);
  });
});
