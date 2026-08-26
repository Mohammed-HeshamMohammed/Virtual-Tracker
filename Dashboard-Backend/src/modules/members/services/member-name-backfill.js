import { query, isPostgresConfigured } from "../../../lib/postgres/client.js";
import { getAuthAdmin } from "../../../config/firebase.js";
import { logSafeWarn } from "../../../http/sanitize-error.js";
import { sanitizeMemberNamePart } from "./member-display-name.js";

/** SQL predicate: true when `column` is empty or holds nothing but the
 *  literal placeholder word - some earlier import/seed path appears to have
 *  written the literal string "Member" into first_name for a batch of rows,
 *  rather than leaving it blank, so a plain blank check alone misses them. */
function blankOrPlaceholder(column) {
  return `(TRIM(${column}) = '' OR LOWER(TRIM(${column})) = 'member')`;
}

/**
 * One-time-per-member catch-up, same shape as backfillMemberAvatarUrls: a
 * member row can end up with first_name, last_name, AND display_name all
 * blank (or holding nothing but the literal placeholder word) - seen on
 * accounts carried over from the Firestore-era data, where the name never
 * made it across - and every UI fallback for a nameless row bottoms out at a
 * placeholder forever, because there is nothing left in Postgres to read.
 *
 * Firebase Auth still has it, in one of two ways:
 *  - firebase_uid already set: look the account up directly.
 *  - firebase_uid blank (the member row was created by invite/import and has
 *    never actually been linked to a sign-in): look it up by email instead.
 *    This is the same match ensureMemberRowForUserRecord's own "link on
 *    first sign-in" branch uses, just run proactively rather than waiting for
 *    that member to sign in - a member invited by email may already have a
 *    Google/Firebase account under that address without ever having linked
 *    it to this org.
 *
 * For a Google sign-in, `displayName` (and the `google.com` provider's own
 * copy of it) is the name Google gave us at sign-up, independent of whatever
 * the Postgres/Firestore side lost. Deliberately does NOT link firebase_uid
 * onto the row when found by email - that carries real conflict-detection
 * logic (see ensureMemberRowForUserRecord's "email_uid_conflict" case) that
 * belongs to the actual sign-in flow, not a background sweep; this only
 * borrows the account's name.
 *
 * Even when no Firebase Auth account is found at all (by uid or by email),
 * the email's own local part still replaces the placeholder - matching the
 * last-resort fallback ensureMemberRowForUserRecord uses when creating a
 * member fresh, so nobody's row is left holding "Member" as if it were a name.
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
    `SELECT id, firebase_uid, work_email, personal_email FROM members
     WHERE ${blankOrPlaceholder("first_name")}
       AND ${blankOrPlaceholder("last_name")}
       AND ${blankOrPlaceholder("display_name")}
       AND (work_email <> '' OR personal_email <> '' OR firebase_uid <> '')`,
  );
  if (members.length === 0) return { checked: 0, updated: 0 };

  let updated = 0;
  for (const member of members) {
    try {
      const workEmail = member.work_email ?? "";
      const personalEmail = member.personal_email ?? "";
      const uid = member.firebase_uid ?? "";

      let userRecord = null;
      if (uid) {
        userRecord = await auth.getUser(uid).catch(() => null);
      }
      if (!userRecord) {
        for (const candidateEmail of [workEmail, personalEmail]) {
          if (!candidateEmail) continue;
          userRecord = await auth.getUserByEmail(candidateEmail).catch(() => null);
          if (userRecord) break;
        }
      }

      const googleIdentity = (userRecord?.providerData ?? []).find((p) => p.providerId === "google.com");
      const rawName = (userRecord?.displayName || googleIdentity?.displayName || "").trim();
      const parts = rawName ? rawName.split(/\s+/).filter(Boolean) : [];

      const anchorEmail = workEmail || personalEmail;
      let firstName = sanitizeMemberNamePart(parts[0] ?? "", anchorEmail);
      const lastName = sanitizeMemberNamePart(parts.length > 1 ? parts.slice(1).join(" ") : "", anchorEmail);
      if (!firstName) {
        // No usable name anywhere, including Google's own record - the email
        // local part is the same last resort ensureMemberRowForUserRecord
        // uses when creating a member fresh, so a backfilled row and a
        // freshly created one never disagree on what "no name" falls back to.
        const email = (userRecord?.email || anchorEmail || "").trim();
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
