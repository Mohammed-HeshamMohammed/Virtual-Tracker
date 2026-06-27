/**
 * Adds missing profile image fields to all `User_profiles` documents (idempotent).
 *
 * Usage:
 *   npm run migrate:profile-images
 */

import { ensureUserProfileImageFields } from "../src/modules/auth/migrate-profile-image-fields.js";

async function main() {
  const result = await ensureUserProfileImageFields();
  if (!result.success) {
    console.error("[migrate:profile-images] Failed:", result.reason ?? "unknown");
    process.exitCode = 1;
    return;
  }
  if (result.alreadyCompleted) {
    console.info("[migrate:profile-images] Already completed — no changes needed.");
    return;
  }
  console.info(`[migrate:profile-images] Updated ${result.updated ?? 0} profile document(s).`);
}

main().catch((err) => {
  console.error("[migrate:profile-images]", err);
  process.exitCode = 1;
});
