import sharp from "sharp";

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

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
