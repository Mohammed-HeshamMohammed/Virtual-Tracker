import { describe, expect, it } from "vitest";
import { describeIdleStop } from "./idleStop";

describe("describeIdleStop", () => {
  it("names how long, the allowance, and the time moved", () => {
    expect(describeIdleStop({ idleSeconds: 330, allowanceSeconds: 300, movedSeconds: 125 })).toBe(
      "Timer stopped: no mouse or keyboard for 6 minutes, and this project allows 5 minutes. 2 minutes of it moved from worked time to idle. Press Start to carry on.",
    );
  });

  it("leaves out a move of less than a minute", () => {
    expect(describeIdleStop({ idleSeconds: 60, allowanceSeconds: 60, movedSeconds: 5 })).toBe(
      "Timer stopped: no mouse or keyboard for 1 minute, and this project allows 1 minute. Press Start to carry on.",
    );
  });

  it("still explains itself without details from an older agent", () => {
    expect(describeIdleStop(undefined)).toContain("idle longer than this project allows");
  });
});
