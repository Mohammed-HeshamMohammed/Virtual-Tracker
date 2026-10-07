import { query } from "../../lib/postgres/client.js";
import { currentTenantId } from "../../lib/postgres/audit-actor.js";
import { MAIN_TENANT_ID } from "../../lib/postgres/ensure-tenancy-schema.js";
import { pushToTracker } from "../presence/presence-gateway.js";
import { MessageError } from "./service.js";

/**
 * Buzz: the Owner pokes someone's desktop tracker. Either a small nudge card or a joke
 * "blue screen" with a message ("dude, focus on work").
 *
 * It is live-only on purpose. Nothing is stored and nothing is queued: a buzz that arrives
 * an hour late is not funny, it is noise. If the person's tracker is not connected right
 * now the sender is told so and nothing is sent.
 *
 * It is rate limited so a joke cannot turn into harassment: one buzz per person per
 * BUZZ_COOLDOWN_MS. The tracker has its own, shorter, limit and always lets the person
 * close it at once.
 */

export const BUZZ_STYLES = Object.freeze(["nudge", "bluescreen"]);
export const DEFAULT_BUZZ_MESSAGE = "Dude. Focus on work.";
export const MAX_BUZZ_MESSAGE = 140;
export const BUZZ_COOLDOWN_MS = 30_000;

const lastBuzzAt = new Map();

const tenant = () => currentTenantId() ?? MAIN_TENANT_ID;

/** Test hook: the cooldown is module state. */
export function resetBuzzCooldownsForTests() {
  lastBuzzAt.clear();
}

export async function sendBuzz(ownerId, { memberId, style, message } = {}, now = Date.now()) {
  const target = String(memberId ?? "").trim();
  if (!target) throw new MessageError(400, "Pick who to buzz.");
  if (target === String(ownerId)) throw new MessageError(400, "You cannot buzz yourself.");

  const cleanStyle = String(style ?? "nudge").trim().toLowerCase();
  if (!BUZZ_STYLES.includes(cleanStyle)) throw new MessageError(400, "Pick a nudge or a blue screen.");

  const cleanMessage = String(message ?? "").trim() || DEFAULT_BUZZ_MESSAGE;
  if (cleanMessage.length > MAX_BUZZ_MESSAGE) {
    throw new MessageError(400, `The message must be ${MAX_BUZZ_MESSAGE} characters or fewer.`);
  }

  // The sender's own organization only, same as messaging: without the tenant predicate an
  // Owner could buzz another organization's people just by knowing an id.
  const rows = await query(
    `SELECT id FROM members WHERE id = $1::uuid AND status = 'active' AND tenant_id = $2`,
    [target, tenant()],
  );
  if (!rows.length) throw new MessageError(404, "That person is not in your organization.");

  const previous = lastBuzzAt.get(target);
  if (previous != null && now - previous < BUZZ_COOLDOWN_MS) {
    const wait = Math.ceil((BUZZ_COOLDOWN_MS - (now - previous)) / 1000);
    throw new MessageError(429, `Give them a moment - you can buzz them again in ${wait}s.`);
  }

  const owner = await query(
    `SELECT first_name, last_name, work_email FROM members WHERE id = $1::uuid AND tenant_id = $2`,
    [ownerId, tenant()],
  );
  const from =
    `${owner[0]?.first_name ?? ""} ${owner[0]?.last_name ?? ""}`.trim() || owner[0]?.work_email || "The owner";

  const reached = pushToTracker(target, {
    type: "buzz",
    style: cleanStyle,
    message: cleanMessage,
    from,
    at: now,
  });
  if (reached === 0) {
    // Not counted against the cooldown: nothing was sent.
    throw new MessageError(409, "Their tracker is not open right now, so there is nothing to buzz.");
  }

  lastBuzzAt.set(target, now);
  console.info("[buzz] owner=%s -> member=%s style=%s", ownerId, target, cleanStyle);
  return { delivered: true, style: cleanStyle };
}
