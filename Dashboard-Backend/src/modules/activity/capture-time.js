const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * When a batch of agent events was captured. The agent stamps a batch that waited out an
 * outage (`capturedAtMs`); without it, or with a value that cannot be right (not a number,
 * in the future, over a week old), the server's own clock is used.
 */
export function batchCaptureTime(capturedAtMs, now = new Date()) {
  const ms = Number(capturedAtMs);
  if (!Number.isFinite(ms)) return now;
  const t = now.getTime();
  if (ms > t || ms < t - MAX_AGE_MS) return now;
  return new Date(ms);
}
