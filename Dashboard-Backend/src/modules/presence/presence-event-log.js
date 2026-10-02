// Short-lived, in-memory log of the frames the presence WebSocket pushes
// (`changed`, `scope-changed`, `force-sign-out`).
//
// Some corporate web filters block the WebSocket protocol outright, per domain,
// with no way for us to get around it. Dashboards on those networks fall back
// to polling `/api/presence/poll`, which replays this log. Same scope as the
// WebSocket itself: per instance, in memory, best effort - a client that has
// fallen further behind than the log reaches is told to do a full refetch
// instead of being replayed a partial history.

const MAX_EVENTS = 1000;
const TTL_MS = 5 * 60_000;
const ALL = "*";

let seq = 0;
let events = [];

function prune(now) {
  const cutoff = now - TTL_MS;
  let drop = 0;
  while (drop < events.length && (events[drop].at < cutoff || events.length - drop > MAX_EVENTS)) drop += 1;
  if (drop > 0) events = events.slice(drop);
}

/** `target` is a member id, or "*" for everyone. */
export function recordPresenceEvent(target, message, now = Date.now()) {
  seq += 1;
  events.push({ seq, target: target || ALL, at: now, message });
  prune(now);
}

export function currentPresenceCursor() {
  return seq;
}

/**
 * Events for `memberId` after `since`. `reset` is true when events the caller
 * may need have already been dropped, so it should refetch rather than trust
 * the (incomplete) list.
 */
export function presenceEventsSince(memberId, since, now = Date.now()) {
  prune(now);
  const oldestRetained = events.length ? events[0].seq : seq + 1;
  const reset = since < oldestRetained - 1;
  const list = events
    .filter((e) => e.seq > since && (e.target === ALL || e.target === memberId))
    .map((e) => e.message);
  return { cursor: seq, reset, events: list };
}

export function resetPresenceEventLogForTests() {
  seq = 0;
  events = [];
}
