// A member row can end up with first_name, last_name, and display_name all
// blank - seen on accounts carried over from the Firestore-era data. This
// covers the boot-time backfill that heals such a row from Firebase Auth's
// own record of the member (the "Google account"), since Postgres has
// nothing left to read at that point.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ rows: any[], updates: any[][], postgresConfigured: boolean }} */
const stub = { rows: [], updates: [], postgresConfigured: true };
/** @type {{ users: Record<string, any> }} */
const authStub = { users: {} };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params = []) => {
      if (sql.includes("SELECT id, firebase_uid, work_email")) return stub.rows;
      if (sql.startsWith("UPDATE members")) {
        stub.updates.push(params);
        return [];
      }
      return [];
    },
    isPostgresConfigured: () => stub.postgresConfigured,
    getPostgresPool: () => null,
    withTransaction: async (fn) => fn({ query: async () => [] }),
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
  },
});

mock.module("../src/config/firebase.js", {
  namedExports: {
    getAuthAdmin: () => ({
      getUser: async (uid) => {
        const user = authStub.users[uid];
        if (!user) {
          const err = new Error("no user");
          err.code = "auth/user-not-found";
          throw err;
        }
        return user;
      },
    }),
    getDb: () => null,
    __setTestDb: () => {},
    __setTestAuth: () => {},
    __resetTestDb: () => {},
    defaultFirebaseDatabaseUrl: () => "",
    resolveFirebaseDatabaseUrl: () => "",
    warnIfDatabaseUrlMismatch: () => {},
    readFirebaseWebConfigFromEnv: () => ({}),
    getFirebaseStatus: () => ({}),
    resolveStorageBucketName: () => "",
    resolveStorageBucketCandidates: () => [],
    getStorageBucketAsync: async () => null,
    formatStorageSetupError: () => "",
    getStorageBucket: () => null,
  },
});

mock.module("../src/http/sanitize-error.js", {
  namedExports: {
    logSafeWarn: () => {},
    logSafeError: () => {},
    formatErrorForLog: () => "",
    sanitizeErrorMessage: () => "",
  },
});

const { backfillMemberDisplayNames } = await import(
  "../src/modules/members/services/member-name-backfill.js"
);

function reset({ rows = [], users = {}, postgresConfigured = true } = {}) {
  stub.rows = rows;
  stub.updates = [];
  stub.postgresConfigured = postgresConfigured;
  authStub.users = users;
}

test("skips entirely when Postgres is not configured", async () => {
  reset({ rows: [{ id: "m1", firebase_uid: "u1", work_email: "a@x.com" }], postgresConfigured: false });
  const result = await backfillMemberDisplayNames();
  assert.deepEqual(result, { checked: 0, updated: 0 });
  assert.deepEqual(stub.updates, []);
});

test("no members with blank names is a cheap no-op", async () => {
  reset({ rows: [] });
  const result = await backfillMemberDisplayNames();
  assert.deepEqual(result, { checked: 0, updated: 0 });
});

test("resolves the name from Firebase Auth's displayName and writes it back", async () => {
  reset({
    rows: [{ id: "m1", firebase_uid: "u1", work_email: "jane@example.com" }],
    users: { u1: { displayName: "Jane Doe", email: "jane@example.com", providerData: [] } },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.updated, 1);
  assert.deepEqual(stub.updates[0], ["Jane", "Doe", "Jane Doe", "m1"]);
});

test("falls back to the google.com provider's own displayName when the top-level one is blank", async () => {
  reset({
    rows: [{ id: "m2", firebase_uid: "u2", work_email: "sam@example.com" }],
    users: {
      u2: {
        displayName: "",
        email: "sam@example.com",
        providerData: [{ providerId: "google.com", displayName: "Sam Rivers" }],
      },
    },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.updated, 1);
  assert.deepEqual(stub.updates[0], ["Sam", "Rivers", "Sam Rivers", "m2"]);
});

test("falls back to the email local part when Auth has no name anywhere, same as a freshly created member", async () => {
  reset({
    rows: [{ id: "m3", firebase_uid: "u3", work_email: "priya.k@example.com" }],
    users: { u3: { displayName: "", email: "priya.k@example.com", providerData: [] } },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.updated, 1);
  assert.deepEqual(stub.updates[0], ["priya.k", "", "priya.k", "m3"]);
});

test("a member with no email and no Auth name anywhere is left for the next boot, not blanked further", async () => {
  reset({
    rows: [{ id: "m4", firebase_uid: "u4", work_email: "" }],
    users: { u4: { displayName: "", email: "", providerData: [] } },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.updated, 0);
  assert.deepEqual(stub.updates, []);
});

test("a Firebase Auth user that no longer exists is skipped, not thrown - the sweep still runs other rows", async () => {
  reset({
    rows: [
      { id: "orphaned", firebase_uid: "deleted-uid", work_email: "gone@example.com" },
      { id: "m5", firebase_uid: "u5", work_email: "kim@example.com" },
    ],
    users: { u5: { displayName: "Kim Lee", email: "kim@example.com", providerData: [] } },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.checked, 2);
  assert.equal(result.updated, 1);
  assert.deepEqual(stub.updates, [["Kim", "Lee", "Kim Lee", "m5"]]);
});
