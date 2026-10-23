// The Activity feed takes several members and a project filter, and carries
// profile photos: the member scope is a list the viewer must be allowed to see
// every entry of, projects are held to the ones the viewer can reach, and the
// photo comes from the profile rather than the (often empty) members.avatar_url.
// The parsing is pinned here; the scope and photo rules are run through the real
// feed handler in activity-feed-scope.pglite.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { parseMemberIdFilter, memberOptionsFromMeta } from "../src/modules/activity/activity-scope.js";
import { parseFeedProjectIds } from "../src/modules/activity/routes.js";

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
