import { query } from "../../lib/postgres/client.js";
import { getMonitoringPolicy } from "./monitoring-policy.js";

const MAX_DAYS = 30;

/**
 * Counts what the monitoring policy discarded at ingest. Without it, switching a
 * capability off looks exactly like a tracker that has stopped working: the
 * data simply never arrives, and nothing says why.
 *
 * `tally` is capability -> number of events dropped in one batch. One upsert per
 * capability per batch, so the cost is nothing on the normal path (no drops, no
 * call) and small on the abnormal one.
 */
export async function recordPolicyDrops(memberId, tally) {
  if (!memberId) return;
  for (const [capability, count] of Object.entries(tally)) {
    const dropped = Math.floor(Number(count));
    if (!capability || !(dropped > 0)) continue;
    await query(
      `INSERT INTO capture_policy_drops (member_id, capability, dropped)
       VALUES ($1, $2, $3)
       ON CONFLICT (member_id, capability, day)
       DO UPDATE SET dropped = capture_policy_drops.dropped + EXCLUDED.dropped, updated_at = now()`,
      [memberId, capability, dropped],
    );
  }
}

/**
 * Which enforced capabilities need someone's attention, and why.
 *
 * `discarding` is the urgent kind - the capability is off and data is arriving
 * that is being thrown away. `needsBasis` is the record-keeping kind - it is on,
 * but no lawful basis was ever recorded (the one-time backfill enables what was
 * already in use without one, because it has no way to know).
 */
export async function getPolicyHealth({ days = 7 } = {}) {
  const span = Math.min(MAX_DAYS, Math.max(1, Math.floor(Number(days) || 7)));
  const [policy, drops] = await Promise.all([
    getMonitoringPolicy(),
    query(
      `SELECT capability, sum(dropped)::int AS dropped, count(DISTINCT member_id)::int AS members
         FROM capture_policy_drops
        WHERE day >= (CURRENT_DATE - ($1::int - 1))
        GROUP BY capability`,
      [span],
    ),
  ]);
  const byCapability = new Map(drops.map((r) => [r.capability, r]));

  const capabilities = policy
    .filter((c) => c.enforced)
    .map((c) => {
      const seen = byCapability.get(c.capability);
      const dropped = c.enabled ? 0 : seen?.dropped ?? 0;
      return {
        capability: c.capability,
        enabled: c.enabled,
        lawfulBasis: c.lawfulBasis,
        dropped,
        members: c.enabled ? 0 : seen?.members ?? 0,
        discarding: !c.enabled && dropped > 0,
        needsBasis: c.enabled && !c.lawfulBasis,
      };
    });

  return {
    days: span,
    capabilities,
    discarding: capabilities.some((c) => c.discarding),
    needsAttention: capabilities.some((c) => c.discarding || c.needsBasis),
  };
}
