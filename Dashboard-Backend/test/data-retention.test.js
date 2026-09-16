// Guards CF-5: retention ceilings actually enforce (nothing retained
// indefinitely), DSAR export gathers all four stores for one member,
// erasure removes hot storage AND archived GCS objects, and every setting/
// erasure write is admin-gated the same way CF-1's registry is.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {Map<string, number>} */
let retentionDays;
/** @type {{ id: string, screenshot_url: string|null }[]} */
let expiredArchived;
/** @type {string[]} */
let deletedGcsObjects;
/** @type {{ dataType: string, calls: number[] }[]} */
let deleteCalls;
/** @type {{ id: string, member_id: string, image_data: string|null, captured_at: string }[]} */
let toArchive;
/** @type {{ id: string, objectPath: string }[]} */
let markedArchived;
/** @type {string[]} */
let uploadedObjects;
/** @type {string|null} whether uploadToGCS should throw for this object path */
let failUploadFor;
/** @type {string} empty string means "no bucket configured", matching the real resolveGcsBucketName */
let gcsBucketName;

mock.module("../src/lib/postgres/data-retention-postgres.service.js", {
  namedExports: {
    getRetentionSettingsPg: async () =>
      [...retentionDays.entries()].map(([data_type, retention_days]) => ({
        data_type,
        retention_days,
        updated_by: null,
        updated_at: new Date().toISOString(),
      })),
    setRetentionDaysPg: async (dataType, days, updatedBy) => {
      retentionDays.set(dataType, days);
      return { data_type: dataType, retention_days: days, updated_by: updatedBy, updated_at: new Date().toISOString() };
    },
    findScreenshotsToArchivePg: async () => toArchive,
    markScreenshotArchivedPg: async (id, objectPath) => {
      markedArchived.push({ id, objectPath });
    },
    findExpiredArchivedScreenshotsPg: async () => expiredArchived,
    deleteScreenshotsByIdPg: async (ids) => ids.length,
    deleteExpiredInlineScreenshotsPg: async (days) => {
      deleteCalls.push({ dataType: "screenshots_inline", calls: [days] });
      return 2;
    },
    deleteExpiredAppLogsPg: async (days) => {
      deleteCalls.push({ dataType: "app_logs", calls: [days] });
      return 3;
    },
    deleteExpiredUrlLogsPg: async (days) => {
      deleteCalls.push({ dataType: "url_logs", calls: [days] });
      return 4;
    },
    deleteExpiredSessionsPg: async (days) => {
      deleteCalls.push({ dataType: "sessions", calls: [days] });
      return 1;
    },
    getAllScreenshotMetaForMemberPg: async (memberId) => [{ id: "s1", member: memberId }],
    getAllAppLogsForMemberPg: async () => [{ id: "a1" }],
    getAllUrlLogsForMemberPg: async () => [{ id: "u1" }],
    getAllSessionsForMemberPg: async () => [{ id: "sess1" }],
    eraseMemberScreenshotsPg: async () => [
      { id: "erased-1", screenshot_url: "activity-screenshots/m1/erased-1.webp" },
      { id: "erased-2", screenshot_url: null },
    ],
    eraseMemberAppLogsPg: async () => 5,
    eraseMemberUrlLogsPg: async () => 6,
    eraseMemberEndedSessionsPg: async () => 2,
    recordScreenshotAccessPg: async () => {},
    getScreenshotAccessLogPg: async () => [
      { id: "log-1", screenshot_id: "s1", reader_member_id: "reader-1", accessed_at: new Date().toISOString() },
    ],
  },
});

mock.module("../src/lib/gcs/upload.js", {
  namedExports: {
    deleteFromGCS: async (objectPath) => {
      deletedGcsObjects.push(objectPath);
    },
    getPublicUrl: async () => null,
    getSignedUrl: async () => null,
    // Synchronous in the real module - archiveAgedScreenshots's `if
    // (!resolveGcsBucketName())` guard would always pass on a Promise
    // (always truthy) if this were mocked async, silently skipping the
    // "no bucket configured" test case below.
    resolveGcsBucketName: () => gcsBucketName,
    uploadToGCS: async (_buffer, objectPath) => {
      if (objectPath === failUploadFor) {
        throw new Error("simulated GCS upload failure");
      }
      uploadedObjects.push(objectPath);
    },
  },
});

const {
  getRetentionSettings,
  setRetentionDays,
  runRetentionSweep,
  buildDsarExport,
  eraseMemberMonitoringData,
  recordScreenshotAccess,
  getScreenshotAccessLog,
  DATA_TYPES,
} = await import("../src/modules/compliance/data-retention.js");

const ADMIN = { memberId: "admin-1", roleName: "Admin" };
const EMPLOYEE = { memberId: "employee-1", roleName: "Employee" };

function reset() {
  retentionDays = new Map([
    ["screenshots", 90],
    ["app_logs", 180],
    ["url_logs", 180],
    ["sessions", 730],
  ]);
  expiredArchived = [];
  deletedGcsObjects = [];
  deleteCalls = [];
  toArchive = [];
  markedArchived = [];
  uploadedObjects = [];
  failUploadFor = null;
  gcsBucketName = "test-bucket";
}

test("every known data type has a finite retention ceiling by default", async () => {
  reset();
  const settings = await getRetentionSettings();
  assert.equal(settings.length, DATA_TYPES.length);
  assert.ok(settings.every((s) => Number.isFinite(s.retentionDays) && s.retentionDays > 0));
});

test("a non-management actor cannot change retention settings", async () => {
  reset();
  await assert.rejects(() => setRetentionDays("screenshots", 30, EMPLOYEE), /FORBIDDEN|management/i);
});

test("zero or negative retention is rejected - no 'never delete' option", async () => {
  reset();
  await assert.rejects(() => setRetentionDays("screenshots", 0, ADMIN), /INVALID_RETENTION_DAYS|positive/i);
  await assert.rejects(() => setRetentionDays("screenshots", -5, ADMIN), /INVALID_RETENTION_DAYS|positive/i);
});

test("an unknown data type is rejected", async () => {
  reset();
  await assert.rejects(() => setRetentionDays("keystrokes", 30, ADMIN), /unknown data type/i);
});

test("management can tighten a retention window", async () => {
  reset();
  const updated = await setRetentionDays("screenshots", 30, ADMIN);
  assert.equal(updated.retentionDays, 30);
});

test("the sweep deletes expired rows across all four stores using each type's own ceiling", async () => {
  reset();
  retentionDays.set("screenshots", 30);
  retentionDays.set("app_logs", 60);
  retentionDays.set("url_logs", 45);
  retentionDays.set("sessions", 400);

  const result = await runRetentionSweep();

  assert.equal(result.appLogsDeleted, 3);
  assert.equal(result.urlLogsDeleted, 4);
  assert.equal(result.sessionsDeleted, 1);
  assert.equal(deleteCalls.find((c) => c.dataType === "app_logs").calls[0], 60);
  assert.equal(deleteCalls.find((c) => c.dataType === "url_logs").calls[0], 45);
  assert.equal(deleteCalls.find((c) => c.dataType === "sessions").calls[0], 400);
});

test("the sweep archives an aged inline screenshot to GCS and clears its inline image data", async () => {
  // This used to only happen if someone ran scripts/archive-screenshots.mjs
  // by hand - nothing auto-scheduled it, so a screenshot sat as full
  // Postgres bytea for the entire retention window instead of being
  // offloaded after a few days. It must now happen as part of the same
  // sweep that already runs every 24h.
  reset();
  toArchive = [{ id: "shot-9", member_id: "m9", image_data: "raw-bytes", captured_at: new Date().toISOString() }];
  const result = await runRetentionSweep();
  assert.deepEqual(uploadedObjects, ["activity-screenshots/m9/shot-9.webp"]);
  assert.deepEqual(markedArchived, [{ id: "shot-9", objectPath: "activity-screenshots/m9/shot-9.webp" }]);
  assert.equal(result.screenshotsArchived, 1);
});

test("a failed upload leaves the screenshot inline for the next sweep instead of losing it", async () => {
  reset();
  toArchive = [{ id: "shot-bad", member_id: "m1", image_data: "raw-bytes", captured_at: new Date().toISOString() }];
  failUploadFor = "activity-screenshots/m1/shot-bad.webp";
  const result = await runRetentionSweep();
  assert.deepEqual(markedArchived, [], "never marked archived - the row keeps its inline data");
  assert.equal(result.screenshotsArchived, 0);
});

test("no GCS bucket configured skips archiving quietly instead of failing every row", async () => {
  reset();
  gcsBucketName = "";
  toArchive = [{ id: "shot-1", member_id: "m1", image_data: "raw-bytes", captured_at: new Date().toISOString() }];
  const result = await runRetentionSweep();
  assert.deepEqual(uploadedObjects, []);
  assert.equal(result.screenshotsArchived, 0);
});

test("the sweep deletes the GCS object before deleting an archived screenshot row", async () => {
  reset();
  expiredArchived = [{ id: "shot-1", screenshot_url: "activity-screenshots/m1/shot-1.webp" }];
  const result = await runRetentionSweep();
  assert.deepEqual(deletedGcsObjects, ["activity-screenshots/m1/shot-1.webp"]);
  assert.equal(result.screenshotsArchivedDeleted, 1);
});

test("a DSAR export gathers all four stores for one member in a single package", async () => {
  reset();
  const dsar = await buildDsarExport("member-1");
  assert.ok(Array.isArray(dsar.screenshots) && dsar.screenshots.length === 1);
  assert.ok(Array.isArray(dsar.appLogs) && dsar.appLogs.length === 1);
  assert.ok(Array.isArray(dsar.urlLogs) && dsar.urlLogs.length === 1);
  assert.ok(Array.isArray(dsar.sessions) && dsar.sessions.length === 1);
  assert.equal(dsar.memberId, "member-1");
});

test("a non-management actor cannot erase monitoring data", async () => {
  reset();
  await assert.rejects(() => eraseMemberMonitoringData("member-1", EMPLOYEE), /FORBIDDEN|management/i);
});

test("erasure deletes archived screenshots from GCS as well as the row, and skips never-archived ones", async () => {
  reset();
  const result = await eraseMemberMonitoringData("member-1", ADMIN);
  assert.deepEqual(deletedGcsObjects, ["activity-screenshots/m1/erased-1.webp"], "only the archived one has a GCS object to delete");
  assert.equal(result.screenshotsDeleted, 2);
  assert.equal(result.appLogsDeleted, 5);
  assert.equal(result.urlLogsDeleted, 6);
  assert.equal(result.sessionsDeleted, 2);
});

test("recordScreenshotAccess and getScreenshotAccessLog round-trip", async () => {
  reset();
  await recordScreenshotAccess({ screenshotId: "s1", screenshotOwner: "owner-1", readerMemberId: "reader-1" });
  const log = await getScreenshotAccessLog("owner-1");
  assert.equal(log.length, 1);
  assert.equal(log[0].readerMemberId, "reader-1");
});
