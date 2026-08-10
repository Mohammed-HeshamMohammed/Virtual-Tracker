#!/usr/bin/env node
/**
 * Incident recovery: rebuild the Postgres `members` table from Firebase Auth.
 *
 * The Firestore `members` collection (and member_auth_index/User_profiles)
 * was deleted before this table existed. Firebase Auth itself is untouched -
 * it still has every account's uid/email/displayName/disabled/creation time -
 * but it never knew the old internal member_id UUID, and nothing else in
 * Postgres stored a firebase_uid next to a member_id either (the one
 * exception, member_bans, only covers members who were banned). So this
 * seeds every account with a *new* member_id - there is no way to recover
 * the old ones without a Firestore backup/PITR restore, which this incident
 * did not have.
 *
 * What this restores: every Firebase Auth account gets a working `members`
 * row again, so sign-in (auth-middleware.js's firebase_uid lookup) and
 * anything gated on "does this account resolve to a member" starts working.
 *
 * What this does NOT restore: role assignment, team membership, hierarchy
 * position, employment/pay-rate linkage - anything that lived only in the
 * deleted members doc's own fields, or that pointed at the old member_id
 * from elsewhere in Postgres (pay_rates.member_id, task_assignments.member_id,
 * project_members.member_id, etc. all still exist, keyed by UUIDs that no
 * longer resolve to anyone). Every seeded member lands with role "Viewer"
 * and status "active" - an admin has to re-assign real roles/teams by hand.
 * That reconciliation is out of scope for this script on purpose: it is a
 * one-time manual-review task, not something safe to automate blindly onto
 * whichever role happens to be default.
 *
 * Idempotent: re-running only inserts accounts that don't already have a
 * members row for their firebase_uid (ON CONFLICT DO NOTHING), so it's safe
 * to run again if Firebase Auth grows more users before the org finishes
 * reconciling roles/teams by hand.
 *
 * Usage:
 *   node scripts/rebuild-members-from-firebase-auth.mjs --dry-run
 *   node scripts/rebuild-members-from-firebase-auth.mjs
 */
import { getAuthAdmin } from "../src/config/firebase.js";
import { query, isPostgresConfigured } from "../src/lib/postgres/client.js";

const dryRun = process.argv.includes("--dry-run");
const PAGE_SIZE = 1000;

function splitDisplayName(displayName) {
  const parts = String(displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  const [firstName, ...rest] = parts;
  return { firstName, lastName: rest.join(" ") };
}

async function main() {
  isPostgresConfigured();
  const auth = getAuthAdmin();
  if (!auth) throw new Error("Firebase Admin auth is not configured.");

  const existing = await query("SELECT firebase_uid FROM members WHERE firebase_uid <> ''");
  const alreadySeeded = new Set(existing.map((r) => r.firebase_uid));

  let pageToken;
  let scanned = 0;
  let toInsert = [];
  do {
    const page = await auth.listUsers(PAGE_SIZE, pageToken);
    for (const user of page.users) {
      scanned += 1;
      if (alreadySeeded.has(user.uid)) continue;
      const { firstName, lastName } = splitDisplayName(user.displayName);
      toInsert.push({
        firebase_uid: user.uid,
        first_name: firstName || "Member",
        last_name: lastName,
        display_name: user.displayName ?? "",
        work_email: user.email ?? "",
        status: user.disabled ? "disabled" : "active",
        created_by: "rebuild-from-firebase-auth",
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);

  console.log(`Scanned ${scanned} Firebase Auth accounts, ${toInsert.length} need a members row.`);

  if (dryRun) {
    console.log("[dry-run] Would insert:");
    for (const row of toInsert) console.log(`  ${row.firebase_uid}  ${row.work_email}  "${row.display_name}"`);
    return;
  }

  let inserted = 0;
  for (const row of toInsert) {
    const result = await query(
      `INSERT INTO members (firebase_uid, first_name, last_name, display_name, work_email, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (firebase_uid) WHERE firebase_uid <> '' DO NOTHING
       RETURNING id`,
      [row.firebase_uid, row.first_name, row.last_name, row.display_name, row.work_email, row.status, row.created_by],
    );
    if (result.length > 0) inserted += 1;
  }

  console.log(`Inserted ${inserted} members rows.`);
  console.log(
    "Every seeded member has role 'Viewer' by default (no role_id set) - " +
      "an admin needs to reassign real roles, teams, and hierarchy position by hand.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[rebuild-members-from-firebase-auth] failed:", err);
    process.exit(1);
  });
