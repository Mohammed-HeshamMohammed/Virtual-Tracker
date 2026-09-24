import { query } from "../../lib/postgres/client.js";
import { currentTenantId } from "../../lib/postgres/audit-actor.js";
import { MAIN_TENANT_ID } from "../../lib/postgres/ensure-tenancy-schema.js";

/**
 * Screenshot removal requests.
 *
 * Almost everyone who can see their own captures cannot delete them - clients,
 * employees, interns, team leads. Without a request there is no way for them
 * to object to a screenshot that caught a password, a medical letter or a
 * private message except to find a manager and ask out of band, which most
 * people will not do.
 *
 * The request is only ever about the requester's OWN screenshot. Asking for
 * someone else's to be removed is not a privacy objection.
 */

export const MAX_REASON = 1000;

export class RemovalRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const tenant = () => currentTenantId() ?? MAIN_TENANT_ID;

/** The screenshot, but only if it is this member's own. */
async function ownScreenshot(screenshotId, memberId) {
  const rows = await query(
    `SELECT id, member_id FROM activity_screenshots
      WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [screenshotId, tenant()],
  );
  const shot = rows[0];
  // 404 rather than 403 for someone else's: whether a screenshot exists is
  // not something to confirm to a person who cannot see it.
  if (!shot || String(shot.member_id) !== String(memberId)) {
    throw new RemovalRequestError(404, "Screenshot not found.");
  }
  return shot;
}

export async function requestRemoval(memberId, screenshotId, reason) {
  await ownScreenshot(screenshotId, memberId);
  const trimmed = String(reason ?? "").trim().slice(0, MAX_REASON);

  const rows = await query(
    `INSERT INTO screenshot_removal_requests (screenshot_id, member_id, reason, tenant_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (screenshot_id, member_id) WHERE status = 'pending' DO NOTHING
     RETURNING id`,
    [screenshotId, memberId, trimmed, tenant()],
  );
  // No row means one is already open - the same ask, so report it as done
  // rather than as an error the person has to interpret.
  return { created: rows.length > 0, alreadyPending: rows.length === 0 };
}

/** What this member has already asked about, so the UI can say so. */
export async function listOwnRequests(memberId, screenshotIds = []) {
  const ids = screenshotIds.map((id) => String(id)).filter(Boolean);
  if (!ids.length) return [];
  const rows = await query(
    `SELECT screenshot_id, status FROM screenshot_removal_requests
      WHERE member_id = $1 AND tenant_id = $2 AND screenshot_id = ANY($3::uuid[])`,
    [memberId, tenant(), ids],
  );
  return rows.map((r) => ({ screenshotId: String(r.screenshot_id), status: r.status }));
}

/** The queue a manager works through. */
export async function listPendingRequests({ limit = 100 } = {}) {
  const rows = await query(
    `SELECT r.id, r.screenshot_id, r.member_id, r.reason, r.created_at,
            s.captured_at, s.page_title,
            m.first_name, m.last_name, m.work_email
       FROM screenshot_removal_requests r
       JOIN members m ON m.id = r.member_id
       LEFT JOIN activity_screenshots s ON s.id = r.screenshot_id
      -- A request whose screenshot is already gone (deleted by a manager
      -- directly) has nothing left to act on, so it is not queued.
      WHERE r.status = 'pending' AND r.tenant_id = $1 AND r.screenshot_id IS NOT NULL
      ORDER BY r.created_at
      LIMIT $2`,
    [tenant(), Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    screenshotId: String(r.screenshot_id),
    memberId: String(r.member_id),
    memberName: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.work_email || "Member",
    reason: r.reason ?? "",
    requestedAt: r.created_at,
    capturedAt: r.captured_at ?? null,
    pageTitle: r.page_title ?? "",
  }));
}

/**
 * Approving deletes the screenshot; declining leaves it and records why.
 *
 * The delete is the whole point of approving, so it happens here rather than
 * being left as a second thing the reviewer has to remember to do.
 */
export async function resolveRequest(requestId, reviewerId, { approve, note }) {
  const rows = await query(
    `SELECT id, screenshot_id, status FROM screenshot_removal_requests
      WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [requestId, tenant()],
  );
  const request = rows[0];
  if (!request) throw new RemovalRequestError(404, "Request not found.");
  if (request.status !== "pending") {
    throw new RemovalRequestError(409, "That request has already been reviewed.");
  }

  const status = approve ? "approved" : "declined";
  await query(
    `UPDATE screenshot_removal_requests
        SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
      WHERE id = $1`,
    [requestId, status, reviewerId || null, String(note ?? "").trim().slice(0, MAX_REASON)],
  );

  if (approve && request.screenshot_id) {
    // The FK is ON DELETE SET NULL, so this clears screenshot_id on the
    // request but keeps the row: who asked, who approved and when has to
    // outlive the image it authorised removing.
    await query(`DELETE FROM activity_screenshots WHERE id = $1 AND tenant_id = $2`, [
      request.screenshot_id,
      tenant(),
    ]);
  }
  return { status };
}
