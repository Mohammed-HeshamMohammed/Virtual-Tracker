/**
 * Promote a Firebase Auth user to Owner (database-only; blocked in the app UI).
 *
 * Usage:
 *   npm run assign-owner
 *   npm run assign-owner -- someone@example.com
 */

import { getDb, getAuthAdmin } from "../src/config/firebase.js";
import { resolveMemberRoleName } from "../src/modules/activity/activity-scope.js";
import { ensureMemberRowForUserRecord } from "../src/modules/members/services/ensure-member-from-auth.js";
import {
  alignMemberRoleTables,
  ensureDefaultRoles,
  syncMemberPrimaryRole,
} from "../src/modules/members/services/relation-sync.js";

const DEFAULT_EMAIL = "mohamedhms3102@gmail.com";

function parseEmailArg() {
  const arg = process.argv.slice(2).find((value) => value && !value.startsWith("-"));
  return (arg || DEFAULT_EMAIL).trim().toLowerCase();
}

async function findMemberIdByEmail(db, email) {
  const queries = [
    db.collection("members").where("work_email", "==", email).limit(1).get(),
    db.collection("members").where("personal_email", "==", email).limit(1).get(),
  ];
  for (const query of queries) {
    const snap = await query;
    if (!snap.empty) return snap.docs[0].id;
  }
  return null;
}

async function main() {
  const email = parseEmailArg();
  const db = getDb();
  const auth = getAuthAdmin();

  if (!db || !auth) {
    console.error(
      "Firebase Admin is not configured. Add firebase-admin.local.json or service account env vars in Backend/.env.",
    );
    process.exit(1);
  }

  await ensureDefaultRoles(db);

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch {
    console.error(`No Firebase Auth account for ${email}. Sign in once in the app, then rerun this script.`);
    process.exit(1);
  }

  let memberId = await findMemberIdByEmail(db, email);
  const ensured = await ensureMemberRowForUserRecord(db, userRecord);
  memberId = ensured.memberId || memberId;

  if (!memberId) {
    console.error("Could not resolve a members row for this account.", ensured);
    process.exit(1);
  }

  const roleId = await syncMemberPrimaryRole(db, memberId, "Owner", "script:assign-owner");
  await db.collection("members").doc(memberId).set(
    {
      firebase_uid: userRecord.uid,
      work_email: email,
      status: "active",
      updated_at: new Date(),
      updated_by: "script:assign-owner",
    },
    { merge: true },
  );
  await alignMemberRoleTables(db, memberId, "script:assign-owner");

  const roleName = await resolveMemberRoleName(db, memberId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        email,
        uid: userRecord.uid,
        memberId,
        roleId,
        roleName,
        memberCreated: ensured.created,
        memberLinked: ensured.linked,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
