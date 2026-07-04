/** Maximum JSON body size accepted by the API (256 KiB — form submissions only). */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {number} [maxBytes]
 */
export async function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}
