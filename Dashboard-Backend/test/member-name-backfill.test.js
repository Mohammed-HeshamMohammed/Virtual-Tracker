// A member row can end up with first_name, last_name, and display_name all
// blank - or holding nothing but the literal placeholder word "Member" - seen
// on accounts carried over from the Firestore-era data. This covers the
// boot-time backfill that heals such a row from Firebase Auth's own record of
// the member (the "Google account"), whether that record is already linked by
// firebase_uid or has to be found by email instead, since Postgres has
// nothing left to read at that point - and proves the sweep can never
// overwrite a member who already has a real name.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

function isBlankOrPlaceholder(value) {
  const trimmed = (value ?? "").trim().toLowerCase();
  return !trimmed || trimmed === "member";
}

/** @type {{ rows: any[], updates: any[][], postgresConfigured: boolean, currentNames: Record<string, { first: string, last: string, display: string }> }} */
const stub = { rows: [], updates: [], postgresConfigured: true, currentNames: {} };
/** @type {{ byUid: Record<string, any>, byEmail: Record<string, any> }} */
const authStub = { byUid: {}, byEmail: {} };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    // The UPDATE branch mirrors the real query's own safety net: it only
    // "succeeds" (returns a row, the same as a real RETURNING id) when the
    // member's name is still blank-or-placeholder at write time - proving the
    // backfill's guard is real and not just an unused WHERE clause, a test
    // reading only stub.updates could not distinguish "guarded" from
    // "unconditional but happened not to overwrite anything in this run".
    query: async (sql, params = []) => {
      if (sql.includes("SELECT id, firebase_uid, work_email, personal_email")) return stub.rows;
      if (sql.startsWith("UPDATE members")) {
        const [firstName, lastName, displayName, id] = params;
        const current = stub.currentNames[id] ?? { first: "", last: "", display: "" };
        const stillBlank =
          isBlankOrPlaceholder(current.first) &&
          isBlankOrPlaceholder(current.last) &&
          isBlankOrPlaceholder(current.display);
        if (!stillBlank) return [];
        stub.updates.push(params);
        stub.currentNames[id] = { first: firstName, last: lastName, display: displayName };
        return [{ id }];
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
        const user = authStub.byUid[uid];
        if (!user) {
          const err = new Error("no user");
          err.code = "auth/user-not-found";
          throw err;
        }
        return user;
      },
      getUserByEmail: async (email) => {
        const user = authStub.byEmail[email];
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

function reset({ rows = [], byUid = {}, byEmail = {}, postgresConfigured = true, currentNames = {} } = {}) {
  stub.rows = rows;
  stub.updates = [];
  stub.postgresConfigured = postgresConfigured;
  authStub.byUid = byUid;
  authStub.byEmail = byEmail;
  // Every row the SELECT stage returned starts blank in "the database" too,
  // unless a test explicitly seeds otherwise - see the anti-overwrite test.
  stub.currentNames = Object.fromEntries(rows.map((r) => [r.id, { first: "", last: "", display: "" }]));
  Object.assign(stub.currentNames, currentNames);
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

test("resolves the name from Firebase Auth's displayName by firebase_uid and writes it back", async () => {
  reset({
    rows: [{ id: "m1", firebase_uid: "u1", work_email: "jane@example.com", personal_email: "" }],
    byUid: { u1: { displayName: "Jane Doe", email: "jane@example.com", providerData: [] } },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.updated, 1);
  assert.deepEqual(stub.updates[0], ["Jane", "Doe", "Jane Doe", "m1"]);
});

test("a member never linked to a sign-in (no firebase_uid) is still found by email", async () => {
  reset({
    rows: [{ id: "m2", firebase_uid: "", work_email: "mariam1967es@gmail.com", personal_email: "" }],
    byEmail: {
      "mariam1967es@gmail.com": { displayName: "Mariam Essam", email: "mariam1967es@gmail.com", providerData: [] },
    },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.updated, 1);
  assert.deepEqual(stub.updates[0], ["Mariam", "Essam", "Mariam Essam", "m2"]);
});

test("falls back to the google.com provider's own displayName when the top-level one is blank", async () => {
  reset({
    rows: [{ id: "m3", firebase_uid: "u3", work_email: "sam@example.com", personal_email: "" }],
    byUid: {
      u3: {
        displayName: "",
        email: "sam@example.com",
        providerData: [{ providerId: "google.com", displayName: "Sam Rivers" }],
      },
    },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.updated, 1);
  assert.deepEqual(stub.updates[0], ["Sam", "Rivers", "Sam Rivers", "m3"]);
});

test("falls back to the email local part when no Firebase Auth account exists anywhere", async () => {
  // Neither the uid lookup nor the email lookup resolves - this is the case
  // that used to be left showing the placeholder forever with no recourse.
  reset({
    rows: [{ id: "m4", firebase_uid: "", work_email: "priya.k@example.com", personal_email: "" }],
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.updated, 1);
  assert.deepEqual(stub.updates[0], ["priya.k", "", "priya.k", "m4"]);
});

test("a member with no email and no linked account is left for the next boot, not blanked further", async () => {
  reset({
    rows: [{ id: "m5", firebase_uid: "", work_email: "", personal_email: "" }],
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.updated, 0);
  assert.deepEqual(stub.updates, []);
});

test("a Firebase Auth uid that no longer exists falls through to the email lookup instead of failing", async () => {
  reset({
    rows: [{ id: "m6", firebase_uid: "stale-uid", work_email: "kim@example.com", personal_email: "" }],
    byEmail: { "kim@example.com": { displayName: "Kim Lee", email: "kim@example.com", providerData: [] } },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.checked, 1);
  assert.equal(result.updated, 1);
  assert.deepEqual(stub.updates, [["Kim", "Lee", "Kim Lee", "m6"]]);
});

test("one row erroring never stops the rest of the sweep", async () => {
  reset({
    rows: [
      { id: "orphaned", firebase_uid: "", work_email: "", personal_email: "" },
      { id: "m7", firebase_uid: "u7", work_email: "avery@example.com", personal_email: "" },
    ],
    byUid: { u7: { displayName: "Avery Chen", email: "avery@example.com", providerData: [] } },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.checked, 2);
  assert.equal(result.updated, 1);
  assert.deepEqual(stub.updates, [["Avery", "Chen", "Avery Chen", "m7"]]);
});

test("never overwrites a member who already has a real name, even one that slipped past the SELECT", async () => {
  // Simulates the exact case being guarded against: a row reaches the loop
  // (as if the SELECT's own filter had somehow let it through, or another
  // process named this member in the gap between the SELECT and this row's
  // turn) already holding a real name in Postgres. The UPDATE's own WHERE
  // must refuse to touch it - this is the guarantee, not just the SELECT
  // filter tested indirectly by every case above.
  reset({
    rows: [{ id: "already-named", firebase_uid: "u8", work_email: "morgan@example.com", personal_email: "" }],
    byUid: { u8: { displayName: "Someone Else Entirely", email: "morgan@example.com", providerData: [] } },
    currentNames: { "already-named": { first: "Morgan", last: "Lee", display: "Morgan Lee" } },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.updated, 0, "a member with an existing name must never be counted as updated");
  assert.deepEqual(stub.updates, [], "no write may reach a member who already has a name");
  assert.deepEqual(stub.currentNames["already-named"], { first: "Morgan", last: "Lee", display: "Morgan Lee" });
});

test("a member holding the literal placeholder word in only one of the three name fields is left alone", async () => {
  // "Member" leaking into first_name alongside a real last_name is not the
  // fully-blank case this sweep targets - some real name data exists, so the
  // row is left for a human to clean up rather than guessed at.
  reset({
    rows: [{ id: "partial", firebase_uid: "u9", work_email: "partial@example.com", personal_email: "" }],
    byUid: { u9: { displayName: "Full Name", email: "partial@example.com", providerData: [] } },
    currentNames: { partial: { first: "Member", last: "Reyes", display: "" } },
  });
  const result = await backfillMemberDisplayNames();
  assert.equal(result.updated, 0);
  assert.deepEqual(stub.updates, []);
});
