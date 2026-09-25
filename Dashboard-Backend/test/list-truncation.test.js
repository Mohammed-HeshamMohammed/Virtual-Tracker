// Large lists are capped and returned as plain arrays, so an organization past
// the cap saw a short list with nothing saying so - it presents as "a member is
// missing from the dashboard" rather than as an error.
import test from "node:test";
import assert from "node:assert/strict";
import { listMeta } from "../src/http/list-truncation.js";

const rows = (n) => Array.from({ length: n }, (_, i) => ({ i }));

test("a page under the cap is not truncated and never counts", async () => {
  let counted = false;
  const meta = await listMeta(rows(12), 500, async () => {
    counted = true;
    return 12;
  });
  assert.equal(meta.truncated, false);
  assert.equal(meta.total, 12);
  assert.equal(counted, false, "the normal case must not pay for a count");
});

test("a full page with more behind it reports the real total", async () => {
  const meta = await listMeta(rows(500), 500, async () => 612);
  assert.equal(meta.truncated, true);
  assert.equal(meta.returned, 500);
  assert.equal(meta.total, 612);
});

test("a full page that happens to be the whole set is not truncated", async () => {
  const meta = await listMeta(rows(500), 500, async () => 500);
  assert.equal(meta.truncated, false);
  assert.equal(meta.total, 500);
});

test("a failed count leaves the list usable rather than failing it", async () => {
  const meta = await listMeta(rows(500), 500, async () => {
    throw new Error("count failed");
  });
  assert.equal(meta.returned, 500);
  assert.equal(meta.truncated, false, "without a count there is nothing to claim");
});

test("a count smaller than the page is ignored rather than trusted", async () => {
  // Rows can be added or removed between the two queries; a total below what
  // was actually returned is nonsense and must not become a negative remainder.
  const meta = await listMeta(rows(500), 500, async () => 3);
  assert.equal(meta.total, 500);
  assert.equal(meta.truncated, false);
});

test("a non-array is handled rather than throwing", async () => {
  const meta = await listMeta(null, 500, async () => 0);
  assert.equal(meta.returned, 0);
  assert.equal(meta.truncated, false);
});
