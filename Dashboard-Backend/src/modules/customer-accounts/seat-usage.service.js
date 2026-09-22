import { query } from "../../lib/postgres/client.js";

/**
 * Seats occupied vs available for one tenant - the headcount figure the
 * People page shows next to its Members header
 * (PLAN-bug-fixes-round-1.md item 18).
 *
 * Deliberately the SAME definition of "used" as assertSeatAvailable in
 * tenant.service.js: active members plus pending invites. If these two ever
 * disagreed, the number shown to someone would not be the number they are
 * actually blocked by when they try to invite the next person.
 *
 * The main tenant is seeded with an effectively unlimited seat_limit
 * (see ensure-tenancy-schema.js), so `unlimited` is reported rather than
 * rendering a meaningless "12 / 2147483647".
 */

/** Anything at or above this is a placeholder, not a real purchased limit. */
const UNLIMITED_THRESHOLD = 1_000_000;

export async function getTenantSeatUsage(tenantId) {
  if (!tenantId) return null;

  const rows = await query(
    `SELECT
       t.seat_limit,
       (SELECT count(*) FROM members m WHERE m.tenant_id = t.id AND m.status = 'active')
         + (SELECT count(*) FROM invites i WHERE i.tenant_id = t.id AND i.status = 'pending_signup') AS seats_used
     FROM tenants t
     WHERE t.id = $1
     LIMIT 1`,
    [tenantId],
  );

  const row = rows[0];
  if (!row) return null;

  const seatLimit = Number(row.seat_limit ?? 0);
  const seatsUsed = Number(row.seats_used ?? 0);
  const unlimited = seatLimit >= UNLIMITED_THRESHOLD;

  return {
    seatLimit: unlimited ? null : seatLimit,
    seatsUsed,
    // Never negative: an over-limit tenant (seats lowered after the fact, or
    // rows created before a limit existed) reads as 0 open, not "-3 open".
    seatsOpen: unlimited ? null : Math.max(0, seatLimit - seatsUsed),
    unlimited,
  };
}
