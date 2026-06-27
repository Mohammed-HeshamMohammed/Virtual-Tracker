/**
 * Mark a Firebase Auth user's email as verified (local dev / support).
 *
 * Usage:
 *   npm run verify-user-email -- someone@example.com
 */

import { getAuthAdmin } from "../src/config/firebase.js";

function parseEmailArg() {
  const arg = process.argv.slice(2).find((value) => value && value.includes("@"));
  if (!arg) {
    console.error("Usage: npm run verify-user-email -- recipient@example.com");
    process.exit(1);
  }
  return arg.trim().toLowerCase();
}

async function main() {
  const email = parseEmailArg();
  const auth = getAuthAdmin();
  if (!auth) {
    console.error("Firebase Admin is not configured.");
    process.exit(1);
  }

  const userRecord = await auth.getUserByEmail(email);
  if (userRecord.emailVerified) {
    console.log(JSON.stringify({ ok: true, email, uid: userRecord.uid, emailVerified: true, changed: false }, null, 2));
    return;
  }

  await auth.updateUser(userRecord.uid, { emailVerified: true });
  console.log(
    JSON.stringify(
      { ok: true, email, uid: userRecord.uid, emailVerified: true, changed: true },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
