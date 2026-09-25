import { query } from "../../lib/postgres/client.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { KNOWN_CAPABILITIES } from "./monitoring-policy.js";

/**
 * Which capabilities actually stop data being collected, and where.
 *
 * monitoring_capabilities has existed since the compliance work landed, with
 * every row defaulting to enabled = false, and nothing ever read it -
 * isCapabilityEnabled had no callers. An organization could record "URL
 * capture: off, lawful basis: none" and have URLs captured anyway.
 *
 * Only the capabilities listed here are enforced. The rest are reported as
 * unenforced rather than shown as working toggles, because a switch that does
 * nothing is worse than an absent one.
 */
export const ENFORCED_CAPABILITIES = Object.freeze({
  screenshots: "screenshot",
  app_tracking: "app",
  url_capture: "url",
  integrity_signals: null,
});

export function isEnforcedCapability(capability) {
  return Object.prototype.hasOwnProperty.call(ENFORCED_CAPABILITIES, capability);
}

/** Event type -> capability, for the ingest filter. */
const CAPABILITY_FOR_EVENT = Object.freeze(
  Object.fromEntries(
    Object.entries(ENFORCED_CAPABILITIES)
      .filter(([, eventType]) => eventType)
      .map(([capability, eventType]) => [eventType, capability]),
  ),
);

const CACHE_TTL_MS = 30_000;
let cache = null;

/**
 * Enabled capabilities for the current tenant. Cached briefly because ingest
 * reads it on every batch, and a policy change taking effect within half a
 * minute is well inside the agent's own poll interval.
 *
 * Fails open deliberately: if this lookup breaks, dropping a member's tracked
 * work would be a worse outcome than capturing under a policy we could not
 * read, and the read is the thing that failed, not the policy.
 */
export async function enabledCapabilities({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.set;
  try {
    const rows = await query("SELECT capability FROM monitoring_capabilities WHERE enabled = true");
    const set = new Set(rows.map((r) => r.capability));
    cache = { at: Date.now(), set };
    return set;
  } catch (err) {
    logSafeWarn("[capability-gate] could not read the monitoring policy; allowing capture", err);
    return new Set(KNOWN_CAPABILITIES);
  }
}

export function __resetCapabilityCacheForTests() {
  cache = null;
}

/** The capability that governs an event type, or undefined when none does. */
export function capabilityForEvent(eventType) {
  return CAPABILITY_FOR_EVENT[eventType];
}

/** True when an event of this type may be stored under the current policy. */
export function eventAllowed(eventType, enabled) {
  const capability = capabilityForEvent(eventType);
  if (!capability) return true;
  return enabled.has(capability);
}

const BACKFILL_KEY = "monitoring_capability_backfill";

/**
 * Turning enforcement on against rows that all default to false would stop
 * every capture on deploy. This enables, once, exactly the capabilities the
 * organization is demonstrably already using - judged by whether any data of
 * that kind exists - so enforcement changes nothing that was actually
 * happening, and an Owner disabling one afterwards is never undone by a
 * later boot.
 */
export async function backfillCapabilitiesInUse() {
  try {
    const done = await query("SELECT 1 FROM system_meta WHERE doc_key = $1", [BACKFILL_KEY]);
    if (done.length) return { ok: true, skipped: true };

    const [counts] = await query(
      `SELECT EXISTS (SELECT 1 FROM activity_screenshots)        AS screenshots,
              EXISTS (SELECT 1 FROM activity_app_logs)           AS app_tracking,
              EXISTS (SELECT 1 FROM activity_url_logs)           AS url_capture,
              EXISTS (SELECT 1 FROM activity_integrity_flags)    AS integrity_signals`,
    );

    const inUse = Object.keys(ENFORCED_CAPABILITIES).filter((c) => counts?.[c] === true);
    if (inUse.length) {
      await query(
        `UPDATE monitoring_capabilities
            SET enabled = true, enabled_at = COALESCE(enabled_at, now()), updated_at = now()
          WHERE capability = ANY($1) AND enabled = false`,
        [inUse],
      );
    }
    await query(
      `INSERT INTO system_meta (doc_key, payload) VALUES ($1, $2)
       ON CONFLICT (doc_key) DO NOTHING`,
      [BACKFILL_KEY, JSON.stringify({ enabled: inUse, at: new Date().toISOString() })],
    );
    cache = null;
    return { ok: true, enabled: inUse };
  } catch (err) {
    logSafeWarn("[capability-gate] capability backfill failed", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
