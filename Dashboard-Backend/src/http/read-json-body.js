export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export const MAX_AVATAR_JSON_BODY_BYTES = 768 * 1024;

export const MAX_ACTIVITY_EVENTS_BODY_BYTES = 2.5 * 1024 * 1024;

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
