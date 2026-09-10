// Guards CLS-2: activity seconds bucketed into productive/neutral/
// distracting/unclassified using CLS-1's classification map, with role
// override resolved for the *tracked* member (not the viewer).
//
// Rewritten to drive `summarizeFocusedTime` directly instead of mocking four
// modules to reach one pure calculation. Two of the functions it mocked
// (sumAppLogSecondsByAppNamePg, sumUrlLogSecondsByDomainPg) no longer exist,
// and — because every case it fed used a non-browser app — it never exercised
// the path where the same seconds arrive as both an app slice and a URL
// slice, which is exactly where focused time was double-counting.
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeFocusedTime } from "../src/modules/classification/focused-time.js";

const AT = "2026-01-01T10:00:00.000Z";

const category = (matchType, pattern, cat, roleOverride) => ({
  matchType,
  pattern,
  category: cat,
  ...(roleOverride ? { roleOverride } : {}),
});

const appRow = (app_name, duration_seconds, page_title = "", started_at = AT) => ({
  session_id: "s1",
  app_name,
  page_title,
  started_at,
  duration_seconds,
});

const urlRow = (domain, duration_seconds, visited_at = AT) => ({
  session_id: "s1",
  domain,
  visited_at,
  duration_seconds,
});

const BASE = [
  category("app", "code.exe", "productive"),
  category("domain", "youtube.com", "distracting"),
  category("domain", "slack.com", "neutral"),
];

const summarize = (appRows, urlRows = [], categories = BASE, roleName = "Employee") =>
  summarizeFocusedTime({ appRows, urlRows, categories, roleName });

test("buckets known app and domain seconds into the right categories", () => {
  const out = summarize(
    [
      appRow("code.exe", 3600),
      appRow("Google Chrome", 600, "", "2026-01-01T11:00:00.000Z"),
      appRow("Google Chrome", 300, "", "2026-01-01T12:00:00.000Z"),
    ],
    [
      urlRow("youtube.com", 600, "2026-01-01T11:00:00.000Z"),
      urlRow("slack.com", 300, "2026-01-01T12:00:00.000Z"),
    ],
  );
  assert.equal(out.productiveSeconds, 3600);
  assert.equal(out.distractingSeconds, 600);
  assert.equal(out.neutralSeconds, 300);
  assert.equal(out.unclassifiedSeconds, 0);
  assert.equal(out.totalSeconds, 4500);
});

test("browser seconds are counted once, under the site - not twice", () => {
  // The agent emits an app slice and a URL slice for the SAME 15 seconds.
  // Summing both tables reported 30. This is the bug this rewrite fixes.
  const out = summarize([appRow("Google Chrome", 15)], [urlRow("youtube.com", 15)]);
  assert.equal(out.totalSeconds, 15, "15 real seconds must not report as 30");
  assert.equal(out.distractingSeconds, 15, "credited to the site that was open");
  assert.equal(out.unclassifiedSeconds, 0, "the browser itself adds nothing extra");
  assert.deepEqual(out.breakdown.map((b) => b.pattern), ["youtube.com"]);
});

test("a window-title classification reaches this report", () => {
  // No URL was readable, so the page is only known by its window title.
  const out = summarize(
    [appRow("Google Chrome", 20, "Lead Submission Form")],
    [],
    [category("window_title", "Lead Submission Form", "productive")],
  );
  assert.equal(out.productiveSeconds, 20);
  assert.equal(out.totalSeconds, 20);
});

test("an app or site with no classification row buckets as unclassified, not dropped", () => {
  const out = summarize([appRow("some-new-tool.exe", 120)]);
  assert.equal(out.unclassifiedSeconds, 120);
  assert.equal(out.totalSeconds, 120);
});

test("an unlabelled browser window is still reported, just unattributed", () => {
  const out = summarize([appRow("Google Chrome", 20, "Live Caption")]);
  assert.equal(out.unclassifiedSeconds, 20);
  assert.equal(out.totalSeconds, 20);
});

test("lookup is case-insensitive", () => {
  assert.equal(summarize([appRow("CODE.EXE", 60)]).productiveSeconds, 60);
  const browser = summarize([appRow("Google Chrome", 60)], [urlRow("YouTube.com", 60)]);
  assert.equal(browser.distractingSeconds, 60);
});

test("a role override reclassifies for the tracked member's own role", () => {
  const out = summarize(
    [appRow("Google Chrome", 600)],
    [urlRow("youtube.com", 600)],
    [category("domain", "youtube.com", "distracting", { "video editor": "productive" })],
    "Video Editor",
  );
  assert.equal(out.productiveSeconds, 600);
  assert.equal(out.distractingSeconds, 0);
});

test("no role override for this member's role falls back to the base category", () => {
  const out = summarize(
    [appRow("Google Chrome", 600)],
    [urlRow("youtube.com", 600)],
    [category("domain", "youtube.com", "distracting", { "video editor": "productive" })],
    "Employee",
  );
  assert.equal(out.distractingSeconds, 600);
});

test("non-browser apps are categorised by the app", () => {
  const out = summarize(
    [appRow("Slack", 30), appRow("Steam", 45)],
    [],
    [category("app", "Slack", "productive"), category("app", "Steam", "distracting")],
  );
  assert.equal(out.productiveSeconds, 30);
  assert.equal(out.distractingSeconds, 45);
  assert.equal(out.totalSeconds, 75);
});

test("the breakdown is sorted by seconds descending", () => {
  const out = summarize(
    [appRow("code.exe", 60), appRow("Google Chrome", 600, "", "2026-01-01T11:00:00.000Z")],
    [urlRow("youtube.com", 600, "2026-01-01T11:00:00.000Z")],
  );
  assert.equal(out.breakdown[0].pattern, "youtube.com");
  assert.equal(out.breakdown[1].pattern, "code.exe");
});

test("repeat visits to one site accumulate into a single breakdown row", () => {
  const out = summarize(
    [
      appRow("Google Chrome", 60, "", "2026-01-01T10:00:00.000Z"),
      appRow("Google Chrome", 90, "", "2026-01-01T11:00:00.000Z"),
    ],
    [
      urlRow("youtube.com", 60, "2026-01-01T10:00:00.000Z"),
      urlRow("youtube.com", 90, "2026-01-01T11:00:00.000Z"),
    ],
  );
  assert.equal(out.breakdown.length, 1);
  assert.deepEqual(out.breakdown[0].seconds, 150);
  assert.equal(out.totalSeconds, 150);
});

test("zero activity in the range returns all-zero totals, not an error", () => {
  const out = summarize([]);
  assert.equal(out.totalSeconds, 0);
  assert.deepEqual(out.breakdown, []);
});
