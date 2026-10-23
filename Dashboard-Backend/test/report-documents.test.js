// The emailed and scheduled PDFs: which document a request may have, and that
// the server's copy of the shared PDF core builds real documents - the team
// report, a client statement and a pay slip, in either template and language.
// The routes that send, schedule and download them are run against real Postgres in
// report-routes.pglite.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCanBuildDocument,
  buildReportDocument,
  documentName,
  ReportDocumentError,
} from "../src/modules/reports/report-documents.js";
import { normalizePdfOptions } from "../src/lib/pdf-core/options.js";
import { buildTimeAndActivityPdf } from "../src/modules/reports/build-report-files.js";
import { buildReportPdfBuffer } from "../src/modules/reports/report-pdf-kit.js";
import { canViewCompensation } from "../src/http/field-policy.js";
import { isManagementRole } from "../src/http/auth-context.js";
import { stripReportMoney } from "../src/modules/reports/strip-report-money.js";

const isPdf = (buffer) => Buffer.isBuffer(buffer) && buffer.subarray(0, 5).toString("latin1") === "%PDF-" && buffer.length > 5000;

const entry = (over = {}) => ({
  date: "2026-09-01",
  memberId: "m1",
  memberName: "Ada Lovelace",
  projectId: "p1",
  projectName: "Apollo",
  clientName: "Acme",
  teamName: "Core",
  activeSeconds: 3600,
  idleSeconds: 0,
  manualSeconds: 0,
  spentAmount: 10,
  currency: "USD",
  payRate: 10,
  payRateCurrency: "USD",
  billRate: 40,
  billRateCurrency: "USD",
  billAmount: 40,
  billCurrency: "USD",
  ...over,
});

const PAYLOAD = {
  days: [
    {
      date: "2026-09-01",
      members: [
        { memberId: "m1", name: "Ada Lovelace", activeSeconds: 7200, idleSeconds: 300, spentAmount: 90, currency: "USD" },
        { memberId: "m2", name: "أحمد علي", activeSeconds: 3600, idleSeconds: 600, spentAmount: 45, currency: "USD" },
      ],
    },
  ],
  entries: [entry(), entry({ memberId: "m2", memberName: "أحمد علي", projectName: "تطبيق زيوس", clientName: "شركة النور", billTaxRate: 14, billNetTermsDays: 30 })],
  billingIncluded: true,
  currency: { displayCurrency: "USD" },
};

const manager = { memberId: "m1", roleName: "Manager" };
const employee = { memberId: "m3", roleName: "Employee" };
const policy = { isManagement: (v) => isManagementRole(v.roleName), canViewCompensation };

// ── who may have which document ────────────────────────────────────────────

test("a client statement is for managers and above", () => {
  const options = normalizePdfOptions({ document: "client" });
  assert.doesNotThrow(() => assertCanBuildDocument(options, manager, policy));
  assert.throws(() => assertCanBuildDocument(options, employee, policy), (e) => e instanceof ReportDocumentError && e.status === 403);
});

test("a pay slip needs a member, and the right to see that member's pay", () => {
  assert.throws(
    () => assertCanBuildDocument(normalizePdfOptions({ document: "payslip" }), manager, policy),
    (e) => e instanceof ReportDocumentError && e.status === 400,
    "no member chosen",
  );
  const mine = normalizePdfOptions({ document: "payslip", memberId: "m3" });
  assert.doesNotThrow(() => assertCanBuildDocument(mine, employee, policy), "one's own pay slip");
  const theirs = normalizePdfOptions({ document: "payslip", memberId: "m1" });
  assert.throws(() => assertCanBuildDocument(theirs, employee, policy), (e) => e.status === 403, "somebody else's pay");
  assert.doesNotThrow(() => assertCanBuildDocument(theirs, manager, policy));
});

test("the team report needs nothing beyond what the report already needs", () => {
  assert.doesNotThrow(() => assertCanBuildDocument(normalizePdfOptions({}), employee, policy));
});

test("the email says which document it carries", () => {
  assert.equal(documentName(normalizePdfOptions({})), "Time & Activity Report");
  assert.equal(documentName(normalizePdfOptions({ document: "client" })), "Client statement");
  assert.equal(documentName(normalizePdfOptions({ document: "payslip" })), "Pay slip");
});

// ── the documents themselves ───────────────────────────────────────────────

test("the default is the team report, built from the payload, as a real PDF", () => {
  const { buffer, filename } = buildReportDocument(PAYLOAD, { rangeLabel: "Sep 1" });
  assert.ok(isPdf(buffer));
  assert.equal(filename, "time-and-activity");
});

test("every template and language builds every document", () => {
  for (const template of ["virtual-tracker", "classic", "stripe"]) {
    for (const language of ["en", "ar"]) {
      for (const pdfOptions of [{ document: "report" }, { document: "client" }, { document: "payslip", memberId: "m2" }]) {
        const { buffer } = buildReportDocument(PAYLOAD, {
          rangeLabel: "Sep 1 - Sep 30, 2026",
          pdfOptions: { ...pdfOptions, template, language, numberFormat: language === "ar" ? "ar" : "en" },
        });
        assert.ok(isPdf(buffer), `${template}/${language}/${pdfOptions.document}`);
      }
    }
  }
});

test("a client statement and a pay slip are named for what they are, and for whose", () => {
  const client = buildReportDocument(PAYLOAD, { rangeLabel: "Sep 2026", pdfOptions: { document: "client" } });
  assert.match(client.filename, /^client-statement_/);
  const slip = buildReportDocument(PAYLOAD, { rangeLabel: "Sep 2026", pdfOptions: { document: "payslip", memberId: "m1" } });
  assert.match(slip.filename, /^pay-slip_ada-lovelace_/);
});

test("a client statement is refused when the payload was not loaded with billing", () => {
  const withoutBilling = { ...PAYLOAD, billingIncluded: false };
  assert.throws(
    () => buildReportDocument(withoutBilling, { pdfOptions: { document: "client" } }),
    (e) => e instanceof ReportDocumentError && e.status === 403,
  );
});

test("amounts in the team report are off unless asked for, and never for a viewer who may not see money", () => {
  const plain = buildReportDocument(PAYLOAD, { pdfOptions: {} }).buffer;
  const withAmounts = buildReportDocument(PAYLOAD, { pdfOptions: { includeAmounts: true } }).buffer;
  const hidden = buildReportDocument({ ...PAYLOAD, moneyHidden: true }, { pdfOptions: { includeAmounts: true } }).buffer;
  assert.ok(withAmounts.length > plain.length, "the money column and card are extra drawing");
  assert.equal(hidden.length, plain.length, "a viewer without money gets the same document as without amounts");
});

test("Arabic names are drawn with the embedded font, in an English document too", () => {
  const { buffer } = buildReportDocument(PAYLOAD, { pdfOptions: { document: "payslip", memberId: "m2" } });
  assert.ok(buffer.toString("latin1").includes("Cairo"));
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("a logo saved with a schedule is drawn in the emailed PDF, and a bad one is dropped", () => {
  const plain = buildReportDocument(PAYLOAD, { pdfOptions: { template: "stripe" } }).buffer;
  const branded = buildReportDocument(PAYLOAD, { pdfOptions: { template: "stripe", logo: PNG } });
  assert.ok(branded.buffer.length > plain.length, "the image is in the file");
  assert.equal(branded.options.logo, PNG);
  const hostile = buildReportDocument(PAYLOAD, { pdfOptions: { template: "stripe", logo: "https://evil.example/x.png" } });
  assert.equal(hostile.options.logo, "", "only a small PNG or JPEG data URL is accepted");
  assert.equal(hostile.buffer.length, plain.length);
});

test("the old template name still means the Virtual Tracker look", () => {
  assert.equal(normalizePdfOptions({ template: "default" }).template, "virtual-tracker");
});

test("options the server receives are normalised before they reach the renderer", () => {
  const { options } = buildReportDocument(PAYLOAD, {
    pdfOptions: { template: "<script>", language: "xx", document: "report", show: { charts: "yes", notes: false } },
  });
  assert.equal(options.template, "virtual-tracker");
  assert.equal(options.language, "en");
  assert.equal(options.show.charts, true);
  assert.equal(options.show.notes, false);
});

test("the older entry points still return a PDF buffer", async () => {
  assert.ok(isPdf(await buildTimeAndActivityPdf(PAYLOAD, { rangeLabel: "Aug 25, 2026" })));
  assert.ok(
    isPdf(
      buildReportPdfBuffer({
        title: "T", orgLabel: "Org", filename: "x",
        table: { columns: [{ header: "A", key: "a" }], rows: [{ a: "1" }] },
      }),
    ),
  );
});

// ── the routes ─────────────────────────────────────────────────────────────

test("a client login never gets the amounts the new documents add", () => {
  const money = { payRate: 17.25, billRate: 41.5, billAmount: 41.5, billTaxRate: 14, billNetTermsDays: 30, billNotes: "Net 30" };
  const out = stripReportMoney({
    billingIncluded: true,
    days: [{ date: "2026-09-28", members: [{ memberId: "m1", activeSeconds: 3600, ...money }] }],
    entries: [{ date: "2026-09-28", memberId: "m1", activeSeconds: 3600, ...money }],
  });
  assert.deepEqual(out.entries[0], { date: "2026-09-28", memberId: "m1", activeSeconds: 3600 });
  assert.deepEqual(out.days[0].members[0], { memberId: "m1", activeSeconds: 3600 });
});
