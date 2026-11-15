import { query } from "../../../lib/postgres/client.js";
import { MAIN_TENANT_ID } from "../../../lib/postgres/ensure-tenancy-schema.js";
import { createClientWithDetails } from "./client-service.js";

/**
 * Client self-setup: a member with the Client role who has no client record
 * linked to them fills in their own client details before using the
 * dashboard. It doesn't matter how they got the role - invited as a Client,
 * migrated/merged in as one, or switched to Client later - the only question
 * is whether a `clients` row points at them.
 *
 * It is a safety net, not a second data-entry step: when an admin already
 * made their client record, nothing is asked. Admins usually do that from
 * the Clients page's "Add new client member", which saves the client with
 * the invitee's EMAIL but no member link (the member doesn't exist until
 * the invite is accepted), and nothing ever linked the two afterwards. So
 * before asking, this links that record by email - see autoLinkByEmail.
 */

export function isClientRoleName(roleName) {
  return String(roleName || "").toLowerCase().replace(/\s+/g, "") === "client";
}

async function findLinkedClientId(memberId) {
  const rows = await query("SELECT id FROM clients WHERE member_id = $1 ORDER BY created_at LIMIT 1", [memberId]);
  return rows[0] ? String(rows[0].id) : null;
}

/**
 * Links the one unlinked, active client record in the member's own tenant
 * whose email list contains the member's work email. Only an exact, single
 * match counts: two candidates means an admin has to say which, and the
 * tenant filter means an email match can never attach someone to another
 * organization's client. `member_id IS NULL` in the UPDATE makes a race with
 * an admin linking it by hand a no-op instead of a steal.
 */
async function autoLinkByEmail(memberId, email, tenantId) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const candidates = await query(
    `SELECT id FROM clients
      WHERE member_id IS NULL
        AND status = 'active'
        AND tenant_id = $2
        AND $1 = ANY(regexp_split_to_array(lower(email_addresses), '[\\s,;]+'))
      LIMIT 2`,
    [normalized, tenantId],
  );
  if (candidates.length !== 1) return null;
  const linked = await query(
    `UPDATE clients SET member_id = $1, updated_at = now(), updated_by = $1
      WHERE id = $2 AND member_id IS NULL
      RETURNING id`,
    [memberId, candidates[0].id],
  );
  return linked[0] ? String(linked[0].id) : null;
}

/**
 * The mirror of autoLinkByEmail, run from the admin's side: an admin attaches
 * a client record to a project, or saves it, and the person it describes
 * already has a Client login with that email. Without the link the Client's
 * project list is empty, because a Client sees projects through the record
 * that points at them, so waiting for their next sign-in left them with
 * "No projects" until then, and forever if the sign-in check found nothing.
 *
 * Same rules as the sign-in link: same tenant, an exact email match, exactly
 * one Client-role member, and that member has no client record yet. Anything
 * ambiguous is left for an admin to link by hand. Never throws - it is a
 * convenience on top of the save, not part of it.
 */
export async function linkClientRecordToMemberByEmail(db, clientId) {
  try {
    const rows = await query(
      "SELECT member_id, tenant_id, email_addresses FROM clients WHERE id = $1 AND status = 'active' LIMIT 1",
      [clientId],
    );
    const client = rows[0];
    if (!client || client.member_id) return null;
    const emails = String(client.email_addresses || "")
      .toLowerCase()
      .split(/[\s,;]+/)
      .filter(Boolean);
    if (emails.length === 0) return null;

    const candidates = await query(
      `SELECT m.id, r.name AS role_name FROM members m
         JOIN roles r ON r.id = m.role_id
        WHERE m.tenant_id = $2
          AND lower(m.work_email) = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM clients x WHERE x.member_id = m.id)
        LIMIT 5`,
      [emails, client.tenant_id],
    );
    const clientMembers = candidates.filter((row) => isClientRoleName(row.role_name)).map((row) => String(row.id));
    if (clientMembers.length !== 1) return null;

    const linked = await query(
      `UPDATE clients SET member_id = $1, updated_at = now()
        WHERE id = $2 AND member_id IS NULL
        RETURNING id`,
      [clientMembers[0], clientId],
    );
    return linked[0] ? clientMembers[0] : null;
  } catch {
    return null;
  }
}

async function loadMemberContact(memberId) {
  const rows = await query(
    "SELECT first_name, last_name, work_email, phone_number FROM members WHERE id = $1 LIMIT 1",
    [memberId],
  );
  const m = rows[0] ?? {};
  return {
    name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim(),
    email: typeof m.work_email === "string" ? m.work_email : "",
    phone: typeof m.phone_number === "string" ? m.phone_number : "",
  };
}

/**
 * { required, clientId?, autoLinked?, prefill? } for the signed-in member.
 * Never throws for a non-client: they simply aren't required to do anything.
 */
export async function getClientSelfSetupStatus(viewer) {
  if (!viewer?.memberId || !isClientRoleName(viewer.roleName)) return { required: false };

  const linked = await findLinkedClientId(viewer.memberId);
  if (linked) return { required: false, clientId: linked };

  const contact = await loadMemberContact(viewer.memberId);
  const autoLinked = await autoLinkByEmail(viewer.memberId, contact.email, viewer.tenantId || MAIN_TENANT_ID);
  if (autoLinked) return { required: false, clientId: autoLinked, autoLinked: true };

  return { required: true, prefill: contact };
}

export class ClientSelfSetupError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Creates the Client's own client record from the fields a client may set
 * about themselves: name, address and contact details. Budget, invoicing and
 * project links are the organization's decisions and stay with the admins
 * on the Clients page - anything else in the body is ignored, not trusted.
 */
export async function completeClientSelfSetup(db, viewer, body = {}) {
  if (!viewer?.memberId || !isClientRoleName(viewer.roleName)) {
    throw new ClientSelfSetupError(403, "Only members with the Client role fill in their own client details.");
  }
  if (await findLinkedClientId(viewer.memberId)) {
    throw new ClientSelfSetupError(409, "Your client details are already on file.");
  }

  const text = (v, max) => String(v ?? "").trim().slice(0, max);
  const name = text(body.name, 200);
  const email = text(body.email, 500);
  if (!name) throw new ClientSelfSetupError(400, "Name is required.");
  if (!email || !email.split(/[\s,;]+/).filter(Boolean).every((e) => EMAIL_RE.test(e))) {
    throw new ClientSelfSetupError(400, "Enter a valid email address.");
  }

  return createClientWithDetails(
    db,
    {
      name,
      email,
      address: text(body.address, 500),
      city: text(body.city, 120),
      state: text(body.state, 120),
      zip: text(body.zip, 20),
      country: text(body.country, 120),
      phone: text(body.phone, 40),
      clientMember: viewer.memberId,
      projects: [],
      budget: null,
      invoicing: {},
    },
    viewer.memberId,
  );
}
