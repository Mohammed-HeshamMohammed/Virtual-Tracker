// The agent's build for Windows 7, 8 and 8.1 (Tauri-App-Extension/PLAN-windows-7-legacy-build.md).
//
// Two things must never happen: a normal download handing out the legacy installer, and a
// member on old Windows being handed the normal one, which cannot start there.
import test from "node:test";
import assert from "node:assert/strict";
import { findAsset, isLegacyWindowsPlatform, wantsLegacyWindows } from "../src/modules/download/download-routes.js";
import { LEGACY_MANIFEST, LEGACY_TARGET, manifestNameFor, selectPlatformEntry } from "../src/modules/update/update-routes.js";

const assets = [
  { name: "latest.json" },
  { name: "latest-legacy.json" },
  { name: "My-Virtual-Tracker_v1.1.12_windows-legacy_x86-setup.exe" },
  { name: "My-Virtual-Tracker_v1.1.12_windows-legacy_x86-setup.exe.sig" },
  { name: "My-Virtual-Tracker_v1.1.12_windows_x64-setup.exe" },
  { name: "My-Virtual-Tracker_v1.1.12_windows_x64-setup.exe.sig" },
  { name: "My-Virtual-Tracker_v1.1.12_windows_x64_en-US.msi" },
];

test("a normal Windows download never hands out the legacy installer", () => {
  // Listed first on purpose: "the first .exe" used to be the whole rule.
  assert.equal(findAsset(assets, "windows")?.name, "My-Virtual-Tracker_v1.1.12_windows_x64-setup.exe");
  assert.equal(findAsset(assets, "exe")?.name, "My-Virtual-Tracker_v1.1.12_windows_x64-setup.exe");
});

test("the legacy download is only ever the legacy installer", () => {
  assert.equal(findAsset(assets, "windows-legacy")?.name, "My-Virtual-Tracker_v1.1.12_windows-legacy_x86-setup.exe");
  const withoutLegacy = assets.filter((asset) => !/windows-legacy/.test(asset.name));
  assert.equal(findAsset(withoutLegacy, "windows-legacy"), null, "no legacy build published means none, not the normal one");
});

test("the legacy platform has a few names", () => {
  for (const name of ["windows-legacy", "Windows-Legacy", "win7", "win8", "legacy"]) assert.equal(isLegacyWindowsPlatform(name), true, name);
  for (const name of ["windows", "win", "exe", "mac", ""]) assert.equal(isLegacyWindowsPlatform(name), false, name);
});

test("Firefox on Windows 7, 8 and 8.1 is recognised by the version it reports", () => {
  for (const nt of ["6.1", "6.2", "6.3"]) {
    assert.equal(wantsLegacyWindows(`Mozilla/5.0 (Windows NT ${nt}; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0`), true, nt);
  }
  assert.equal(wantsLegacyWindows("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0"), false);
});

test("Chrome, Brave and Edge at 109 or below on Windows are taken to be old Windows", () => {
  // Since Chrome 107 every Chromium browser says Windows NT 10.0, so the browser version decides.
  const chrome = (major) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  assert.equal(wantsLegacyWindows(chrome(109)), true);
  assert.equal(wantsLegacyWindows(chrome(105)), true);
  assert.equal(wantsLegacyWindows(`${chrome(109)} Edg/109.0.1518.140`), true);
  assert.equal(wantsLegacyWindows(chrome(110)), false);
  assert.equal(wantsLegacyWindows(chrome(131)), false);
});

test("nothing that is not Windows is ever taken for old Windows", () => {
  assert.equal(wantsLegacyWindows("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36"), false);
  assert.equal(wantsLegacyWindows("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.0.0 Safari/537.36"), false);
  assert.equal(wantsLegacyWindows(""), false);
  assert.equal(wantsLegacyWindows(undefined), false);
});

test("legacy agents are answered from their own manifest, everyone else from latest.json", () => {
  assert.equal(manifestNameFor(LEGACY_TARGET), LEGACY_MANIFEST);
  assert.equal(manifestNameFor("windows"), "latest.json");
  assert.equal(manifestNameFor("darwin"), "latest.json");
});

test("a legacy manifest entry is found by the legacy agent's target and architecture", () => {
  const legacy = { "windows-legacy-i686": { url: "https://example/legacy.exe", signature: "sig" } };
  assert.equal(selectPlatformEntry(legacy, LEGACY_TARGET, "i686")?.url, "https://example/legacy.exe");
  assert.equal(selectPlatformEntry(legacy, LEGACY_TARGET, "x86_64"), null);
  // And a normal manifest has nothing a legacy agent could pick up.
  const normal = { "windows-x86_64-nsis": { url: "https://example/normal.exe", signature: "sig" } };
  assert.equal(selectPlatformEntry(normal, LEGACY_TARGET, "i686"), null);
});
