// Guards the real bug: a schedule used to get marked "sent" (last_sent_at
// stamped) even when delivery fully failed - sendEmailViaNotify fails soft
// (returns sent:false), it doesn't throw, so the unconditional mark-sent
// call after it silently swallowed the failure and made the schedule wait a
// full frequency period before trying again, with nothing ever arriving.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ schedules: any[], markedSentIds: string[], sendResult: { sent: boolean } }} */
const stub = { schedules: [], markedSentIds: [], sendResult: { sent: true } };

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

mock.module("../src/modules/reports/routes.js", {
  namedExports: {
    loadTimeAndActivityReportPayloadForMemberIds: async () => ({ days: [], entries: [] }),
    buildReportAttachment: async () => ({ filename: "report.pdf", content: Buffer.from(""), contentType: "application/pdf" }),
    rangeLabel: () => "Sep 1 - Sep 2",
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
  stub.schedules = [baseSchedule()];
  stub.markedSentIds = [];
  stub.sendResult = { sent: false, channel: "notify_unavailable", error: "down" };

  const result = await processDueReportSchedules({});
  assert.deepEqual(stub.markedSentIds, [], "last_sent_at must not be stamped on a failed delivery");
  assert.equal(result.sent, 0);
  assert.equal(result.processed, 1);
});

test("a schedule that delivers successfully is marked sent", async () => {
  stub.schedules = [baseSchedule()];
  stub.markedSentIds = [];
  stub.sendResult = { sent: true, channel: "notify" };

  const result = await processDueReportSchedules({});
  assert.deepEqual(stub.markedSentIds, ["sched-1"]);
  assert.equal(result.sent, 1);
});
