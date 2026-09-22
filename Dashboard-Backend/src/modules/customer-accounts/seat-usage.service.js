import { query } from "../../lib/postgres/client.js";
import { currentTenantId } from "../../lib/postgres/audit-actor.js";

/**
 * Seats occupied vs available for one tenant - the headcount figure the
 * People page shows next to its Members header
 * (PLAN-bug-fixes-round-1.md item 18).
 *
 * "Used" is usedSeatsSql below, shared with every other seat figure.
 *
 * The main tenant is seeded with an effectively unlimited seat_limit
 * (see ensure-tenancy-schema.js), so `unlimited` is reported rather than
 * rendering a meaningless "12 / 2147483647".
 */

/** Anything at or above this is a placeholder, not a real purchased limit. */
const UNLIMITED_THRESHOLD = 1_000_000;

/**
 * THE definition of a used seat, as a SQL expression over `tenantRef` (a
 * column like `t.id` or a parameter like `$1`). Every seat figure - this
 * page's readout, the Customer Accounts list and detail, the lowering
 * check and the add/invite guard below - is built from this one string,
 * because a number shown to someone has to be the number they are actually
 * blocked by. It had been copy-pasted six times.
 *
 * A seat is: an active member, a pending invite, or a pre-provisioned
 * account that has not signed in yet (pending_auth_members). The last was
 * left out before, so an Owner could pre-provision past the limit and have
 * those people refused at their first sign-in instead.
 *
 * The exclusions are for rows being CONVERTED rather than added: an
 * accepted invite's pending row, or a pending account being promoted,
 * already holds the seat its member is about to take.
 */
export function usedSeatsSql(tenantRef, { excludeInvitesParam, excludePendingUidsParam } = {}) {
  const inviteExclusion = excludeInvitesParam ? ` AND i.id <> ALL(${excludeInvitesParam}::uuid[])` : "";
  const pendingExclusion = excludePendingUidsParam ? ` AND p.firebase_uid <> ALL(${excludePendingUidsParam}::text[])` : "";
  return `((SELECT count(*) FROM members m WHERE m.tenant_id = ${tenantRef} AND m.status = 'active')
    + (SELECT count(*) FROM invites i WHERE i.tenant_id = ${tenantRef} AND i.status = 'pending_signup'${inviteExclusion})
    + (SELECT count(*) FROM pending_auth_members p WHERE p.tenant_id = ${tenantRef}${pendingExclusion}))`;
}

export async function getTenantSeatUsage(tenantId) {
  if (!tenantId) return null;

  const rows = await query(
    `SELECT t.seat_limit, ${usedSeatsSql("t.id")} AS seats_used
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

export class SeatLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "SeatLimitError";
    this.code = "SEAT_LIMIT_REACHED";
    this.status = 409;
  }
}

const USED_SEATS_SQL = `SELECT ${usedSeatsSql("$1", { excludeInvitesParam: "$2", excludePendingUidsParam: "$3" })} AS used`;

/**
 * The seat check every add/invite path runs before it creates anyone.
 *
 * tenant.service.js had an assertSeatAvailable written as "the only place a
 * seat is consumed", but nothing ever called it - every invite and add path
 * went straight to INSERT, so a customer account's seat limit was shown but
 * never enforced. This is that check, generalised to N seats (a bulk invite
 * takes several at once) and to any tenant: the main organization too, once
 * an Owner gives it a real limit (PATCH /api/members/seats).
 *
 * `insert(client)` runs inside the same transaction, while the tenant row is
 * locked FOR UPDATE, so two concurrent invites cannot both read "one seat
 * left" and both take it. Paths that create the member through helpers that
 * use their own connection (migrate, preprovision, invite register) pass no
 * `insert` - for them this is a check under a lock that is released before
 * they write, a narrow window accepted rather than threading a client
 * through every member-creation helper.
 *
 * `excludeInviteIds` / `excludePendingUids`: rows being converted into the
 * member rather than added alongside it (see usedSeatsSql).
 *
 * Tenants with no real limit (the main organization's seeded placeholder)
 * skip the lock entirely, so the default setup pays nothing for this.
 */
export async function withSeatsAvailable(tenantId, needed, { insert, excludeInviteIds = [], excludePendingUids = [] } = {}) {
  const { withTransaction, withTenant } = await import("../../lib/postgres/client.js");
  const count = Math.max(0, Math.floor(Number(needed) || 0));
  if (!tenantId) return insert ? withTransaction((client) => insert(client)) : undefined;

  // Under the tenant being counted: the public invite-register route has no
  // signed-in tenant at all, and once RLS is on (ensure-tenancy-rls.js) an
  // empty tenant counts nobody. Only switched when it differs, because
  // withTenant also drops the audit actor, and a signed-in inviter's
  // inserts below should stay attributed to them.
  const run = (fn) => (currentTenantId() === tenantId ? fn() : withTenant(tenantId, fn));
  return run(() => withTransaction(async (client) => {
    const tenantRows = await client.query(
      `SELECT seat_limit FROM tenants WHERE id = $1 FOR UPDATE`,
      [tenantId],
    );
    const seatLimit = Number(tenantRows.rows[0]?.seat_limit ?? 0);
    if (tenantRows.rows.length && seatLimit < UNLIMITED_THRESHOLD && count > 0) {
      const usedRows = await client.query(USED_SEATS_SQL, [
        tenantId,
        excludeInviteIds.filter(Boolean),
        excludePendingUids.filter(Boolean),
      ]);
      const used = Number(usedRows.rows[0]?.used ?? 0);
      if (used + count > seatLimit) {
        const open = Math.max(0, seatLimit - used);
        throw new SeatLimitError(
          open === 0
            ? `All ${seatLimit} seats are in use. Remove someone or cancel a pending invite to free a seat.`
            : `Only ${open} of ${seatLimit} seats ${open === 1 ? "is" : "are"} open, and this needs ${count}.`,
        );
      }
    }
    return insert ? insert(client) : undefined;
  }));
}

/**
 * Sets the caller's own organization's seat limit. `null` means unlimited
 * (stored as the same placeholder ensure-tenancy-schema.js seeds). Refuses
 * to go below what is already in use - it would leave the tenant over its
 * limit with no way to tell who is "extra".
 */
export async function setTenantSeatLimit(tenantId, seats) {
  const { withTransaction } = await import("../../lib/postgres/client.js");
  let next;
  if (seats === null) {
    next = 2147483647;
  } else {
    const n = Number(seats);
    if (!Number.isInteger(n) || n < 1 || n >= UNLIMITED_THRESHOLD) {
      throw Object.assign(new Error(`Seats must be a whole number from 1 to ${UNLIMITED_THRESHOLD - 1}, or unlimited.`), {
        status: 400,
      });
    }
    next = n;
  }
  return withTransaction(async (client) => {
    const tenantRows = await client.query(`SELECT seat_limit FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
    if (!tenantRows.rows.length) throw Object.assign(new Error("Organization not found."), { status: 404 });
    if (next < UNLIMITED_THRESHOLD) {
      const usedRows = await client.query(USED_SEATS_SQL, [tenantId, [], []]);
      const used = Number(usedRows.rows[0]?.used ?? 0);
      if (next < used) {
        throw Object.assign(
          new Error(`Cannot set the limit below ${used}, the number of seats already in use.`),
          { status: 409 },
        );
      }
    }
    await client.query(`UPDATE tenants SET seat_limit = $2 WHERE id = $1`, [tenantId, next]);
    return { from: Number(tenantRows.rows[0].seat_limit), to: next };
  });
}
