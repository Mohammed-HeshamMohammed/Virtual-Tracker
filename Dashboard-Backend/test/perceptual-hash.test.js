// Guards AC-2's dHash utility: identical content must hash identically, a
// clearly different image must hash far apart, and a missing hash must never
// be treated as "same image" (that would falsely flag staleness for a
// screenshot that simply failed to hash).
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { computeDHash, hammingDistance } from "../src/modules/activity/perceptual-hash.js";

/** A horizontal grayscale gradient PNG, ascending or descending left-to-right. */
function gradientPng(width, height, ascending) {
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const raw = Math.floor((x / (width - 1)) * 255);
      const value = ascending ? raw : 255 - raw;
      const idx = (y * width + x) * channels;
      buf[idx] = value;
      buf[idx + 1] = value;
      buf[idx + 2] = value;
    }
  }
  return sharp(buf, { raw: { width, height, channels } }).png().toBuffer();
}

test("the same image hashes identically every time", async () => {
  const png = await gradientPng(32, 32, true);
  const a = await computeDHash(png);
  const b = await computeDHash(png);
  assert.equal(a, b);
  assert.equal(hammingDistance(a, b), 0);
});

test("opposite gradients hash far apart, not near-identical", async () => {
  const ascending = await computeDHash(await gradientPng(32, 32, true));
  const descending = await computeDHash(await gradientPng(32, 32, false));
  const distance = hammingDistance(ascending, descending);
  assert(distance > 32, `expected opposite gradients to differ in most of 64 bits, got ${distance}`);
});

test("a missing hash on either side is infinitely different, never treated as a match", () => {
  assert.equal(hammingDistance(null, "abcdef0123456789"), Infinity);
  assert.equal(hammingDistance("abcdef0123456789", undefined), Infinity);
  assert.equal(hammingDistance(null, null), Infinity);
});

test("hammingDistance counts differing bits exactly", () => {
  assert.equal(hammingDistance("0000000000000000", "0000000000000001"), 1);
  assert.equal(hammingDistance("ffffffffffffffff", "0000000000000000"), 64);
  assert.equal(hammingDistance("abcdef0123456789", "abcdef0123456789"), 0);
});

test("computeDHash always returns a 16-hex-char string", async () => {
  const hash = await computeDHash(await gradientPng(10, 10, true));
  assert.match(hash, /^[0-9a-f]{16}$/);
});
