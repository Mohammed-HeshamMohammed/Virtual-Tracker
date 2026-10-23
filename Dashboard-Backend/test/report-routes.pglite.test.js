// The report PDF routes, run through the real handlers against a real Postgres (PGlite) built
// from the boot schema: the download, sending by email, saving a schedule, and the PDF look each
// member keeps. Emails go to an in-memory stand-in for the Notify service.
//
// Replaces source-text checks in report-documents and report-pdf-service. Skips itself when
// PGlite is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, request, loadPglite } from "./helpers/pglite.js";
import { fakeFirestore } from "./helpers/firebase-fakes.js";

if (!(await loadPglite())) {
  test("report routes against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const sent = [];
  const pg = await startPglite({
    mocks: {
      "lib/notify/email-client.js": {
        isNotifyEmailRoutingConfigured: () => true,
        sendEmailViaNotify: async (template, data) => {
          sent.push({ template, ...data });
          return { sent: true, channel: "test" };
        },
      },
    },
  });
  after(() => pg.close());
  const { insert, member } = seeder(pg);
  (await import(srcUrl("config/firebase.js"))).__setTestDb(fakeFirestore());
  const { routeReports } = await import(srcUrl("modules/reports/routes.js"));

  const owner = await member("Owner", { first_name: "Olive", timezone: "UTC" });
  const manager = await member("Manager", { first_name: "Mia", timezone: "UTC" });
  const ann = await member("Employee", { first_name: "Ann", timezone: "UTC" });
  const bob = await member("Employee", { first_name: "Bob", timezone: "UTC" });
  await insert("member_relationships", { parent_member_id: owner.id, child_member_id: manager.id });
  await insert("member_relationships", { parent_member_id: manager.id, child_member_id: ann.id });
  await insert("member_relationships", { parent_member_id: owner.id, child_member_id: bob.id });
  // A Team Lead sees their report's time but is not management, so may not see their pay.
  const lead = await member("Team Lead", { first_name: "Lee", timezone: "UTC" });
  const cal = await member("Employee", { first_name: "Cal", timezone: "UTC" });
  await insert("member_relationships", { parent_member_id: owner.id, child_member_id: lead.id });
  await insert("member_relationships", { parent_member_id: lead.id, child_member_id: cal.id });
  const project = await insert("projects", { name: "Website" });
  for (const m of [ann, bob, cal]) {
    await insert("activity_sessions", { member_id: m.id, project_id: project.id, status: "stopped", active_seconds: 3600, started_at: "2026-09-28T09:00:00Z", ended_at: "2026-09-28T10:00:00Z" });
    await insert("pay_rates", { member_id: m.id, type: "hourly", rate: 20, currency: "USD" });
  }

  const as = (m, roleName) => ({ memberId: m.id, roleName, uid: `uid-${m.id}` });
  const OWNER = as(owner, "Owner");
  const ANN = as(ann, "Employee");
  const LEAD = as(lead, "Team Lead");
  const call = (method, path, viewer, body) =>
    request({ method, path, viewer, body }, (req, res, url) => routeReports(req, res, url, undefined));
  const pdf = (viewer, body) => call("POST", "/api/reports/time-and-activity/pdf", viewer, { from: "2026-09-28", to: "2026-09-28", ...body });
  const isPdf = (res) => Buffer.from(res.body.data.contentBase64, "base64").subarray(0, 5).toString("latin1") === "%PDF-";

  test("the download answers with a PDF file built from the server's own data", async () => {
    const res = await pdf(OWNER, { pdfOptions: { document: "report" } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.contentType, "application/pdf");
    assert.ok(isPdf(res));
    assert.match(res.body.data.filename, /\.pdf$/);
  });

  test("a pay slip is refused to someone who may not see that member's pay, and allowed for their own", async () => {
    const other = await pdf(ANN, { pdfOptions: { document: "payslip", memberId: bob.id } });
    assert.equal(other.statusCode, 403);
    const own = await pdf(ANN, { pdfOptions: { document: "payslip", memberId: ann.id } });
    assert.equal(own.statusCode, 200, JSON.stringify(own.body));
    assert.ok(isPdf(own));
  });

  test("someone who sees a member's time but not their pay cannot make their pay slip", async () => {
    const team = await pdf(LEAD, { pdfOptions: { document: "report" } });
    assert.equal(team.statusCode, 200, "the Team Lead can report on their team");
    const slip = await pdf(LEAD, { pdfOptions: { document: "payslip", memberId: cal.id } });
    assert.equal(slip.statusCode, 403);
    assert.match(slip.body.error, /not allowed to see this member's pay/);
  });

  test("a client statement is for managers and above", async () => {
    for (const viewer of [ANN, LEAD]) {
      const res = await pdf(viewer, { pdfOptions: { document: "client" } });
      assert.equal(res.statusCode, 403);
      assert.match(res.body.error, /managers and above/);
    }
  });

  test("bad dates are refused, and nobody signed out gets anything", async () => {
    assert.equal((await pdf(OWNER, { from: "2026-09-30", to: "2026-09-01" })).statusCode, 400);
    assert.equal((await pdf(OWNER, { from: "yesterday" })).statusCode, 400);
    assert.equal((await pdf(null, {})).statusCode, 401);
  });

  test("sending checks the document against the viewer and names it in the email", async () => {
    sent.length = 0;
    const refused = await call("POST", "/api/reports/time-and-activity/send", ANN, {
      from: "2026-09-28", to: "2026-09-28", emails: ["a@example.test"], pdfOptions: { document: "payslip", memberId: bob.id },
    });
    assert.equal(refused.statusCode, 403);
    assert.equal(sent.length, 0, "nothing was emailed");
    const ok = await call("POST", "/api/reports/time-and-activity/send", OWNER, {
      from: "2026-09-28", to: "2026-09-28", emails: ["a@example.test", "b@example.test"], pdfOptions: { document: "payslip", memberId: ann.id },
    });
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.data, { sent: 2, total: 2 });
    assert.deepEqual(sent.map((s) => s.reportName), ["Pay slip", "Pay slip"]);
    assert.equal(sent[0].attachment.contentType, "application/pdf");
  });

  const schedule = (viewer, pdfOptions) =>
    call("POST", "/api/reports/time-and-activity/schedule", viewer, {
      emails: ["c@example.test"], scheduleName: "Weekly slip", dateRangeKind: "last_week", frequency: "Weekly", deliveryTime: "9:00 am", pdfOptions,
    });

  test("a schedule keeps the options it was saved with, and its pay slip is about that member", async () => {
    const res = await schedule(OWNER, { document: "payslip", memberId: ann.id, template: "stripe", language: "ar" });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const [row] = await pg.rows("SELECT member_id, pdf_options FROM report_schedules WHERE id = $1", [res.body.data.id]);
    assert.equal(row.member_id, ann.id);
    assert.equal(row.pdf_options.document, "payslip");
    assert.equal(row.pdf_options.template, "stripe");
    assert.equal(row.pdf_options.language, "ar");
  });

  test("a schedule for a document the viewer may not have is refused and not saved", async () => {
    const before = (await pg.rows("SELECT count(*)::int AS n FROM report_schedules"))[0].n;
    assert.equal((await schedule(ANN, { document: "payslip", memberId: bob.id })).statusCode, 403);
    assert.equal((await pg.rows("SELECT count(*)::int AS n FROM report_schedules"))[0].n, before);
  });

  test("each member keeps their own PDF look, and only the look", async () => {
    const put = await call("PUT", "/api/reports/pdf-settings", ANN, { template: "stripe", language: "ar", document: "payslip", memberId: bob.id });
    assert.equal(put.statusCode, 200, JSON.stringify(put.body));
    const mine = await call("GET", "/api/reports/pdf-settings", ANN);
    assert.equal(mine.body.data.template, "stripe");
    assert.equal(mine.body.data.language, "ar");
    assert.equal("memberId" in mine.body.data, false);
    assert.equal("document" in mine.body.data, false);
    const [row] = await pg.rows("SELECT options FROM report_pdf_settings WHERE member_id = $1", [ann.id]);
    assert.equal("memberId" in row.options || "document" in row.options, false, "only the look is stored");
    const theirs = await call("GET", "/api/reports/pdf-settings", OWNER);
    assert.equal(theirs.body.data, null, "another member has not saved one");
    assert.equal((await call("GET", "/api/reports/pdf-settings", null)).statusCode, 401);
  });
}
