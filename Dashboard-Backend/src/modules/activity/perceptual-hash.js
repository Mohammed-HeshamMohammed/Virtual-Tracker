import sharp from "sharp";

// One extra column so every pixel has a right-hand neighbor to compare against.
const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

/**
 * AC-2: classic dHash (difference hash) of an image's on-screen content.
 * Shrinks to a tiny grayscale thumbnail and records which way brightness
 * changes between horizontally adjacent pixels - a static or near-static
 * screen recaptured seconds later collapses to the same or a near-identical
 * hash, while real on-screen change does not. This is what the integrity
 * sweep's screenshot-staleness check compares between consecutive captures.
 * @param {Buffer} imageBuffer
 * @returns {Promise<string>} 16-hex-char (64-bit) hash
 */
export async function computeDHash(imageBuffer) {
  const { data } = await sharp(imageBuffer)
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  for (let row = 0; row < HASH_HEIGHT; row++) {
    for (let col = 0; col < HASH_WIDTH - 1; col++) {
      const left = data[row * HASH_WIDTH + col];
      const right = data[row * HASH_WIDTH + col + 1];
      hash = (hash << 1n) | (left < right ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Number of differing bits between two dHash hex strings (0-64, 0 =
 * identical). `Infinity` when either side has no hash yet - missing signal
 * must never be treated as "same image", which would falsely flag staleness.
 * @param {string | null | undefined} hashHexA
 * @param {string | null | undefined} hashHexB
 */
export function hammingDistance(hashHexA, hashHexB) {
  if (!hashHexA || !hashHexB) return Infinity;
  let xor = BigInt(`0x${hashHexA}`) ^ BigInt(`0x${hashHexB}`);
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}
