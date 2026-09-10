// The Apps & URLs report summed activity_app_logs and activity_url_logs into
// two tables, but the agent emits an app slice and a URL slice for the *same*
// tick - so browsing appeared in both and anyone adding the totals got roughly
// double the tracked day. It also grouped by app name, so browsing was
// reported as "Google Chrome" and could not be classified at all.
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAppsAndUrls } from "../src/modules/reports/build-apps-urls-rows.js";

const CATEGORIES = [
  { matchType: "app", pattern: "Visual Studio Code", category: "productive" },
  { matchType: "domain", pattern: "github.com", category: "productive" },
  { matchType: "domain", pattern: "youtube.com", category: "distracting" },
  { matchType: "window_title", pattern: "Live Caption", category: "neutral" },
];

function appSlice(overrides) {
  return {
    member_id: "m1",
    session_id: "s1",
    app_name: "Google Chrome",
    page_title: "",
    started_at: "2026-09-10T10:00:00.000Z",
    duration_seconds: 60,
    ...overrides,
  };
}

test("browser seconds land in URLs only - never in both tables", () => {
  const { apps, urls } = summarizeAppsAndUrls({
    appSlices: [appSlice({ duration_seconds: 900 })],
    urlSlices: [
      { session_id: "s1", domain: "github.com", visited_at: "2026-09-10T10:00:00.000Z", duration_seconds: 900 },
    ],
    categories: CATEGORIES,
  });

  assert.deepEqual(apps, []);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].domain, "github.com");
  assert.equal(urls[0].totalSeconds, 900);
  // The old report showed "Google Chrome 900s" AND "github.com 900s" - 1800
  // seconds for 900 seconds of work.
  const total = [...apps, ...urls].reduce((sum, row) => sum + row.totalSeconds, 0);
  assert.equal(total, 900);
});

test("a non-browser app keeps its own name and category", () => {
  const { apps, urls } = summarizeAppsAndUrls({
    appSlices: [appSlice({ app_name: "Visual Studio Code", duration_seconds: 300 })],
    urlSlices: [],
    categories: CATEGORIES,
  });
  assert.deepEqual(urls, []);
  assert.deepEqual(apps, [
    { memberId: "m1", appName: "Visual Studio Code", category: "productive", totalSeconds: 300 },
  ]);
});

test("browsing is classified by site, not by the browser", () => {
  const { urls } = summarizeAppsAndUrls({
    appSlices: [
      appSlice({ started_at: "2026-09-10T10:00:00.000Z", duration_seconds: 600 }),
      appSlice({ started_at: "2026-09-10T10:10:00.000Z", duration_seconds: 600 }),
    ],
    urlSlices: [
      { session_id: "s1", domain: "github.com", visited_at: "2026-09-10T10:00:00.000Z", duration_seconds: 600 },
      { session_id: "s1", domain: "youtube.com", visited_at: "2026-09-10T10:10:00.000Z", duration_seconds: 600 },
    ],
    categories: CATEGORIES,
  });
  assert.deepEqual(
    urls.map((u) => [u.domain, u.category]),
    [
      ["github.com", "productive"],
      ["youtube.com", "distracting"],
    ],
  );
});

// `WHERE domain <> ''` used to drop these entirely - the very rows the classify
// dialog exists to let someone label.
test("a page the agent could only read as a window title still appears", () => {
  const { apps, urls } = summarizeAppsAndUrls({
    appSlices: [appSlice({ page_title: "Live Caption - Google Chrome", duration_seconds: 120 })],
    urlSlices: [],
    categories: CATEGORIES,
  });
  assert.deepEqual(apps, []);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].domain, "Live Caption");
  assert.equal(urls[0].category, "neutral");
  assert.equal(urls[0].identifiedBy, "window title");
});

test("a site name in the window title is used when no URL was captured", () => {
  const { urls } = summarizeAppsAndUrls({
    appSlices: [appSlice({ page_title: "Pull requests | GitHub", duration_seconds: 60 })],
    urlSlices: [],
    categories: [{ matchType: "domain", pattern: "GitHub", category: "productive" }],
  });
  assert.equal(urls[0].domain, "GitHub");
  assert.equal(urls[0].identifiedBy, "site name in window title");
});

// Falling back to the browser's own name is the honest answer when nothing
// about the page is knowable, and that belongs under Apps.
test("browsing with nothing identifiable falls back to the browser under Apps", () => {
  const { apps, urls } = summarizeAppsAndUrls({
    appSlices: [appSlice({ page_title: "", duration_seconds: 45 })],
    urlSlices: [],
    categories: CATEGORIES,
  });
  assert.deepEqual(urls, []);
  assert.equal(apps[0].appName, "Google Chrome");
  assert.equal(apps[0].category, "unclassified");
});

test("slices for the same target are summed, and rows are ordered by time spent", () => {
  const { apps } = summarizeAppsAndUrls({
    appSlices: [
      appSlice({ app_name: "Slack", duration_seconds: 100 }),
      appSlice({ app_name: "Slack", duration_seconds: 50 }),
      appSlice({ app_name: "Visual Studio Code", duration_seconds: 400 }),
    ],
    urlSlices: [],
    categories: CATEGORIES,
  });
  assert.deepEqual(
    apps.map((a) => [a.appName, a.totalSeconds]),
    [
      ["Visual Studio Code", 400],
      ["Slack", 150],
    ],
  );
});

test("members are never merged, even on the same app", () => {
  const { apps } = summarizeAppsAndUrls({
    appSlices: [
      appSlice({ member_id: "m1", app_name: "Slack", duration_seconds: 100 }),
      appSlice({ member_id: "m2", app_name: "Slack", duration_seconds: 100 }),
    ],
    urlSlices: [],
    categories: CATEGORIES,
  });
  assert.equal(apps.length, 2);
  assert.deepEqual(apps.map((a) => a.memberId).sort(), ["m1", "m2"]);
});

test("a role override wins over the base category", () => {
  const { apps } = summarizeAppsAndUrls({
    appSlices: [appSlice({ app_name: "Slack", duration_seconds: 60 })],
    urlSlices: [],
    categories: [
      { matchType: "app", pattern: "Slack", category: "distracting", roleOverride: { manager: "productive" } },
    ],
    roleName: "Manager",
  });
  assert.equal(apps[0].category, "productive");
});

test("zero-second slices are ignored rather than creating empty rows", () => {
  const { apps } = summarizeAppsAndUrls({
    appSlices: [appSlice({ app_name: "Slack", duration_seconds: 0 })],
    urlSlices: [],
    categories: CATEGORIES,
  });
  assert.deepEqual(apps, []);
});
