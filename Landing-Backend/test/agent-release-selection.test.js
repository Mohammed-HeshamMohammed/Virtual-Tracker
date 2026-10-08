import test from "node:test";
import assert from "node:assert/strict";
import { findAsset, pickMacDmg, selectLatestAgentRelease } from "../src/modules/download/download-routes.js";

test("the download and updater feeds ignore unrelated repository releases", () => {
  const releases = [
    { id: 3, tag_name: "dashboard-v9.0.0", draft: false, prerelease: false },
    { id: 2, tag_name: "agent-v1.1.2", draft: false, prerelease: false },
    { id: 1, tag_name: "agent-v1.1.1", draft: false, prerelease: false },
  ];
  assert.equal(selectLatestAgentRelease(releases)?.id, 2);
});

test("drafts and prereleases never become the production agent feed", () => {
  const releases = [
    { id: 4, tag_name: "agent-v2.0.0", draft: true, prerelease: false },
    { id: 3, tag_name: "agent-v1.2.0-beta.1", draft: false, prerelease: true },
    { id: 2, tag_name: "agent-v1.1.2", draft: false, prerelease: false },
  ];
  assert.equal(selectLatestAgentRelease(releases)?.id, 2);
  assert.equal(selectLatestAgentRelease([{ id: 1, tag_name: "dashboard-v1.0.0" }]), null);
});

test("the highest version wins even when GitHub lists an older release first", () => {
  // The real shape of the bug: a release that was deleted and recreated sorted above the newer
  // one, so the feed kept serving 1.1.9 after 1.1.10 was published.
  const releases = [
    { id: 9, tag_name: "agent-v1.1.9", draft: false, prerelease: false },
    { id: 10, tag_name: "agent-v1.1.10", draft: false, prerelease: false },
    { id: 8, tag_name: "agent-v1.1.8", draft: false, prerelease: false },
  ];
  assert.equal(selectLatestAgentRelease(releases)?.id, 10, "1.1.10 is newer than 1.1.9 - numerically, not as text");
});

test("versions compare number by number across major, minor and patch", () => {
  const pick = (...tags) =>
    selectLatestAgentRelease(tags.map((tag_name, id) => ({ id, tag_name, draft: false, prerelease: false })))?.tag_name;
  assert.equal(pick("agent-v1.9.0", "agent-v1.10.0", "agent-v1.2.30"), "agent-v1.10.0");
  assert.equal(pick("agent-v2.0.0", "agent-v1.99.99"), "agent-v2.0.0");
  assert.equal(pick("agent-v1.1.1", "agent-v1.1.1"), "agent-v1.1.1");
});

// An Intel Mac was handed the Apple Silicon .dmg (it was listed first) and told "this
// application is not supported on this Mac".
const MAC_ASSETS = [
  { name: "My-Virtual-Tracker_v1.1.9_darwin_aarch64.app.tar.gz" },
  { name: "My-Virtual-Tracker_v1.1.9_darwin_aarch64.dmg" },
  { name: "My-Virtual-Tracker_v1.1.9_darwin_x64.app.tar.gz" },
  { name: "My-Virtual-Tracker_v1.1.9_darwin_x64.dmg" },
  { name: "My-Virtual-Tracker_v1.1.9_windows_x64.exe" },
];

test("a Mac with no architecture given gets the Intel build, which runs on both kinds of Mac", () => {
  assert.equal(pickMacDmg(MAC_ASSETS, "").name, "My-Virtual-Tracker_v1.1.9_darwin_x64.dmg");
  assert.equal(findAsset(MAC_ASSETS, "mac", "").name, "My-Virtual-Tracker_v1.1.9_darwin_x64.dmg");
});

test("an Apple Silicon Mac asking for it gets the native build, and Intel asking gets Intel", () => {
  for (const arch of ["arm64", "aarch64", "apple", "M1"]) {
    assert.equal(pickMacDmg(MAC_ASSETS, arch).name, "My-Virtual-Tracker_v1.1.9_darwin_aarch64.dmg", arch);
  }
  for (const arch of ["x64", "x86_64", "intel"]) {
    assert.equal(pickMacDmg(MAC_ASSETS, arch).name, "My-Virtual-Tracker_v1.1.9_darwin_x64.dmg", arch);
  }
  assert.equal(findAsset(MAC_ASSETS, "macos", "", "arm64").name, "My-Virtual-Tracker_v1.1.9_darwin_aarch64.dmg");
});

test("a release with a single .dmg still serves it, and none falls back to the archive", () => {
  assert.equal(pickMacDmg([{ name: "App_universal.dmg" }], "arm64").name, "App_universal.dmg");
  assert.equal(pickMacDmg([{ name: "x.exe" }], "arm64"), null);
  assert.equal(
    findAsset([{ name: "App_darwin_x64.app.tar.gz" }], "mac", "").name,
    "App_darwin_x64.app.tar.gz",
  );
});
