/** Maximum JSON body size accepted by the API (1 MiB). */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/** Avatar uploads send base64 JSON (~4/3× file size); allow up to ~750 KB decoded image. */
export const MAX_AVATAR_JSON_BODY_BYTES = 768 * 1024;

/**
 * Desktop-agent screenshot events: a 1280px-wide JPEG at quality 72, base64-encoded
 * (~4/3× inflation), can pass 1 MiB on a tall/dense display even though width is
 * capped — height isn't. The 1 MiB default silently truncates those uploads with
 * "Request body too large" before the handler ever sees them.
 */
export const MAX_ACTIVITY_EVENTS_BODY_BYTES = 2.5 * 1024 * 1024;

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
