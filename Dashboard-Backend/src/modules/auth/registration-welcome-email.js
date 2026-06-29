import { FieldValue } from "firebase-admin/firestore";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import { resolveAppPublicUrl } from "./app-public-url.js";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

const PENDING_AUTH = "pending_auth_members";

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} uid
 */
async function shouldSkipRegistrationWelcome(db, uid) {
  const pending = await db.collection(PENDING_AUTH).doc(uid).get();
  if (pending.exists) return true;

  const memberSnap = await db.collection("members").where("firebase_uid", "==", uid).limit(1).get();
  if (!memberSnap.empty) {
    const createdBy = typeof memberSnap.docs[0].data()?.created_by === "string" ? memberSnap.docs[0].data().created_by : "";
    if (createdBy === "invite-preprovision") return true;
  }

  return false;
}

/**
 * Sends a one-time welcome email after the user's email address is verified.
 * Idempotent via `registrationWelcomeEmailSentAt` on User_profiles.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {import("firebase-admin/auth").Auth} auth
 * @param {{ uid?: string; email?: string }} input
 * @returns {Promise<{ sent: boolean; skipped?: string; channel?: string }>}
 */
export async function maybeSendRegistrationWelcomeEmail(db, auth, input = {}) {
  const uidFromInput = typeof input.uid === "string" ? input.uid.trim() : "";
  const emailFromInput = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";

  let uid = uidFromInput;
  let userRecord;
  try {
    if (uid) {
      userRecord = await auth.getUser(uid);
    } else if (emailFromInput) {
      userRecord = await auth.getUserByEmail(emailFromInput);
      uid = userRecord.uid;
    } else {
      return { sent: false, skipped: "missing_identity" };
    }
  } catch {
    return { sent: false, skipped: "user_not_found" };
  }

  if (!userRecord.emailVerified) {
    return { sent: false, skipped: "email_not_verified" };
  }

  const email = typeof userRecord.email === "string" ? userRecord.email.trim().toLowerCase() : "";
  if (!email) {
    return { sent: false, skipped: "no_email" };
  }

  if (await shouldSkipRegistrationWelcome(db, uid)) {
    return { sent: false, skipped: "preprovision_pending" };
  }

  const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  const profileSnap = await profileRef.get();
  const profileRow = profileSnap.exists ? profileSnap.data() || {} : {};
  if (profileRow.registrationWelcomeEmailSentAt) {
    return { sent: false, skipped: "already_sent" };
  }

  const displayName =
    (typeof userRecord.displayName === "string" && userRecord.displayName.trim()) ||
    [profileRow.firstName, profileRow.lastName].filter((part) => typeof part === "string" && part.trim()).join(" ").trim() ||
    email.split("@")[0] ||
    "there";

  const delivery = await sendEmailViaNotify("registration-welcome", {
    email,
    displayName,
    signInUrl: resolveAppPublicUrl(),
  });

  if (delivery.sent) {
    await profileRef.set(
      {
        registrationWelcomeEmailSentAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { sent: true, channel: delivery.channel };
  }

  logSafeWarn("[registration-welcome-email] delivery failed:", delivery.error || delivery.channel);
  return { sent: false, skipped: "delivery_failed", channel: delivery.channel };
}
