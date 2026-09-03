import { query, isPostgresConfigured } from "../../../lib/postgres/client.js";
import { getAuthAdmin } from "../../../config/firebase.js";
import { logSafeWarn } from "../../../http/sanitize-error.js";
import { sanitizeMemberNamePart } from "./member-display-name.js";

function blankOrPlaceholder(column) {
  return `(TRIM(${column}) = '' OR LOWER(TRIM(${column})) = 'member')`;
}

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
        const email = (userRecord?.email || anchorEmail || "").trim();
        firstName = email.includes("@") ? email.split("@")[0] : "";
      }
      if (!firstName) continue;

      const displayName = [firstName, lastName].filter(Boolean).join(" ");
      const written = await query(
        `UPDATE members SET first_name = $1, last_name = $2, display_name = $3
         WHERE id = $4
           AND ${blankOrPlaceholder("first_name")}
           AND ${blankOrPlaceholder("last_name")}
           AND ${blankOrPlaceholder("display_name")}
         RETURNING id`,
        [firstName, lastName, displayName, member.id],
      );
      if (written.length > 0) updated += 1;
    } catch (err) {
      logSafeWarn(`[member-name-backfill] skipping member ${member.id}:`, err);
    }
  }
  return { checked: members.length, updated };
}
