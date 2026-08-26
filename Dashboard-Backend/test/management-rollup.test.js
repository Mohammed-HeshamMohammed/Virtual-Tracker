// Guards the management-project roll-up. The risk it covers is asymmetric:
// getting "add" wrong is visible immediately, but getting the PRUNE wrong
// silently deletes people from a project. The `source` column is the only
// thing separating "we put them here" from "a human chose them", so every
// case below pins that boundary.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ subMembers: Array<{member_id: string}>, existing: Array<{member_id: string, source: string}>, writes: Array<{sql: string, params: any[]}> }} */
const stub = { subMembers: [], existing: [], writes: [] };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      if (sql.includes("FROM project_subprojects psp")) return stub.subMembers;
      if (sql.includes("SELECT member_id, source")) return stub.existing;
      if (sql.includes("SELECT parent_project_id")) return [];
      stub.writes.push({ sql, params });
      return [];
    },
    withTransaction: async (fn) => fn({ query: async () => [] }),
    isPostgresConfigured: () => true,
    getPostgresPool: () => null,
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
  },
});
mock.module("../src/modules/realtime/change-bus.js", {
  namedExports: { publishChange: async () => {}, subscribeChanges: () => () => {},
    resetChangeBusForTests: async () => null,
  },
});

const { syncManagementProjectMembers } = await import(
  "../src/modules/projects/management-rollup.service.js"
);

function reset(patch = {}) {
  stub.subMembers = [];
  stub.existing = [];
  stub.writes = [];
  Object.assign(stub, patch);
}

const inserted = () => stub.writes.filter((w) => w.sql.includes("INSERT INTO project_members"));
const deleted = () => stub.writes.filter((w) => w.sql.includes("DELETE FROM project_members"));

test("managers of linked sub-projects are added as rolled_up", async () => {
  reset({ subMembers: [{ member_id: "m1" }, { member_id: "m2" }] });
  const result = await syncManagementProjectMembers("mgmt-1", "actor");
  assert.equal(result.added, 2);
  assert.deepEqual(inserted()[0].params[1].sort(), ["m1", "m2"]);
  assert.ok(inserted()[0].sql.includes("'rolled_up'"));
});

test("somebody already on the project by hand is left alone, not duplicated", async () => {
  reset({
    subMembers: [{ member_id: "m1" }],
    existing: [{ member_id: "m1", source: "manual" }],
  });
  const result = await syncManagementProjectMembers("mgmt-1");
  assert.equal(result.added, 0);
  assert.equal(inserted().length, 0);
  // Critically it must not be re-marked rolled_up either, or a later prune
  // would become able to delete a manual choice.
  assert.equal(deleted().length, 0);
});

test("a rolled_up member who no longer manages anything is pruned", async () => {
  reset({
    subMembers: [{ member_id: "m1" }],
    existing: [
      { member_id: "m1", source: "rolled_up" },
      { member_id: "gone", source: "rolled_up" },
    ],
  });
  const result = await syncManagementProjectMembers("mgmt-1");
  assert.equal(result.removed, 1);
  assert.deepEqual(deleted()[0].params[1], ["gone"]);
  // The delete is guarded on source so a concurrent manual add is safe.
  assert.ok(deleted()[0].sql.includes("source = 'rolled_up'"));
});

test("a manual member is NEVER pruned, even managing no sub-project", async () => {
  reset({
    subMembers: [],
    existing: [{ member_id: "hand-picked", source: "manual" }],
  });
  const result = await syncManagementProjectMembers("mgmt-1");
  assert.equal(result.removed, 0);
  assert.equal(deleted().length, 0);
});

test("no links and no members is a no-op, not a wipe", async () => {
  reset();
  const result = await syncManagementProjectMembers("mgmt-1");
  assert.deepEqual(result, { added: 0, removed: 0 });
  assert.equal(stub.writes.length, 0);
});

test("a missing project id does nothing rather than syncing everything", async () => {
  reset({ subMembers: [{ member_id: "m1" }] });
  assert.deepEqual(await syncManagementProjectMembers(""), { added: 0, removed: 0 });
  assert.equal(stub.writes.length, 0);
});
