import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUrlIndex,
  resolveActivityCategory,
} from "../src/modules/activity/category-resolver.js";

// The bug this exists for: a browser is a container, not an activity.
// Categorising foreground time by "Google Chrome" put every browsed second in
// whatever that app was classified as (in practice `unclassified`), while the
// URLs feed classified the SAME seconds by domain and got it right - so the
// Apps tab and URLs tab could report contradictory productivity for one
// member on one day.

const CATEGORIES = {
  "app:google chrome": "unclassified",
  "app:slack": "productive",
  "app:steam": "distracting",
  "domain:github.com": "productive",
  "domain:reddit.com": "distracting",
  "domain:news.ycombinator.com": "neutral",
  "domain:github": "productive",
};

const lookup = (matchType, pattern) =>
  CATEGORIES[`${matchType}:${String(pattern || "").trim().toLowerCase()}`] ?? "unclassified";

const AT = "2026-09-04T10:00:00.000Z";
const urlRow = (sessionId, domain, visitedAt, durationSeconds = 15) => ({
  session_id: sessionId,
  domain,
  visited_at: visitedAt,
  duration_seconds: durationSeconds,
});

test("a non-browser app is categorised by the app, unchanged", () => {
  for (const [app, expected] of [["Slack", "productive"], ["Steam", "distracting"]]) {
    const r = resolveActivityCategory(lookup, { appName: app, pageTitle: "whatever", at: AT });
    assert.equal(r.category, expected);
    assert.equal(r.source, "app");
  }
});

test("browser time takes the category of the URL open at that moment", () => {
  const index = buildUrlIndex([urlRow("s1", "github.com", AT)]);
  const r = resolveActivityCategory(lookup, {
    appName: "Google Chrome",
    pageTitle: "Some repo",
    at: AT,
    sessionId: "s1",
    urlIndex: index,
  });
  assert.equal(r.category, "productive", "Chrome on github.com must read productive, not unclassified");
  assert.equal(r.source, "url");
  assert.equal(r.domain, "github.com");
});

test("the same browser resolves differently at different moments", () => {
  // The whole point: one Chrome row is not one category.
  const index = buildUrlIndex([
    urlRow("s1", "github.com", "2026-09-04T10:00:00.000Z"),
    urlRow("s1", "reddit.com", "2026-09-04T10:05:00.000Z"),
  ]);
  const base = { appName: "Google Chrome", pageTitle: "", sessionId: "s1", urlIndex: index };
  assert.equal(
    resolveActivityCategory(lookup, { ...base, at: "2026-09-04T10:00:05.000Z" }).category,
    "productive",
  );
  assert.equal(
    resolveActivityCategory(lookup, { ...base, at: "2026-09-04T10:05:05.000Z" }).category,
    "distracting",
  );
});

test("a URL row from a different session is never borrowed", () => {
  const index = buildUrlIndex([urlRow("other-session", "github.com", AT)]);
  const r = resolveActivityCategory(lookup, {
    appName: "Google Chrome",
    pageTitle: "",
    at: AT,
    sessionId: "s1",
    urlIndex: index,
  });
  assert.equal(r.source, "app", "must not match across sessions");
});

test("a URL far outside the tolerance window is not matched", () => {
  const index = buildUrlIndex([urlRow("s1", "github.com", "2026-09-04T09:00:00.000Z")]);
  const r = resolveActivityCategory(lookup, {
    appName: "Google Chrome",
    pageTitle: "",
    at: AT, // an hour later
    sessionId: "s1",
    urlIndex: index,
  });
  assert.equal(r.source, "app");
});

test("falls back to an http URL embedded in the window title", () => {
  const r = resolveActivityCategory(lookup, {
    appName: "Google Chrome",
    pageTitle: "Look at https://reddit.com/r/rust",
    at: AT,
    sessionId: "s1",
    urlIndex: new Map(),
  });
  assert.equal(r.category, "distracting");
  assert.equal(r.source, "title-url");
  assert.equal(r.domain, "reddit.com");
});

test("falls back to the site name a window title ends with", () => {
  const r = resolveActivityCategory(lookup, {
    appName: "Google Chrome",
    pageTitle: "vt/api - Pull requests | GitHub",
    at: AT,
    sessionId: "s1",
    urlIndex: new Map(),
  });
  assert.equal(r.category, "productive");
  assert.equal(r.source, "title-site");
});

test("with nothing knowable it falls back to the browser itself, not a guess", () => {
  const r = resolveActivityCategory(lookup, {
    appName: "Google Chrome",
    pageTitle: "New Tab",
    at: AT,
    sessionId: "s1",
    urlIndex: new Map(),
  });
  assert.equal(r.category, "unclassified");
  assert.equal(r.source, "app");
});

test("a hand-classified window title (no URL, no site name) is honoured", () => {
  const withTitle = (matchType, pattern) =>
    `${matchType}:${pattern}`.toLowerCase() === "window_title:lead submission form"
      ? "productive"
      : lookup(matchType, pattern);
  const r = resolveActivityCategory(withTitle, {
    appName: "Google Chrome",
    pageTitle: "Lead Submission Form",
    at: AT,
    sessionId: "s1",
    urlIndex: new Map(),
  });
  assert.equal(r.category, "productive");
  assert.equal(r.source, "title-window");
  assert.equal(r.domain, "Lead Submission Form");
});

test("an unclassified window title still falls back to the browser", () => {
  const r = resolveActivityCategory(lookup, {
    appName: "Google Chrome",
    pageTitle: "Lead Submission Form",
    at: AT,
    sessionId: "s1",
    urlIndex: new Map(),
  });
  assert.equal(r.source, "app");
});

test("a row's own domain wins over inference", () => {
  // Step 0 - what a screenshot will carry once the agent sends it.
  const index = buildUrlIndex([urlRow("s1", "reddit.com", AT)]);
  const r = resolveActivityCategory(lookup, {
    appName: "Google Chrome",
    pageTitle: "",
    at: AT,
    sessionId: "s1",
    urlIndex: index,
    domain: "github.com",
  });
  assert.equal(r.category, "productive");
  assert.equal(r.domain, "github.com");
});

test("adjacent slices attribute to the one that contains the timestamp", () => {
  // Regression: slices are back-to-back and the tolerance is as wide as a
  // slice, so a purely nearest-match lookup picked the NEXT interval and
  // shifted a member's entire day's attribution by one slice. Containment
  // has to win. 8 slices, every 4th is reddit -> 6 github, 2 reddit.
  const base = Date.parse("2026-09-04T09:00:00.000Z");
  const rows = [];
  const apps = [];
  for (let i = 0; i < 8; i++) {
    const at = new Date(base + i * 15_000).toISOString();
    rows.push(urlRow("s1", i % 4 === 3 ? "reddit.com" : "github.com", at, 15));
    apps.push(at);
  }
  const index = buildUrlIndex(rows);
  const seconds = { productive: 0, distracting: 0, neutral: 0, unclassified: 0 };
  for (const at of apps) {
    const r = resolveActivityCategory(lookup, {
      appName: "Google Chrome",
      pageTitle: "",
      at,
      sessionId: "s1",
      urlIndex: index,
    });
    seconds[r.category] += 15;
  }
  assert.equal(seconds.productive, 90, "6 github slices x 15s");
  assert.equal(seconds.distracting, 30, "2 reddit slices x 15s");
});

test("index build tolerates junk rows without throwing", () => {
  const index = buildUrlIndex([
    { session_id: "", domain: "github.com", visited_at: AT },
    { session_id: "s1", domain: "", visited_at: AT },
    { session_id: "s1", domain: "github.com", visited_at: "not-a-date" },
    null,
  ]);
  assert.equal(index.get("s1"), undefined);
});

test("scales without a quadratic scan: 500 url rows x 500 lookups", () => {
  // §1.5 M4 - the naive `.find()` inside a `.map()` would be O(n*m) here.
  const base = Date.parse("2026-09-04T08:00:00.000Z");
  const rows = [];
  for (let i = 0; i < 500; i++) {
    rows.push(urlRow("s1", i % 2 ? "github.com" : "reddit.com", new Date(base + i * 20_000).toISOString()));
  }
  const index = buildUrlIndex(rows);
  const started = Date.now();
  let productive = 0;
  for (let i = 0; i < 500; i++) {
    const at = new Date(base + i * 20_000 + 1000).toISOString();
    const r = resolveActivityCategory(lookup, {
      appName: "Google Chrome",
      pageTitle: "",
      at,
      sessionId: "s1",
      urlIndex: index,
    });
    if (r.category === "productive") productive++;
  }
  assert.equal(productive, 250, "every other row is github.com");
  assert.ok(Date.now() - started < 1000, "500x500 must not take a second");
});
