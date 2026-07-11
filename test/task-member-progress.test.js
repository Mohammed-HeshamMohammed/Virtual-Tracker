import test from "node:test";
import assert from "node:assert/strict";
import {
  computeProgressPercentage,
  parseProgressUuid,
} from "../src/lib/postgres/task-member-progress.service.js";
import { isManagementRole } from "../src/modules/tasks/task-time-tracking.js";

const MEMBER_A = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
const MEMBER_B = "b2c3d4e5-f6a7-4890-b123-456789abcdef0";
const TASK_ID = "c3d4e5f6-a7b8-4901-8234-56789abcdef0";

test("parseProgressUuid accepts lowercase UUID v4", () => {
  assert.equal(parseProgressUuid(MEMBER_A), MEMBER_A);
});

test("parseProgressUuid rejects non-uuid strings", () => {
  assert.equal(parseProgressUuid("not-a-uuid"), null);
  assert.equal(parseProgressUuid(""), null);
});

test("computeProgressPercentage caps at 100", () => {
  assert.equal(computeProgressPercentage(7200, 3600), 100);
  assert.equal(computeProgressPercentage(1800, 3600), 50);
  assert.equal(computeProgressPercentage(100, 0), 0);
});

test("two members have distinct UUID keys — no shared timer row identity", () => {
  assert.notEqual(parseProgressUuid(MEMBER_A), parseProgressUuid(MEMBER_B));
  assert.equal(parseProgressUuid(TASK_ID), TASK_ID);
});

test("employees cannot be treated as management for completed status", () => {
  assert.equal(isManagementRole("Employee"), false);
  assert.equal(isManagementRole("User"), false);
  assert.equal(isManagementRole("Manager"), true);
  assert.equal(isManagementRole("Admin"), true);
});

test("schema rule: only management may mark tasks completed", () => {
  const actorRole = "Employee";
  const payload = { status: "done" };
  const canComplete =
    payload.status === "done" ? isManagementRole(actorRole) : true;
  assert.equal(canComplete, false);
});
