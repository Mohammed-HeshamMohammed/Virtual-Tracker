import { query } from "../../lib/postgres/client.js";
import { currentTenantId } from "../../lib/postgres/audit-actor.js";
import { MAIN_TENANT_ID } from "../../lib/postgres/ensure-tenancy-schema.js";
import { pushToDashboards } from "../presence/presence-gateway.js";
import { MessageError } from "./service.js";

/**
 * Refresh someone's dashboard: every dashboard tab they have open reloads, so it picks up a new
 * release (or gets out of a stuck state) without anyone having to ask them to press F5.
 *
 * Like a buzz it is live-only: if no dashboard of theirs is open right now the sender is told,
 * and nothing is kept for later - a reload that fires the next morning would only lose whatever
 * they had just typed. The tab counts down REFRESH_DELAY_SEC first, says who asked and why, and
 * lets them reload at once; it does not let them cancel, because a page left on an old release
 * is the problem this exists to fix.
 *
 * One request per person per REFRESH_COOLDOWN_MS, so it cannot be used to keep reloading
 * someone's page.
 */

export const REFRESH_DELAY_SEC = 10;
export const REFRESH_COOLDOWN_MS = 30_000;

const lastRefreshAt = new Map();
const tenant = () => currentTenantId() ?? MAIN_TENANT_ID;

/** Test hook: the cooldown is module state. */
export function resetRefreshCooldownsForTests() {
  lastRefreshAt.clear();
}

export async function requestPageRefresh(senderId, { memberId } = {}, now = Date.now()) {
  const target = String(memberId ?? "").trim();
  if (!target) throw new MessageError(400, "Pick whose page to refresh.");

  // The sender's own organization only, same as messaging and buzz.
  const rows = await query(
    `SELECT id FROM members WHERE id = $1::uuid AND status = 'active' AND tenant_id = $2`,
    [target, tenant()],
  );
  if (!rows.length) throw new MessageError(404, "That person is not in your organization.");

  const previous = lastRefreshAt.get(target);
  if (previous != null && now - previous < REFRESH_COOLDOWN_MS) {
    const wait = Math.ceil((REFRESH_COOLDOWN_MS - (now - previous)) / 1000);
    throw new MessageError(429, `Their page was just refreshed - you can do it again in ${wait}s.`);
  }

  const sender = await query(
    `SELECT first_name, last_name, work_email FROM members WHERE id = $1::uuid AND tenant_id = $2`,
    [senderId, tenant()],
  );
  const from =
    `${sender[0]?.first_name ?? ""} ${sender[0]?.last_name ?? ""}`.trim() || sender[0]?.work_email || "An admin";

  const pages = pushToDashboards(target, { type: "refresh-page", from, delaySeconds: REFRESH_DELAY_SEC, at: now }, now);
  if (pages === 0) {
    // Not counted against the cooldown: nothing was sent.
    throw new MessageError(409, "They do not have the dashboard open right now, so there is nothing to refresh.");
  }
  lastRefreshAt.set(target, now);
  console.info("[refresh-page] sender=%s -> member=%s pages=%d", senderId, target, pages);
  return { delivered: true, pages };
}
