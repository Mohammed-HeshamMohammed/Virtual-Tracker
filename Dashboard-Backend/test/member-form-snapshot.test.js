// Guards member-form-snapshot-postgres.service.js: the row shape returned
// must match what features/clients/utils/member-contact.ts on the frontend
// reads (memberDocId, formData, created_at - the same field names the
// Firestore version used, so no frontend change was needed migrating this).
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ inserted: Array<any[]>, rows: any[] }} */
const stub = { inserted: [], rows: [] };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      if (sql.includes("INSERT INTO members_field_data")) {
        stub.inserted.push(params);
        const [id, memberId, formKey, dataJson, modifiedBy] = params;
        const existingIdx = stub.rows.findIndex((r) => r.member_id === memberId && r.form_key === formKey);
        const row = {
          id: existingIdx === -1 ? id : stub.rows[existingIdx].id,
          member_id: memberId,
          form_key: formKey,
          data: JSON.parse(dataJson),
          modified_by: modifiedBy,
          created_at: existingIdx === -1 ? new Date("2026-01-01") : stub.rows[existingIdx].created_at,
          updated_at: new Date("2026-01-02"),
        };
        if (existingIdx === -1) stub.rows.push(row);
        else stub.rows[existingIdx] = row;
        return [{ id: row.id }];
      }
      if (sql.includes("SELECT * FROM members_field_data WHERE form_key = $1 AND member_id = $2")) {
        const [formKey, memberId] = params;
        return stub.rows.filter((r) => r.form_key === formKey && r.member_id === memberId);
      }
      if (sql.includes("SELECT * FROM members_field_data WHERE form_key = $1")) {
        const [formKey] = params;
        return stub.rows.filter((r) => r.form_key === formKey);
      }
      if (sql.startsWith("DELETE FROM members_field_data")) {
        const [formKey, memberId] = params;
        stub.rows = stub.rows.filter((r) => !(r.form_key === formKey && r.member_id === memberId));
        return [];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    withTransaction: async (fn) => fn({ query: async () => [] }),
    isPostgresConfigured: () => true,
    getPostgresPool: () => null,
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
  },
});

const { upsertMemberFormSnapshotPg, listMemberFormSnapshotsPg, deleteMemberFormSnapshotPg } = await import(
  "../src/lib/postgres/member-form-snapshot-postgres.service.js"
);

function reset() {
  stub.inserted = [];
  stub.rows = [];
}

test("upsert creates one row with the field names the frontend reads", async () => {
  reset();
  await upsertMemberFormSnapshotPg("m1", { firstName: "Sarah" }, "actor-1");
  const [row] = await listMemberFormSnapshotsPg("m1");
  assert.equal(row.memberDocId, "m1");
  assert.deepEqual(row.formData, { firstName: "Sarah" });
  assert.equal(row.modifiedBy, "actor-1");
  assert.ok(row.created_at, "created_at must be present - member-contact.ts sorts snapshots by it");
});

test("a second save for the same member updates in place, not a second row", async () => {
  reset();
  await upsertMemberFormSnapshotPg("m1", { firstName: "Sarah" }, "actor-1");
  await upsertMemberFormSnapshotPg("m1", { firstName: "Sarah K." }, "actor-2");
  const rows = await listMemberFormSnapshotsPg("m1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].formData.firstName, "Sarah K.");
  assert.equal(rows[0].modifiedBy, "actor-2");
});

test("snapshots for different members never collide", async () => {
  reset();
  await upsertMemberFormSnapshotPg("m1", { firstName: "Sarah" });
  await upsertMemberFormSnapshotPg("m2", { firstName: "Ahmed" });
  const all = await listMemberFormSnapshotsPg();
  assert.equal(all.length, 2);
  const one = await listMemberFormSnapshotsPg("m1");
  assert.equal(one.length, 1);
  assert.equal(one[0].memberDocId, "m1");
});

test("no modifiedBy is stored as null, not the string 'undefined'", async () => {
  reset();
  await upsertMemberFormSnapshotPg("m1", { firstName: "Sarah" });
  const [row] = await listMemberFormSnapshotsPg("m1");
  assert.equal(row.modifiedBy, "");
});

// Guards the specific regression this test file was updated to catch:
// deleteMemberProfileData (member-profile.service.js, run on member
// deletion/deactivation) queried Firestore for these rows after the data
// itself had already moved to Postgres - the query always found nothing,
// so a deleted member's snapshot was silently orphaned forever instead of
// being cleaned up.
test("deleting a member's snapshot removes only that member's row", async () => {
  reset();
  await upsertMemberFormSnapshotPg("m1", { firstName: "Sarah" });
  await upsertMemberFormSnapshotPg("m2", { firstName: "Ahmed" });
  await deleteMemberFormSnapshotPg("m1");
  assert.equal((await listMemberFormSnapshotsPg("m1")).length, 0);
  assert.equal((await listMemberFormSnapshotsPg("m2")).length, 1, "deleting m1 must not touch m2's row");
});
