import test from "node:test";
import assert from "node:assert/strict";
import { POSTGRES_ENTITY_KEYS } from "../src/modules/schema/services/postgres-crud.service.js";

test("POSTGRES_ENTITY_KEYS includes all domain entities", () => {
  const expectedKeys = [
    "projects",
    "project-members",
    "project-budgets",
    "project-member-limits",
    "client-projects",
    "team-projects",
    "clients",
    "client-budgets",
    "client-invoicing",
    "teams",
    "team-members",
    "members",
    "member-bans",
    "invites",
    "tasks",
    "task-assignments",
    "time-entries",
    "timesheets",
  ];

  for (const key of expectedKeys) {
    assert.equal(POSTGRES_ENTITY_KEYS.has(key), true, `Missing expected key in POSTGRES_ENTITY_KEYS: ${key}`);
  }
});
