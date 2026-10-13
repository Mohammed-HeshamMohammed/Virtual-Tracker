// The Activity feed takes several members and a project filter, and carries
// profile photos: the member scope is a list the viewer must be allowed to see
// every entry of, projects are held to the ones the viewer can reach, and the
// photo comes from the profile rather than the (often empty) members.avatar_url.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMemberIdFilter, memberOptionsFromMeta } from "../src/modules/activity/activity-scope.js";
import { parseFeedProjectIds } from "../src/modules/activity/routes.js";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

test("the member filter is all, one id, or a comma-separated list", () => {
  for (const all of ["", "all", " all ", undefined, null, ",,", `${A},all`]) assert.deepEqual(parseMemberIdFilter(all), [], String(all));
  assert.deepEqual(parseMemberIdFilter(A), [A]);
  assert.deepEqual(parseMemberIdFilter(` ${A} , ${B} ,${A}`), [A, B], "trimmed and de-duplicated");
});

test("the project filter keeps only well-formed ids", () => {
  assert.deepEqual(parseFeedProjectIds(`${A}, nonsense ,${B},'; drop table projects;--`), [A, B]);
  assert.deepEqual(parseFeedProjectIds(""), []);
  assert.deepEqual(parseFeedProjectIds(null), []);
});

test("member options carry the photo, or null when there is none", () => {
  const meta = new Map([
    [A, { name: "Ada", initials: "A", avatarUrl: "https://cdn.example.com/a.jpg" }],
    [B, { name: "Bob", initials: "B" }],
  ]);
  const options = memberOptionsFromMeta([A, B], meta, A);
  assert.deepEqual(options.map((o) => o.avatarUrl), ["https://cdn.example.com/a.jpg", null]);
  assert.equal(memberOptionsFromMeta(null, meta, A)[0].avatarUrl, "https://cdn.example.com/a.jpg");
});

test("every member asked for must be one the viewer may see, or the feed is refused", () => {
  const src = read("src/modules/activity/activity-scope.js");
  assert.match(src, /requestedMemberIds\.some\(\(id\) => !allowedMemberIds\.includes\(id\)\)/);
  assert.match(src, /targetMemberIds = requestedMemberIds/);
});

test("the feed's project filter is held to the viewer's reachable projects and never widens to 'no filter'", () => {
  const src = read("src/modules/activity/routes.js");
  assert.match(src, /const permitted = reachable === null \? requestedProjectIds : requestedProjectIds\.filter\(\(id\) => reachable\.has\(id\)\)/);
  assert.match(src, /feedProjectIds = permitted\.length > 0 \? permitted : \[\]/);
  assert.match(src, /feedProjectIds \? \{ projectIds: feedProjectIds \} : \{\}/);
  for (const name of ["fetchPgAppLogs", "fetchPgUrlLogs"]) {
    assert.match(src, new RegExp(`${name}\\(scope\\.targetMemberIds, dayFilter, 500, feedOptions\\)`));
  }
});

test("feed rows and the member list take their photos from the profile", () => {
  const src = read("src/modules/activity/routes.js");
  assert.match(src, /const memberMeta = await buildMemberMetaMapWithPhotos\(/);
  assert.match(src, /await buildMemberMetaMapWithPhotos\(db, rowMemberIds\)/);
});
