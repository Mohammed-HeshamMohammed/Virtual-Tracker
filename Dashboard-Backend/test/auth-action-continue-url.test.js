import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// action.html is a static page served straight to browsers, so its script is
// an inline IIFE with nothing to import. Extracting safeInternalPath from the
// source and exercising it here is the same trick types.rs already uses to
// pin a rule that only exists inside a file - and it doubles as a guard that
// the function is still there at all.
//
// What it protects: continueUrl is read from the query string and used as the
// action button's href. Before this, the three error paths passed it through
// raw, so `?continueUrl=javascript:...` executed on click and
// `?continueUrl=https://evil.example` turned the verification page into an
// open redirect.

const here = dirname(fileURLToPath(import.meta.url));
const ACTION_HTML = join(here, "..", "hosting-public", "__", "auth", "action.html");

function loadSafeInternalPath(origin = "https://app.example.com") {
  const source = readFileSync(ACTION_HTML, "utf8");
  const start = source.indexOf("function safeInternalPath");
  assert.notEqual(start, -1, "safeInternalPath must exist in action.html");
  // Function body ends at the first line that closes it at the original indent.
  const end = source.indexOf("\n        }", start);
  assert.notEqual(end, -1, "safeInternalPath must be closed");
  const fnSource = source.slice(start, end + "\n        }".length);

  const factory = new Function("window", `${fnSource}; return safeInternalPath;`);
  return factory({ location: { origin } });
}

test("rejects javascript: URLs - the XSS case", () => {
  const safeInternalPath = loadSafeInternalPath();
  assert.equal(safeInternalPath("javascript:alert(document.cookie)"), "/");
  assert.equal(safeInternalPath("JavaScript:alert(1)"), "/");
});

test("rejects data: and vbscript: URLs", () => {
  const safeInternalPath = loadSafeInternalPath();
  assert.equal(safeInternalPath("data:text/html,<script>alert(1)</script>"), "/");
  assert.equal(safeInternalPath("vbscript:msgbox(1)"), "/");
});

test("never redirects off-origin - the open-redirect case", () => {
  const safeInternalPath = loadSafeInternalPath();
  // Path is kept, origin is discarded: the result can only ever be relative.
  assert.equal(safeInternalPath("https://evil.example/login"), "/login");
  assert.equal(safeInternalPath("//evil.example/login"), "/login");
  assert.equal(safeInternalPath("https://evil.example"), "/");
});

test("preserves a legitimate same-origin destination", () => {
  const safeInternalPath = loadSafeInternalPath();
  assert.equal(safeInternalPath("/dashboard?tab=1"), "/dashboard?tab=1");
  assert.equal(safeInternalPath("/sign-in#top"), "/sign-in#top");
  assert.equal(
    safeInternalPath("https://app.example.com/sign-in?next=1"),
    "/sign-in?next=1",
  );
});

test("falls back for empty or unparseable input", () => {
  const safeInternalPath = loadSafeInternalPath();
  assert.equal(safeInternalPath(""), "/");
  assert.equal(safeInternalPath(null), "/");
  assert.equal(safeInternalPath(undefined), "/");
  assert.equal(safeInternalPath("", "/?emailVerified=1"), "/?emailVerified=1");
});

test("the raw continueUrl never reaches actionBtn.href", () => {
  const source = readFileSync(ACTION_HTML, "utf8");
  // Every showState call site must launder it. `continueUrl || "/"` was the
  // vulnerable form - if it reappears, this fails.
  assert.equal(
    source.includes('continueUrl || "/"'),
    false,
    'raw `continueUrl || "/"` must not be passed to showState - use safeInternalPath()',
  );
});

test("Auth-Backend's copy stays byte-identical", () => {
  const dashboard = readFileSync(ACTION_HTML, "utf8");
  const authCopy = join(here, "..", "..", "Auth-Backend", "hosting-public", "__", "auth", "action.html");
  // The same file is served by both services. A fix applied to one and not
  // the other leaves the vulnerability live on the other origin, which is
  // exactly how this one survived: four alerts, two files, one bug.
  assert.equal(
    readFileSync(authCopy, "utf8"),
    dashboard,
    "Auth-Backend/hosting-public/__/auth/action.html has drifted from Dashboard-Backend's copy",
  );
});
