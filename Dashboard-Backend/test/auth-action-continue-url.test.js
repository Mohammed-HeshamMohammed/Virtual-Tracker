import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// action.html is the static page an email-verification link opens. Its inline script reads
// continueUrl off the query string and puts it on the page's button. Before this was fixed the
// error paths passed it through raw, so `?continueUrl=javascript:...` ran on click and
// `?continueUrl=https://evil.example` turned the verification page into an open redirect.
//
// These run the page's own script - the whole inline block, as a browser would - against a small
// stand-in for the four elements it touches, window.location and the Firebase SDK, and check where
// the button and the redirect actually point.

const here = dirname(fileURLToPath(import.meta.url));
const ACTION_HTML = join(here, "..", "hosting-public", "__", "auth", "action.html");
const ORIGIN = "https://app.example.com";

const html = readFileSync(ACTION_HTML, "utf8");
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
assert.equal(inlineScripts.length, 1, "action.html has one inline script");

function element() {
  const classes = new Set();
  return {
    textContent: "",
    innerHTML: "",
    href: "",
    className: "",
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) },
  };
}

/**
 * Opens the page at `?query` and lets it settle. `verify` stands in for Firebase's
 * applyActionCode: a function returning a promise.
 */
async function openPage(query, verify = () => Promise.resolve()) {
  const els = { title: element(), message: element(), "status-icon": element(), "action-btn": element() };
  const replaced = [];
  const url = new URL(`${ORIGIN}/__/auth/action?${query}`);
  const window = {
    location: { search: url.search, origin: ORIGIN, hostname: url.hostname, replace: (to) => replaced.push(to) },
    setTimeout: (fn) => fn(),
  };
  const firebase = { initializeApp: () => {}, auth: () => ({ applyActionCode: verify }) };
  runInNewContext(inlineScripts[0], {
    window,
    document: { getElementById: (id) => els[id] },
    firebase,
    URL,
    URLSearchParams,
  });
  await new Promise((r) => setImmediate(r));
  const btn = els["action-btn"];
  return { title: els.title.textContent, href: btn.href, shown: !btn.classList.has("hidden"), replaced };
}

// An unsupported link shows "Back to sign in" pointing wherever continueUrl was made safe to.
const backTo = async (continueUrl) =>
  (await openPage(`mode=resetPassword&continueUrl=${encodeURIComponent(continueUrl)}`)).href;

test("a javascript:, data: or vbscript: continueUrl never reaches the button", async () => {
  for (const evil of ["javascript:alert(document.cookie)", "JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)"]) {
    assert.equal(await backTo(evil), "/", evil);
  }
});

test("the button never leads off-origin: only the path of a foreign URL is kept", async () => {
  assert.equal(await backTo("https://evil.example/login"), "/login");
  assert.equal(await backTo("//evil.example/login"), "/login");
  assert.equal(await backTo("https://evil.example"), "/");
  // A non-web scheme whose "path" starts with // would come out as a protocol-relative link to
  // another site; only http(s) URLs are trusted to have a real path.
  assert.equal(await backTo("javascript://evil.example/x"), "/");
});

test("a same-origin destination is kept as it was", async () => {
  assert.equal(await backTo("/dashboard?tab=1"), "/dashboard?tab=1");
  assert.equal(await backTo("/sign-in#top"), "/sign-in#top");
  assert.equal(await backTo(`${ORIGIN}/sign-in?next=1`), "/sign-in?next=1");
});

test("every error path launders it: an incomplete link and a failed verification", async () => {
  const incomplete = await openPage(`mode=verifyEmail&continueUrl=${encodeURIComponent("javascript:alert(1)")}`);
  assert.equal(incomplete.title, "Invalid link");
  assert.equal(incomplete.href, "/");
  const failed = await openPage(
    `mode=verifyEmail&oobCode=abc&apiKey=key&continueUrl=${encodeURIComponent("https://evil.example/x")}`,
    () => Promise.reject(Object.assign(new Error("expired"), { code: "auth/expired-action-code" })),
  );
  assert.equal(failed.title, "Try verifying your email again");
  assert.equal(failed.shown, true);
  assert.equal(failed.href, "/x");
  assert.deepEqual(failed.replaced, [], "a failure never redirects");
});

test("a verified email continues to the same-origin path, marked verified, and nowhere else", async () => {
  const ok = await openPage(`mode=verifyEmail&oobCode=abc&apiKey=key&continueUrl=${encodeURIComponent("https://evil.example/welcome?x=1")}`);
  assert.equal(ok.title, "Email verified");
  assert.equal(ok.href, "/welcome?x=1&emailVerified=1");
  assert.deepEqual(ok.replaced, ["/welcome?x=1&emailVerified=1"]);
  const none = await openPage("mode=verifyEmail&oobCode=abc&apiKey=key");
  assert.deepEqual(none.replaced, ["/?emailVerified=1"]);
});

// Kept as a meta-guard rather than a behaviour test: the same file is served by both services, and
// a fix applied to one and not the other leaves the hole open on the other origin - which is how
// this one survived (four alerts, two files, one bug). Only a comparison of the two files can say
// they have not drifted apart.
test("Auth-Backend's copy stays byte-identical", () => {
  const authCopy = join(here, "..", "..", "Auth-Backend", "hosting-public", "__", "auth", "action.html");
  assert.equal(
    readFileSync(authCopy, "utf8"),
    html,
    "Auth-Backend/hosting-public/__/auth/action.html has drifted from Dashboard-Backend's copy",
  );
});
