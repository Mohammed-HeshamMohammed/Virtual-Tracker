// What the server does with a request from the page for a report PDF: who may
// have which document, that the data is loaded for the viewer (never taken from
// the page), that a team table sent by the page is made safe, and that previews
// reuse recently loaded data while downloads never do.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Looking up the exchange rates is a database read; the rest of the service is pure.
mock.module("../src/modules/reports/report-currency.js", {
  namedExports: {
    resolveReportCurrency: async (url) => ({
      rateBook: new Map(),
      displayCurrency: url.searchParams.get("displayCurrency") || "USD",
      orgCurrency: "USD",
      requestedUnavailable: false,
    }),
    currencyMeta: () => ({}),
  },
});

const { buildRequestedPdf, createPayloadCache, pdfSettingsToStore, rangeLabel, sanitizeTeamReportInput } = await import(
  "../src/modules/reports/report-pdf-service.js"
);
const { ReportDocumentError } = await import("../src/modules/reports/report-documents.js");

const isPdf = (b) => Buffer.isBuffer(b) && b.subarray(0, 5).toString("latin1") === "%PDF-" && b.length > 3000;

const manager = { memberId: "mgr", roleName: "Manager" };
const employee = { memberId: "emp", roleName: "Employee" };
const client = { memberId: "cli", roleName: "Client" };

const entry = (over = {}) => ({
  date: "2026-09-01", memberId: "emp", memberName: "Ada", projectId: "p1", projectName: "Apollo", clientName: "Acme", teamName: "",
  activeSeconds: 3600, idleSeconds: 0, manualSeconds: 0, spentAmount: 10, currency: "USD", payRate: 10, payRateCurrency: "USD",
  billRate: 40, billRateCurrency: "USD", billAmount: 40, billCurrency: "USD", ...over,
});
const PAYLOAD = {
  days: [{ date: "2026-09-01", members: [{ name: "Ada", activeSeconds: 3600, idleSeconds: 0, spentAmount: 10, currency: "USD" }] }],
  entries: [entry()],
  billingIncluded: true,
  currency: { displayCurrency: "USD" },
};

function loader() {
  const calls = [];
  return { calls, loadPayload: async (args) => (calls.push(args), PAYLOAD) };
}

const teamTable = (over = {}) => ({
  groupKey: "date",
  detailKind: "member",
  rangeLabel: "Sep 1 - Sep 14, 2026",
  filters: { members: [], projects: ["Apollo"], currency: "usd" },
  totals: { time: "08:00:00", activity: 80, spent: "$120.00" },
  hoursByGroup: [{ label: "Sep 1", iso: "2026-09-01", value: 8 }],
  hoursByMember: [{ label: "Ada", value: 8 }],
  table: {
    columns: [
      { header: "Date", key: "__group" },
      { header: "Member", key: "__detail" },
      { header: "Total hours", key: "total_hours", align: "right" },
      { header: "Total spent", key: "total_spent", align: "right" },
    ],
    rows: [
      { __group: "Tue, Sep 1", __detail: "All members", total_hours: "08:00:00", total_spent: "$120.00" },
      { __group: "Tue, Sep 1", __detail: "Ada", total_hours: "08:00:00", total_spent: "$120.00" },
    ],
    rowKinds: ["group", "detail"],
  },
  withoutMoney: false,
  filename: "time-and-activity_sep-1",
  ...over,
});

// ── the team table from the page ───────────────────────────────────────────

test("a team table from the page comes through as it was sent", () => {
  const out = sanitizeTeamReportInput(teamTable());
  assert.equal(out.groupKey, "date");
  assert.deepEqual(out.table.columns.map((c) => c.key), ["__group", "__detail", "total_hours", "total_spent"]);
  assert.deepEqual(out.table.rowKinds, ["group", "detail"]);
  assert.equal(out.totals.spent, "$120.00");
  assert.equal(out.filters.currency, "USD");
  assert.equal(out.withoutMoney, false);
});

test("the server decides the organisation line, whatever the page says", () => {
  assert.equal(sanitizeTeamReportInput(teamTable({ orgLabel: "Evil Corp" })).orgLabel, "TVC");
});

test("a table that is not one is refused with a reason", () => {
  assert.throws(() => sanitizeTeamReportInput(null), (e) => e instanceof ReportDocumentError && e.status === 400);
  assert.throws(() => sanitizeTeamReportInput(teamTable({ groupKey: "weekday" })), /Unknown grouping/);
  assert.throws(() => sanitizeTeamReportInput(teamTable({ table: { columns: [], rows: [] } })), /no columns/);
  const many = { ...teamTable().table, rows: Array.from({ length: 3001 }, () => ({ __group: "x" })) };
  assert.throws(() => sanitizeTeamReportInput(teamTable({ table: many })), /more than 3000 rows/);
});

test("every field is bounded and typed: long text is cut, odd keys and kinds are dropped", () => {
  const out = sanitizeTeamReportInput(
    teamTable({
      filename: "../../etc/passwd bad name!.pdf",
      table: {
        columns: [
          { header: "H".repeat(500), key: "__group" },
          { header: "x", key: "has space" },
          { header: "x", key: "__group" },
          { header: "N", key: "n", align: "diagonal" },
        ],
        rows: [{ __group: "y".repeat(1000), n: 12, "has space": "nope" }, { __group: { nested: true } }],
        rowKinds: ["total", "bogus"],
        rowIso: ["2026-09-01", "not a date"],
      },
      totals: { time: "t".repeat(100), activity: 250, spent: 5 },
    }),
  );
  assert.deepEqual(out.table.columns.map((c) => c.key), ["__group", "n"], "a key with a space and a duplicate are dropped");
  assert.equal(out.table.columns[0].header.length, 80);
  assert.equal(out.table.columns[1].align, "left", "an unknown alignment is left");
  assert.equal(out.table.rows[0].__group.length, 300);
  assert.equal(out.table.rows[0].n, "12", "a number is printed as text");
  assert.equal(out.table.rows[1].__group, "", "an object is not text");
  assert.deepEqual(out.table.rowKinds, ["total", "detail"]);
  assert.deepEqual(out.table.rowIso, ["2026-09-01", undefined]);
  assert.equal(out.totals.activity, 100, "a percentage is clamped");
  assert.equal(out.totals.time.length, 20);
  assert.doesNotMatch(out.filename, /[\/\\ !]/, "a file name has no path or odd characters");
});

test("a viewer who may not see money can never get any into the table", () => {
  const out = sanitizeTeamReportInput(teamTable(), { moneyHidden: true });
  assert.equal(out.withoutMoney, true);
  assert.equal(out.totals.spent, "");
  assert.equal(out.table.columns.some((c) => /spent/.test(c.key)), false);
  assert.equal("total_spent" in out.table.rows[0], false);
});

// ── the memory for previews ────────────────────────────────────────────────

test("previews reuse data loaded moments ago, and ask again after it goes stale", async () => {
  const cache = createPayloadCache({ ttlMs: 50, max: 5 });
  let loads = 0;
  const load = async () => ++loads;
  assert.equal(await cache.get("a", load), 1);
  assert.equal(await cache.get("a", load), 1, "still fresh");
  assert.equal(await cache.get("b", load), 2, "another key is another load");
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(await cache.get("a", load), 3, "stale: loaded again");
});

test("the memory stays small", async () => {
  const cache = createPayloadCache({ ttlMs: 60_000, max: 3 });
  for (let i = 0; i < 10; i++) await cache.get(`k${i}`, async () => i);
  assert.ok(cache.size <= 4);
});

// ── a request from the page ────────────────────────────────────────────────

test("the team report as the page shows it is drawn without loading anything", async () => {
  const { calls, loadPayload } = loader();
  const { buffer, filename } = await buildRequestedPdf({
    viewer: manager, from: "2026-09-01", to: "2026-09-14", pdfOptions: { document: "report", includeAmounts: true }, team: teamTable(), loadPayload,
  });
  assert.ok(isPdf(buffer));
  assert.equal(calls.length, 0, "the page already has this table");
  assert.match(filename, /^time-and-activity_sep-1-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test("a client statement is computed from data the server loads for this viewer, in the currency asked for", async () => {
  const { calls, loadPayload } = loader();
  const { buffer, filename } = await buildRequestedPdf({
    viewer: manager, from: "2026-09-01", to: "2026-09-14", rangeLabel: "Sep 1 - Sep 14, 2026", pdfOptions: { document: "client", currency: "EGP" }, loadPayload,
  });
  assert.ok(isPdf(buffer));
  assert.match(filename, /^client-statement_/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].currency.displayCurrency, "EGP");
  assert.equal(calls[0].requestedMemberId, null, "a statement is not for one member");
});

test("a pay slip loads only that member", async () => {
  const { calls, loadPayload } = loader();
  const { filename } = await buildRequestedPdf({
    viewer: manager, from: "2026-09-01", to: "2026-09-14", pdfOptions: { document: "payslip", memberId: "emp" }, loadPayload,
  });
  assert.equal(calls[0].requestedMemberId, "emp");
  assert.match(filename, /^pay-slip_ada_/);
});

test("a refused document is refused before anything is loaded", async () => {
  const { calls, loadPayload } = loader();
  const ask = (viewer, pdfOptions) => buildRequestedPdf({ viewer, from: "2026-09-01", to: "2026-09-14", pdfOptions, loadPayload });
  await assert.rejects(ask(employee, { document: "client" }), (e) => e.status === 403, "a client statement is for managers");
  await assert.rejects(ask(employee, { document: "payslip", memberId: "someone-else" }), (e) => e.status === 403, "somebody else's pay");
  await assert.rejects(ask(manager, { document: "payslip" }), (e) => e.status === 400, "no member chosen");
  await assert.doesNotReject(ask(employee, { document: "payslip", memberId: "emp" }), "one's own pay slip");
  assert.equal(calls.length, 1, "only the allowed one loaded anything");
});

test("a Client login can ask for the team report only, and gets no money in it", async () => {
  const { loadPayload } = loader();
  await assert.rejects(
    buildRequestedPdf({ viewer: client, from: "2026-09-01", to: "2026-09-14", pdfOptions: { document: "client" }, loadPayload }),
    (e) => e.status === 403,
  );
  const { buffer } = await buildRequestedPdf({
    viewer: client, from: "2026-09-01", to: "2026-09-14", pdfOptions: { document: "report", includeAmounts: true }, team: teamTable(), loadPayload,
  });
  assert.ok(isPdf(buffer));
});

test("previews reuse the loaded data, downloads always load it fresh", async () => {
  const { calls, loadPayload } = loader();
  const cache = createPayloadCache({ ttlMs: 60_000 });
  const ask = (preview, pdfOptions = { document: "client" }) =>
    buildRequestedPdf({ viewer: manager, from: "2026-09-01", to: "2026-09-14", pdfOptions, preview, cache, loadPayload });
  await ask(true);
  await ask(true, { document: "client", template: "stripe", language: "ar" });
  assert.equal(calls.length, 1, "a change of design does not reload the data");
  await ask(true, { document: "client", currency: "EGP" });
  assert.equal(calls.length, 2, "a different currency is different data");
  await ask(false);
  await ask(false);
  assert.equal(calls.length, 4, "a download never takes it from memory");
});

test("the range reads as the page wrote it, or as dates", () => {
  assert.equal(rangeLabel("2026-09-01", "2026-09-01"), "2026-09-01");
  assert.equal(rangeLabel("2026-09-01", "2026-09-14"), "2026-09-01 - 2026-09-14");
});

// ── the route ──────────────────────────────────────────────────────────────

test("saved PDF settings keep only how documents look, and only values the renderer accepts", () => {
  const stored = pdfSettingsToStore({
    template: "stripe",
    language: "ar",
    headerNote: "Thanks!",
    show: { notes: false },
    document: "payslip",
    memberId: "someone-else",
    projectNames: ["Secret"],
    currency: "EGP",
    includeAmounts: true,
  });
  assert.equal(stored.template, "stripe");
  assert.equal(stored.language, "ar");
  assert.equal(stored.show.notes, false);
  for (const k of ["document", "memberId", "projectNames", "currency", "includeAmounts"]) {
    assert.ok(!(k in stored), `${k} is not part of the saved look`);
  }
  assert.equal(pdfSettingsToStore({ template: "nope", logo: "javascript:alert(1)" }).template, "virtual-tracker");
  assert.ok(!pdfSettingsToStore({ logo: "javascript:alert(1)" }).logo);
  assert.equal(pdfSettingsToStore(null).template, "virtual-tracker");
});
