// The gate that decides whether an agent is offered an update at all
// (PLAN-notifications-and-owner-messaging.md Part C3).
//
// Getting this wrong is expensive in both directions: too low and agents that
// cannot survive an update are handed one anyway, which is the failure this
// exists to stop; too high and healthy agents silently stop receiving updates.
import test from "node:test";
import assert from "node:assert/strict";
import { canSelfUpdate, compareVersions, hasNewerVersion, selectPlatformEntry } from "../src/modules/update/update-routes.js";

test("versions compare numerically, not as text", () => {
  // The bug a string compare would produce: "1.0.9" > "1.0.10".
  assert.ok(compareVersions("1.0.10", "1.0.9") > 0);
  assert.ok(compareVersions("1.0.9", "1.0.10") < 0);
  assert.equal(compareVersions("1.0.27", "1.0.27"), 0);
  assert.ok(compareVersions("2.0.0", "1.9.9") > 0);
  assert.ok(compareVersions("v1.0.27", "1.0.27") === 0, "a leading v is tolerated");
  assert.ok(compareVersions("1.0.27-beta.1", "1.0.27") === 0, "pre-release suffixes are ignored");
});

test("agents that cannot survive an update are not offered one", () => {
  for (const old of ["1.0.0", "1.0.22", "1.0.25", "1.0.26"]) {
    assert.equal(canSelfUpdate(old), false, `${old} must not be served an update`);
  }
});

test("agents from the fixed version onward update normally", () => {
  for (const ok of ["1.0.27", "1.0.28", "1.0.30", "1.1.0", "2.0.0"]) {
    assert.equal(canSelfUpdate(ok), true, `${ok} must be served updates`);
  }
});

test("an unreadable version is treated as too old, not assumed safe", () => {
  for (const bad of ["", "unknown", "abc", null, undefined]) {
    assert.equal(canSelfUpdate(bad), false, `${String(bad)} must not be served an update`);
  }
});

// The feed used to answer 200 with the agent's own version, so every agent
// fetched a manifest describing the build it was already running. The updater
// compares versions itself and ignored it, so nothing broke - it just sent a
// payload and a signature on every check, from every agent, to say nothing.
test("an agent already on the newest version is offered nothing", () => {
  assert.equal(hasNewerVersion("1.0.28", "1.0.28"), false);
});

test("an older agent is still offered the update", () => {
  assert.equal(hasNewerVersion("1.0.27", "1.0.28"), true);
  assert.equal(hasNewerVersion("1.0.9", "1.0.28"), true, "numeric compare, not lexical");
});

test("an agent ahead of the feed is offered nothing rather than downgraded", () => {
  // A rolled-back release would otherwise hand a newer agent an older build.
  assert.equal(hasNewerVersion("1.1.0", "1.0.28"), false);
});

test("an unreadable current version is treated as old, so it still gets the update", () => {
  // Matches compareVersions' own rule: unparseable sorts lowest. An agent
  // that cannot state its version is the one most worth updating.
  assert.equal(hasNewerVersion("garbage", "1.0.28"), true);
});

// The download page serves the NSIS .exe; the manifest's bare windows key
// aliases the .msi. So every Windows member installed one installer format
// and auto-updated into the other - which register separately (NSIS under
// the product name, MSI under a GUID), leaving two Apps & Features entries,
// two startup entries, and an update that carries none of the NSIS
// installer hooks.
const WINDOWS_MANIFEST = {
  "windows-x86_64": { url: "https://x/app.msi", signature: "msi-sig" },
  "windows-x86_64-msi": { url: "https://x/app.msi", signature: "msi-sig" },
  "windows-x86_64-nsis": { url: "https://x/app.exe", signature: "nsis-sig" },
};

test("a Windows agent is offered the NSIS installer, matching what it downloaded", () => {
  const entry = selectPlatformEntry(WINDOWS_MANIFEST, "windows", "x86_64");
  assert.equal(entry.url, "https://x/app.exe");
  assert.equal(entry.signature, "nsis-sig", "the signature must belong to the artifact being served");
});

test("a manifest with only the bare Windows key still resolves", () => {
  // Older releases, and any bundler change that stops emitting the variants.
  const entry = selectPlatformEntry({ "windows-x86_64": { url: "https://x/app.exe" } }, "windows", "x86_64");
  assert.equal(entry.url, "https://x/app.exe");
});

test("other platforms are untouched by the Windows preference", () => {
  const platforms = { "darwin-aarch64": { url: "https://x/app.tar.gz" } };
  assert.equal(selectPlatformEntry(platforms, "darwin", "aarch64").url, "https://x/app.tar.gz");
  assert.equal(selectPlatformEntry(platforms, "linux", "x86_64"), null);
});

test("an absent platform map does not throw", () => {
  assert.equal(selectPlatformEntry(undefined, "windows", "x86_64"), null);
});
