// Guards the real bug: a schedule used to get marked "sent" (last_sent_at
// stamped) even when delivery fully failed - sendEmailViaNotify fails soft
// (returns sent:false), it doesn't throw, so the unconditional mark-sent
// call after it silently swallowed the failure and made the schedule wait a
// full frequency period before trying again, with nothing ever arriving.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const stub = {
  schedules: [],
  markedSentIds: [],
  sendResult: { sent: true },
  creatorRole: "Manager",
  visibleIds: ["m1", "m2", "m3"],
  /** Arguments the payload loader was called with, so the tests can assert on
   *  who the report was actually built for and whether a viewer was passed. */
  loadCalls: [],
  /** The PDF options each attachment was built with. */
  attachmentOptions: [],
  /** When set, the creator may not have the document the schedule asks for. */
  documentRefusal: null,
};

// The runner lists schedules per live tenant (active-tenants.js); one tenant
// keeps every assertion below about a single tenant's schedules.
mock.module("../src/lib/postgres/active-tenants.js", {
  namedExports: {
    forEachActiveTenant: async (fn) => [await fn("00000000-0000-0000-0000-000000000001")],
    listActiveTenantIds: async () => ["00000000-0000-0000-0000-000000000001"],
  },
});
mock.module("../src/lib/postgres/report-schedules-postgres.service.js", {
  namedExports: {
    listReportSchedulesPg: async () => stub.schedules,
    markReportScheduleSentPg: async (id) => {
      stub.markedSentIds.push(id);
    },
  },
});

mock.module("../src/modules/reports/date-range-kind.js", {
  namedExports: {
    isReportScheduleDue: () => true,
    resolveDateRangeKind: () => ({ from: "2026-09-01", to: "2026-09-02" }),
  },
});

mock.module("../src/modules/activity/activity-scope.js", {
  namedExports: {
    resolveMemberRoleName: async () => stub.creatorRole,
  },
});

mock.module("../src/modules/member-relationships/service.js", {
  namedExports: {
    getVisibleMemberIds: async () => stub.visibleIds,
  },
});

mock.module("../src/modules/reports/routes.js", {
  namedExports: {
    loadTimeAndActivityReportPayloadForMemberIds: async (_db, memberIds, from, to, viewer, ...rest) => {
      stub.loadCalls.push({ memberIds, from, to, viewer, currency: rest[1] });
      return { days: [], entries: [] };
    },
  },
});

// The PDF helpers live in their own module; the runner takes them from there.
mock.module("../src/modules/reports/report-pdf-service.js", {
  namedExports: {
    buildReportAttachment: async (_payload, _fileType, _range, pdfOptions) => {
      stub.attachmentOptions.push(pdfOptions);
      return { filename: "report.pdf", content: Buffer.from(""), contentType: "application/pdf" };
    },
    rangeLabel: () => "Sep 1 - Sep 2",
    // The real one checks the options against the creator's rights; here it
    // answers from the stub so each test can decide what the creator may have.
    resolvePdfRequest: async (_viewer, raw) => {
      if (stub.documentRefusal) {
        const { ReportDocumentError } = await import("../src/modules/reports/report-documents.js");
        throw new ReportDocumentError(stub.documentRefusal, 403);
      }
      return { options: raw ?? null, currency: raw?.currency ? { displayCurrency: raw.currency } : null };
    },
  },
});

mock.module("../src/modules/reports/member-timezones.js", {
  namedExports: {
    getMemberTimezones: async () => new Map([["m1", "UTC"]]),
  },
});

mock.module("../src/lib/notify/email-client.js", {
  namedExports: {
    sendEmailViaNotify: async () => stub.sendResult,
  },
});

const { processDueReportSchedules } = await import("../src/modules/reports/report-schedule-runner.js");

function reset() {
  stub.markedSentIds = [];
  stub.loadCalls = [];
  stub.attachmentOptions = [];
  stub.documentRefusal = null;
  stub.sendResult = { sent: true };
  stub.creatorRole = "Manager";
  stub.visibleIds = ["m1", "m2", "m3"];
}

function baseSchedule() {
  return {
    id: "sched-1",
    member_id: null,
    created_by: "m1",
    emails: ["a@example.com"],
    subject: "Report",
    message: "",
    file_type: "pdf",
    date_range_kind: "The last 7 days",
    frequency: "Daily",
  };
}

test("a schedule whose delivery fully fails is NOT marked sent - it must retry", async () => {
  reset();
  stub.schedules = [baseSchedule()];
  stub.sendResult = { sent: false, channel: "notify_unavailable", error: "down" };

  const result = await processDueReportSchedules({});
  assert.deepEqual(stub.markedSentIds, [], "last_sent_at must not be stamped on a failed delivery");
  assert.equal(result.sent, 0);
  assert.equal(result.processed, 1);
});

test("a schedule that delivers successfully is marked sent", async () => {
  reset();
  stub.schedules = [baseSchedule()];
  stub.sendResult = { sent: true, channel: "notify" };

  const result = await processDueReportSchedules({});
  assert.deepEqual(stub.markedSentIds, ["sched-1"]);
  assert.equal(result.sent, 1);
});

// The emailed report used to be built with no viewer, so the payload loader
// could not decide whose pay rates the reader was allowed to see and returned
// an empty rate map - every amount in every scheduled PDF was 0.00 while the
// same report on screen showed real money.
test("the report is built for a viewer, so amounts are not silently zeroed", async () => {
  reset();
  stub.schedules = [baseSchedule()];

  await processDueReportSchedules({});

  assert.equal(stub.loadCalls.length, 1);
  assert.deepEqual(stub.loadCalls[0].viewer, { memberId: "m1", roleName: "Manager" });
});

// member_id null means "no member filter" - everyone the creator can see.
// `member_id ?? created_by` read that as "just the creator", turning a whole
// team's scheduled report into one person's row.
test("a schedule with no member filter reports on everyone the creator can see", async () => {
  reset();
  stub.schedules = [baseSchedule()];

  await processDueReportSchedules({});

  assert.deepEqual(stub.loadCalls[0].memberIds, ["m1", "m2", "m3"]);
});

test("a schedule naming one member reports on just that member", async () => {
  reset();
  stub.schedules = [{ ...baseSchedule(), member_id: "m2" }];

  await processDueReportSchedules({});

  assert.deepEqual(stub.loadCalls[0].memberIds, ["m2"]);
});

// Scope is resolved at send time, not trusted from when the schedule was
// saved: a standing schedule must stop delivering once its creator loses
// access to the member it reports on.
test("a schedule stops delivering when its member leaves the creator's scope", async () => {
  reset();
  stub.schedules = [{ ...baseSchedule(), member_id: "m9" }];
  stub.visibleIds = ["m1", "m2"];

  const result = await processDueReportSchedules({});

  assert.equal(stub.loadCalls.length, 0, "no report should be built");
  assert.deepEqual(stub.markedSentIds, []);
  assert.equal(result.skipped, 1);
});

test("a schedule created by someone since demoted to Viewer stops delivering", async () => {
  reset();
  stub.schedules = [baseSchedule()];
  stub.creatorRole = "Viewer";

  const result = await processDueReportSchedules({});

  assert.equal(stub.loadCalls.length, 0);
  assert.equal(result.skipped, 1);
});

test("an employee's schedule reports only on themselves", async () => {
  reset();
  stub.schedules = [baseSchedule()];
  stub.creatorRole = "Employee";
  stub.visibleIds = ["m1", "m2", "m3"];

  await processDueReportSchedules({});

  assert.deepEqual(stub.loadCalls[0].memberIds, ["m1"]);
});

// The PDF's design and which document it is are saved with the schedule and
// used on every run; the creator's right to that document is checked again.

test("a schedule's saved PDF options reach the attachment it builds", async () => {
  reset();
  stub.schedules = [{ ...baseSchedule(), pdf_options: { document: "report", template: "stripe", language: "ar" } }];
  await processDueReportSchedules({});
  assert.deepEqual(stub.attachmentOptions, [{ document: "report", template: "stripe", language: "ar" }]);
});

test("a schedule with no saved options still builds the default team report", async () => {
  reset();
  stub.schedules = [baseSchedule()];
  const result = await processDueReportSchedules({});
  assert.equal(result.sent, 1);
  assert.deepEqual(stub.attachmentOptions, [null]);
});

test("a pay slip schedule reports on that one member, and the currency it asked for is used", async () => {
  reset();
  stub.schedules = [{ ...baseSchedule(), pdf_options: { document: "payslip", memberId: "m2", currency: "EGP" } }];
  await processDueReportSchedules({});
  assert.deepEqual(stub.loadCalls[0].memberIds, ["m2"]);
  assert.deepEqual(stub.loadCalls[0].currency, { displayCurrency: "EGP" });
});

test("a pay slip for someone the creator can no longer see is skipped, not sent and not marked sent", async () => {
  reset();
  stub.visibleIds = ["m1"];
  stub.schedules = [{ ...baseSchedule(), pdf_options: { document: "payslip", memberId: "m2" } }];
  const result = await processDueReportSchedules({});
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(stub.markedSentIds, []);
  assert.deepEqual(stub.attachmentOptions, []);
});

test("a creator who has lost the right to the document gets nothing, and the schedule is not marked sent", async () => {
  reset();
  stub.documentRefusal = "Client statements are for managers and above.";
  stub.schedules = [{ ...baseSchedule(), pdf_options: { document: "client" } }];
  const result = await processDueReportSchedules({});
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(stub.markedSentIds, []);
  assert.deepEqual(stub.attachmentOptions, []);
});
