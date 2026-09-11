import { getRedisClient } from "../../lib/redis/client.js";
import { updatePgSession } from "../../lib/postgres/activity-events-postgres.service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { recordSecurityEvent } from "../../core/metrics.js";

/**
 * How long one heartbeat keeps an agent reading as "online".
 *
 * This has to comfortably outlast the longest gap between the agent's writes,
 * or a healthy agent reads as offline between them. It was 15s when the agent
 * polled its session every 5s. Agent v1.0.2 moved that poll to every third tick
 * (LAG-1, to stop it holding the client lock every five seconds), so writes came
 * at least 15s apart - the key now expired before every refresh. The dashboard,
 * which checks every 5s and paused the timer on the first "offline" answer,
 * would then pause a timer whose agent was running perfectly well.
 *
 * The widest real gap: a poll every 3 ticks (~15-17s), one more tick when a poll
 * yields to the UI, and a request that takes up to the 15s HTTP timeout - about
 * 35s. Sixty leaves room. The cost is that an agent that genuinely quits keeps
 * reading as online for up to a minute; the abandoned-session sweep (5 min) is
 * what actually closes its session, so nothing depends on this being faster.
 */
export const HEARTBEAT_TTL_SEC = 60;

const SESSION_STALE_MS = 5 * 60_000;

function key(memberId) {
  return `agent:heartbeat:${memberId}`;
}

/**
 * A gap between two check-ins longer than this is worth reporting
 * (PLAN-timer-stop-resilience.md E3).
 *
 * Half the TTL. The agent writes its heartbeat from two places - the session
 * poll (every ~15s since v1.0.2) and the sync (every ~20s) - so a healthy agent
 * never goes 30s without one. A gap this size is the early warning that comes
 * before the TTL runs out: a cadence change like v1.0.2's LAG-1 shows up here,
 * in the logs, before anyone's timer reads as offline.
 */
export const HEARTBEAT_GAP_WARN_MS = (HEARTBEAT_TTL_SEC * 1000) / 2;

/** Anything before this is not a real timestamp - it is the literal "1" the
 *  heartbeat stored before it recorded times, still in Redis for up to a TTL
 *  after the deploy that changed it. */
const MIN_TIMESTAMP_MS = 1_000_000_000_000;

/**
 * The gap since the previous check-in, or null when there is no previous one
 * worth measuring from: a first check-in, a key that expired, or a legacy value.
 */
export function heartbeatGapMs(previousValue, nowMs) {
  if (previousValue == null) return null;
  const previous = Number(previousValue);
  if (!Number.isFinite(previous) || previous < MIN_TIMESTAMP_MS || previous > nowMs) return null;
  return nowMs - previous;
}

export function isReportableHeartbeatGap(gapMs) {
  return gapMs !== null && gapMs > HEARTBEAT_GAP_WARN_MS;
}

/**
 * Whether this Redis accepts `SET ... GET` (6.2+). Flipped off the first time
 * it is refused, so an older server pays for the refusal once, not on every
 * agent check-in.
 */
let setWithGetSupported = true;

/** Test-only: restore the default, so one test's older-Redis simulation does
 *  not leak into the next. */
export function __resetHeartbeatRedisSupportForTests() {
  setWithGetSupported = true;
}

function isSetGetUnsupported(err) {
  return /syntax error|wrong number of arguments|unknown option/i.test(String(err?.message ?? err));
}

/**
 * Writes the heartbeat and returns the one it replaced, in a single round trip
 * either way - measuring the gap must not add a request to every agent poll.
 */
async function writeHeartbeat(redis, heartbeatKey, nowMs) {
  const value = String(nowMs);
  if (setWithGetSupported) {
    try {
      return await redis.set(heartbeatKey, value, "EX", HEARTBEAT_TTL_SEC, "GET");
    } catch (err) {
      if (!isSetGetUnsupported(err)) throw err;
      setWithGetSupported = false;
    }
  }
  // Redis < 6.2: GETSET then EXPIRE, sent together as one transaction.
  const results = await redis.multi().getset(heartbeatKey, value).expire(heartbeatKey, HEARTBEAT_TTL_SEC).exec();
  return results?.[0]?.[1] ?? null;
}

/**
 * Records that the agent checked in, and reports it when the gap since its
 * last check-in was long enough to matter.
 *
 * @returns {Promise<{ gapMs: number | null }>} the measured gap - callers fire
 *   and forget, but it makes the behaviour observable.
 */
export async function touchAgentHeartbeat(memberId) {
  let redis = null;
  try {
    redis = getRedisClient();
  } catch {
    redis = null;
  }
  if (!redis || !memberId) return { gapMs: null };
  try {
    const nowMs = Date.now();
    // The value is when we heard from it, so presence can report "last seen"
    // and the next check-in can measure the gap.
    const previous = await writeHeartbeat(redis, key(memberId), nowMs);
    const gapMs = heartbeatGapMs(previous, nowMs);
    if (isReportableHeartbeatGap(gapMs)) {
      logSafeWarn("[agent-heartbeat] the agent went quiet between check-ins", {
        memberId,
        gapMs,
        warnAfterMs: HEARTBEAT_GAP_WARN_MS,
        ttlMs: HEARTBEAT_TTL_SEC * 1000,
      });
      recordSecurityEvent({
        event: "agent_heartbeat_gap",
        detail: `member=${memberId} gapMs=${gapMs}`,
      });
    }
    return { gapMs };
  } catch {
    // Best-effort - a missed heartbeat write just means one status check reads stale.
    return { gapMs: null };
  }
}

/**
 * Whether the member's agent is checking in - and whether we could tell.
 *
 * `isAgentOnline` below answers false both when the agent is gone and when
 * Redis cannot be asked. The dashboard read that false as "agent not running"
 * and paused the timer, so a Redis restart or outage paused every active timer
 * at once. That is the same confusion TC-1 fixed for the abandoned-session
 * sweep, left alive on the dashboard's path. "unknown" is its own answer here:
 * nothing may pause, stop or warn on it.
 *
 * @returns {{ presence: "online" | "offline" | "unknown", lastSeenAt: string | null }}
 */
export async function getAgentPresence(memberId) {
  if (!memberId) return { presence: "offline", lastSeenAt: null };
  let redis = null;
  try {
    redis = getRedisClient();
  } catch {
    redis = null;
  }
  if (!redis) return { presence: "unknown", lastSeenAt: null };
  try {
    const value = await redis.get(key(memberId));
    if (value == null) return { presence: "offline", lastSeenAt: null };
    const ms = Number(value);
    return {
      presence: "online",
      lastSeenAt: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
    };
  } catch {
    return { presence: "unknown", lastSeenAt: null };
  }
}

/** Kept for existing callers; prefer getAgentPresence, which can say "unknown". */
export async function isAgentOnline(memberId) {
  const redis = getRedisClient();
  if (!redis || !memberId) return false;
  try {
    return (await redis.exists(key(memberId))) === 1;
  } catch {
    return false;
  }
}

export async function isSessionAbandoned(session) {
  if (!session) return false;
  const status = String(session.status || "").toLowerCase();
  if (session.source !== "agent" || (status !== "active" && status !== "idle")) return false;
  if (session.updated_at == null) return false;
  const updatedAt = new Date(session.updated_at).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > SESSION_STALE_MS;
}

export async function closeAbandonedSession(session) {
  const now = new Date();
  await updatePgSession(session.id, {
    status: "stopped",
    endedAt: now,
    updatedAt: now,
    stopReason: "abandoned_reap",
    event: { action: "stop", reason: "abandoned_reap", source: "server" },
  });
  logSafeWarn("[agent-heartbeat] closed abandoned desktop-agent session", {
    sessionId: session.id,
    memberId: session.member_id,
  });
  recordSecurityEvent({
    event: "abandoned_session_closed",
    detail: `session=${session.id} member=${session.member_id ?? "unknown"}`,
  });
}
