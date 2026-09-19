import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyAgentVersion,
  compareAgentVersions,
  normalizeAgentVersion,
} from "../src/modules/agent-versions/version.js";

test("agent versions normalize only complete semantic versions", () => {
  assert.equal(normalizeAgentVersion(" v1.2.3 "), "1.2.3");
  assert.equal(normalizeAgentVersion("1.2"), null);
  assert.equal(normalizeAgentVersion("latest"), null);
  assert.equal(normalizeAgentVersion("01.2.3"), null);
  assert.equal(normalizeAgentVersion(`1.${"9".repeat(40)}.3`), null);
  assert.equal(normalizeAgentVersion("9007199254740992.0.0"), null);
});

test("agent versions compare numerically", () => {
  assert.equal(compareAgentVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareAgentVersions("1.0.23", "1.0.23"), 0);
  assert.equal(compareAgentVersions("1.0.22", "1.0.23"), -1);
  assert.equal(compareAgentVersions("unknown", "1.0.23"), null);
});

test("unknown and malformed reports remain distinct from valid versions", () => {
  assert.equal(classifyAgentVersion(null, "1.0.23"), "unknown");
  assert.equal(classifyAgentVersion("", "1.0.23"), "unknown");
  assert.equal(classifyAgentVersion("not-a-version", "1.0.23"), "unrecognized");
  assert.equal(classifyAgentVersion("1.0.22", "1.0.23"), "outdated");
  assert.equal(classifyAgentVersion("1.0.23", "1.0.23"), "latest");
  assert.equal(classifyAgentVersion("1.0.24", "1.0.23"), "latest");
});
