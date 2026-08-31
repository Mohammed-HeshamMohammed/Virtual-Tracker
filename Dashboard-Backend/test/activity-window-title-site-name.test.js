// Guards the URLs feed's fallback path when the address bar can't be read:
// the only signal left is the browser window's own title (already saved in
// full, on every row), and siteNameFromWindowTitle is what turns "717 W
// Russell St, Philadelphia, PA 19140 | Realtor.com®" into a real,
// classifiable site name instead of every row reading as the bare browser
// name. See activity/routes.js's ingestAppUrlRow for where this promotes a
// row from sourceKind "window" to "url".
import test from "node:test";
import assert from "node:assert/strict";
import { siteNameFromWindowTitle, titleFromBrowserPageTitle } from "../src/modules/activity/routes.js";

test("a pipe-separated site name at the end of the title is extracted", () => {
  assert.equal(
    siteNameFromWindowTitle("717 W Russell St, Philadelphia, PA 19140 | Realtor.com®"),
    "Realtor.com",
    "trailing registered-trademark mark is stripped so repeat visits match the same pattern",
  );
});

test("a pipe-separated product/service name (not a literal domain) is still extracted", () => {
  assert.equal(siteNameFromWindowTitle("Virtual-Tracker > Deployments | Coolify"), "Coolify");
});

test("falls back through separators in priority order: pipe, em dash, then hyphen", () => {
  assert.equal(siteNameFromWindowTitle("Some Article — The Verge"), "The Verge");
  assert.equal(siteNameFromWindowTitle("How to fix a TypeError - Stack Overflow"), "Stack Overflow");
});

test("a title with no separator at all yields nothing - the browser name stays the fallback", () => {
  assert.equal(siteNameFromWindowTitle("New Tab"), "");
  assert.equal(siteNameFromWindowTitle(""), "");
});

test("a trailing segment that is too short or has no letters is rejected as noise, not a site", () => {
  assert.equal(siteNameFromWindowTitle("Report Q3 - 1"), "", "a bare number is not a site name");
  assert.equal(siteNameFromWindowTitle("Draft - a"), "", "a single character is too short to trust");
});

test("titleFromBrowserPageTitle still only strips the browser's own trailing suffix", () => {
  // The site-name segment (" | Realtor.com®") is left in place here on
  // purpose - stripping *that* is siteNameFromWindowTitle's job, called
  // separately by the caller, not this function's.
  assert.equal(
    titleFromBrowserPageTitle("717 W Russell St, Philadelphia, PA 19140 | Realtor.com® - Google Chrome", "Google Chrome"),
    "717 W Russell St, Philadelphia, PA 19140 | Realtor.com®",
  );
});
