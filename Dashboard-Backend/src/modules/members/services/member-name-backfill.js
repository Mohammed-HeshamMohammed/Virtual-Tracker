import { query, isPostgresConfigured } from "../../../lib/postgres/client.js";
import { getAuthAdmin } from "../../../config/firebase.js";
import { logSafeWarn } from "../../../http/sanitize-error.js";
import { sanitizeMemberNamePart } from "./member-display-name.js";

/**
 * One-time-per-member catch-up, same shape as backfillMemberAvatarUrls: a
 * member row can end up with first_name, last_name, AND display_name all
 * blank - seen on accounts carried over from the Firestore-era data, where
 * the name never made it across - and every UI fallback for a nameless row
 * bottoms out at a placeholder ("Member"/"Unknown Member") forever, because
 * there is nothing left in Postgres to read.
 *
 * Firebase Auth still has it: for a Google sign-in, `displayName` (and the
 * `google.com` provider's own copy of it) is the name Google gave us at
 * sign-up, independent of whatever the Postgres/Firestore side lost. This
 * looks it up and writes it back, so the row is actually fixed at rest -
 * every other reader (activity, reports, teams, exports) gets the real name
 * too, not just the one place this response happens to touch.
 *
 * Run at boot (like ensure-lookup-schema.js / backfillMemberAvatarUrls)
 * rather than a one-off script, so it is covered by the no-manual-migration
 * deploy flow. Only queries members still missing every name field, so once
 * everyone is caught up it is a cheap empty read on every future boot.
 */
export async function backfillMemberDisplayNames() {
  if (!isPostgresConfigured()) return { checked: 0, updated: 0 };
  const auth = getAuthAdmin();
  if (!auth) return { checked: 0, updated: 0 };

  const members = await query(
    `SELECT id, firebase_uid, work_email FROM members
     WHERE firebase_uid <> '' AND TRIM(first_name) = '' AND TRIM(last_name) = '' AND TRIM(display_name) = ''`,
  );
  if (members.length === 0) return { checked: 0, updated: 0 };

  let updated = 0;
  for (const member of members) {
    try {
      const userRecord = await auth.getUser(member.firebase_uid);
      const googleIdentity = (userRecord.providerData ?? []).find((p) => p.providerId === "google.com");
      const rawName = (userRecord.displayName || googleIdentity?.displayName || "").trim();
      const parts = rawName ? rawName.split(/\s+/).filter(Boolean) : [];

      const workEmail = member.work_email ?? "";
      let firstName = sanitizeMemberNamePart(parts[0] ?? "", workEmail);
      const lastName = sanitizeMemberNamePart(parts.length > 1 ? parts.slice(1).join(" ") : "", workEmail);
      if (!firstName) {
        // No usable name anywhere, including Google's own record - the email
        // local part is the same last resort ensureMemberRowForUserRecord
        // uses when creating a member fresh, so a backfilled row and a
        // freshly created one never disagree on what "no name" falls back to.
        const email = (userRecord.email || workEmail || "").trim();
        firstName = email.includes("@") ? email.split("@")[0] : "";
      }
      if (!firstName) continue; // Truly nothing to backfill with; leave for next boot.

      const displayName = [firstName, lastName].filter(Boolean).join(" ");
      await query("UPDATE members SET first_name = $1, last_name = $2, display_name = $3 WHERE id = $4", [
        firstName,
        lastName,
        displayName,
        member.id,
      ]);
      updated += 1;
    } catch (err) {
      logSafeWarn(`[member-name-backfill] skipping member ${member.id}:`, err);
    }
  }
  return { checked: members.length, updated };
}
