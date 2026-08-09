/**
 * Promote a user to Owner in Postgres.
 *
 * Usage:
 *   node scripts/assign-owner.mjs
 *   node scripts/assign-owner.mjs mohamedhms3102@gmail.com
 *   npm run assign-owner
 */

import { query } from "../src/lib/postgres/client.js";
import { getMemberByFirebaseUidPg, updateMemberPg } from "../src/lib/postgres/members-postgres.service.js";
import { getAuthAdmin } from "../src/config/firebase.js";

const DEFAULT_EMAIL = "mohamedhms3102@gmail.com";

function parseEmailArg() {
  const arg = process.argv.slice(2).find((value) => value && !value.startsWith("-"));
  return (arg || DEFAULT_EMAIL).trim().toLowerCase();
}

async function resolveOwnerRoleId() {
  const rows = await query("SELECT id FROM roles WHERE LOWER(name) = 'owner' LIMIT 1");
  if (rows[0]?.id) return String(rows[0].id);

  const allRoles = await query("SELECT id, name FROM roles");
  const owner = allRoles.find((r) => String(r.name).toLowerCase() === "owner");
  if (owner?.id) return String(owner.id);

  throw new Error("Owner role not found in Postgres 'roles' table.");
}

async function main() {
  const email = parseEmailArg();
  console.log(`[assign-owner] Target email: ${email}`);

  const ownerRoleId = await resolveOwnerRoleId();
  console.log(`[assign-owner] Owner role ID: ${ownerRoleId}`);

  // 1. Find member by email in Postgres
  let memberRows = await query(
    "SELECT * FROM members WHERE LOWER(work_email) = LOWER($1) OR LOWER(personal_email) = LOWER($1) LIMIT 1",
    [email],
  );
  let member = memberRows[0] ?? null;

  // 2. If missing, try resolving from Firebase Auth if Admin SDK is configured
  const auth = getAuthAdmin();
  let userRecord = null;
  if (auth) {
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch {
      console.log(`[assign-owner] Note: Firebase Auth user lookup for ${email} skipped or not found.`);
    }
  }

  if (!member && userRecord) {
    member = await getMemberByFirebaseUidPg(userRecord.uid);
  }

  if (!member) {
    console.error(`[assign-owner] ERROR: Member record for ${email} not found in Postgres.`);
    console.error(`Please ensure the user has signed in at least once or exists in the database.`);
    process.exit(1);
  }

  const memberId = String(member.id);

  // 3. Update member's role_id and status in Postgres
  const patchPayload = {
    role_id: ownerRoleId,
    status: "active",
    updated_by: "script:assign-owner",
  };
  if (userRecord?.uid && !member.firebase_uid) {
    patchPayload.firebase_uid = userRecord.uid;
  }

  await updateMemberPg(memberId, patchPayload);

  // 4. Update member_roles table in Postgres
  try {
    await query("DELETE FROM member_roles WHERE member_id = $1", [memberId]);
    await query(
      "INSERT INTO member_roles (id, member_id, role_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING",
      [memberId, ownerRoleId],
    );
  } catch (e) {
    console.log("[assign-owner] Note: member_roles table update:", e?.message || e);
  }

  // 5. Invalidate role cache
  try {
    const { invalidateMemberRoleCache } = await import("../src/http/role-cache.js");
    invalidateMemberRoleCache(memberId);
  } catch { }

  console.log(
    JSON.stringify(
      {
        ok: true,
        email,
        memberId,
        roleId: ownerRoleId,
        roleName: "Owner",
        firebaseUid: member.firebase_uid || userRecord?.uid || null,
        status: "active",
      },
      null,
      2,
    ),
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("[assign-owner] Fatal Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
