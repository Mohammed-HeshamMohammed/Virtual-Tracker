import test from "node:test";
import assert from "node:assert/strict";
import { guardIdleRewind, IDLE_REWIND_SLACK_SECONDS } from "../src/modules/activity/idle-rewind-guard.js";

const base = { storedActive: 8 * 3600, storedIdle: 600, thresholdSeconds: 450 };

test("an ordinary idle rewind - about one threshold of time - goes through untouched", () => {
  const rewound = 8 * 3600 - 450; // back to the last real input
  const out = guardIdleRewind({ ...base, incomingActive: rewound, incomingIdle: 600 + 450 });
  assert.deepEqual(out, { activeSeconds: rewound, idleSeconds: 1050, clampedSeconds: 0 });
});

test("a rewind to zero cannot erase a session's hours", () => {
  // An agent that lost its last-input point: stop at 0 active, everything moved to idle.
  const out = guardIdleRewind({ ...base, incomingActive: 0, incomingIdle: 600 + 8 * 3600 });
  const floor = 8 * 3600 - (450 + IDLE_REWIND_SLACK_SECONDS);
  assert.equal(out.activeSeconds, floor);
  assert.equal(out.clampedSeconds, floor);
  // The refused hours are not booked as idle either - only what a threshold-sized rewind would add.
  assert.equal(out.idleSeconds, 600 + 8 * 3600 - floor);
});

test("idle never drops below what the server already holds", () => {
  const out = guardIdleRewind({ storedActive: 10000, storedIdle: 5000, incomingActive: 0, incomingIdle: 100, thresholdSeconds: 450 });
  assert.equal(out.idleSeconds, 5000);
});

test("a stop that reports more than is held is not a rewind and is left alone", () => {
  const out = guardIdleRewind({ ...base, incomingActive: 8 * 3600 + 20, incomingIdle: 600 });
  assert.deepEqual(out, { activeSeconds: 8 * 3600 + 20, idleSeconds: 600, clampedSeconds: 0 });
});

test("a short session can still be rewound all the way - the bound is on what idle time can be", () => {
  const out = guardIdleRewind({ storedActive: 300, storedIdle: 0, incomingActive: 0, incomingIdle: 300, thresholdSeconds: 450 });
  assert.deepEqual(out, { activeSeconds: 0, idleSeconds: 300, clampedSeconds: 0 });
});

test("a longer project allowance allows a correspondingly longer rewind", () => {
  const rewound = 8 * 3600 - 7200;
  const out = guardIdleRewind({ storedActive: 8 * 3600, storedIdle: 0, incomingActive: rewound, incomingIdle: 7200, thresholdSeconds: 7200 });
  assert.equal(out.clampedSeconds, 0);
  assert.equal(out.activeSeconds, rewound);
});
