import test from "node:test";
import assert from "node:assert/strict";
import { selectLatestAgentRelease } from "../src/modules/download/download-routes.js";

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
