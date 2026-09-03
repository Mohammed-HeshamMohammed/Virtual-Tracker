import { FieldValue } from "firebase-admin/firestore";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import {
  resolveSecurityEmailRecipient,
  sendNewSignInAlertEmail,
} from "./security-notification-emails.js";
import { updateMemberPg } from "../../lib/postgres/members-postgres.service.js";

export function normalizeIp(ip) {
  const value = typeof ip === "string" ? ip.trim() : "";
  if (!value) return "";
  if (value === "::1" || value === "::ffff:127.0.0.1") return "127.0.0.1";
  return value;
}

export function summarizeUserAgent(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  if (!ua) return "Unknown device";

  let browser = "Browser";
  if (ua.includes("Edg/")) browser = "Microsoft Edge";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Safari/") && !ua.includes("Chrome/")) browser = "Safari";

  let os = "Unknown OS";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac OS X") || ua.includes("Macintosh")) os = "macOS";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Linux")) os = "Linux";

  return `${browser} on ${os}`;
}

export async function maybeNotifyNewSignIn(db, input) {
  const uid = input.uid;
  const userRecord = input.userRecord;
  const firebaseLastSignIn = userRecord.metadata?.lastSignInTime || null;
  if (!firebaseLastSignIn) return;

  const ref = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  const snap = await ref.get();
  const row = snap.exists ? snap.data() || {} : {};
  const seenSignIn =
    typeof row.securityAuthLastSignInTimeSeen === "string" ? row.securityAuthLastSignInTimeSeen : null;

  if (seenSignIn === firebaseLastSignIn) {
    return;
  }

  const prevIp = normalizeIp(typeof row.securityLastLoginIp === "string" ? row.securityLastLoginIp : "");
  const prevUa = typeof row.securityLastLoginUserAgent === "string" ? row.securityLastLoginUserAgent : "";
  const nextIp = normalizeIp(input.requestIp || "");
  const nextUa = typeof input.userAgent === "string" ? input.userAgent.slice(0, 512) : "";
  const signedInAt = new Date().toISOString();

  const isFirstTrackedSignIn = !seenSignIn;
  const locationChanged = Boolean(prevIp && nextIp && prevIp !== nextIp);
  const deviceChanged = Boolean(prevUa && nextUa && prevUa !== nextUa);

  await ref.set(
    {
      securityAuthLastSignInTimeSeen: firebaseLastSignIn,
      securityLastLoginIp: nextIp || prevIp || null,
      securityLastLoginUserAgent: nextUa || prevUa || null,
      securityLastLoginAt: signedInAt,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (isFirstTrackedSignIn || (!locationChanged && !deviceChanged)) {
    return;
  }

  const recipient = resolveSecurityEmailRecipient(input.profile, userRecord);
  if (!recipient.to) return;

  try {
    await sendNewSignInAlertEmail({
      to: recipient.to,
      recipientName: recipient.recipientName,
      ip: nextIp || "Unknown",
      deviceSummary: summarizeUserAgent(nextUa),
      signedInAt,
    });
  } catch (err) {
    logSafeWarn("[security-login-alerts] failed to send new sign-in email:", err);
  }
}

export async function syncMemberLastLoginIp(db, memberId, requestIp) {
  const memberKey = typeof memberId === "string" ? memberId.trim() : "";
  const ip = normalizeIp(requestIp);
  if (!memberKey || !ip) return;
  await updateMemberPg(memberKey, { ip_address: ip });
}

export async function notifyPasswordUpdated(auth, uid, reason, profile) {
  try {
    const userRecord = await auth.getUser(uid);
    const recipient = resolveSecurityEmailRecipient(profile, userRecord);
    if (!recipient.to) return;
    const { sendPasswordUpdatedEmail } = await import("./security-notification-emails.js");
    await sendPasswordUpdatedEmail({
      to: recipient.to,
      recipientName: recipient.recipientName,
      reason,
    });
  } catch (err) {
    logSafeWarn("[security-notification] password updated email failed:", err);
  }
}

export async function notifyPasswordUpdatedByEmail(auth, email, reason) {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalized) return;
  try {
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(normalized);
    } catch {
      return;
    }
    const { sendPasswordUpdatedEmail } = await import("./security-notification-emails.js");
    await sendPasswordUpdatedEmail({
      to: normalized,
      recipientName: userRecord.displayName || "there",
      reason,
    });
  } catch (err) {
    logSafeWarn("[security-notification] password updated email failed:", err);
  }
}
