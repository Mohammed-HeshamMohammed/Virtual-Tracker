// Guards the Send/Schedule PDF attachment path: it must produce a real,
// well-formed PDF (not throw, not silently return something empty), and
// switching build-report-files.js from pdfkit to report-pdf-kit.js (so the
// emailed copy matches the frontend's own Export -> To PDF download) must
// not have broken the CSV attachment sitting right next to it in the same
// file.
import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeAndActivityCsv, buildTimeAndActivityPdf } from "../src/modules/reports/build-report-files.js";

const PAYLOAD = {
  days: [
    {
      date: "2026-08-25",
      members: [
        { memberId: "m1", name: "Alex Johnson", activeSeconds: 7200, idleSeconds: 300, spentAmount: 90 },
        { memberId: "m2", name: "Sam Lee", activeSeconds: 3600, idleSeconds: 600, spentAmount: 45 },
      ],
    },
  ],
};

test("buildTimeAndActivityPdf returns a real, well-formed PDF buffer", async () => {
  const buf = await buildTimeAndActivityPdf(PAYLOAD, { title: "Time & Activity Report", rangeLabel: "Aug 25, 2026" });
  assert.ok(Buffer.isBuffer(buf), "must return a Buffer");
  assert.ok(buf.byteLength > 1000, "a report with real rows/charts should not be a near-empty document");
  assert.equal(buf.subarray(0, 5).toString("ascii"), "%PDF-", "must start with a valid PDF header");
  assert.ok(buf.subarray(-16).toString("ascii").includes("%%EOF"), "must end with a valid PDF trailer");
});

test("buildTimeAndActivityPdf handles an empty range without throwing", async () => {
  const buf = await buildTimeAndActivityPdf({ days: [] }, { title: "Time & Activity Report" });
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.subarray(0, 5).toString("ascii"), "%PDF-");
});

test("buildTimeAndActivityCsv is unaffected by the PDF builder's pdfkit -> report-pdf-kit swap", () => {
  const csv = buildTimeAndActivityCsv(PAYLOAD);
  const lines = csv.split("\n");
  assert.equal(lines[0], "Date,Member,Active hours,Idle hours");
  assert.equal(lines.length, 3, "header + one row per member");
  assert.ok(lines[1].includes("Alex Johnson") && lines[1].includes("02:00:00"));
});
