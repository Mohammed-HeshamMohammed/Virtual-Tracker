/**
 * Server-side session authorization — single source of truth for sign-in eligibility.
 * @see Client-Trial-V0.1/docs/Engineering Constitution.md (Never Trust the Client)
 */

import { assertMemberNotBanned } from "../members/services/member-ban-service.js";

/**
 * @param {import("firebase-admin/auth").UserRecord} userRecord
 */
export function isPasswordProviderUser(userRecord) {
  const providers = Array.isArray(userRecord.providerData) ? userRecord.providerData : [];
  return providers.some((p) => p && p.providerId === "password");
}

/**
 * Admin-created accounts skip inbox verification; they prove access via temp password + first-login change.
 *
 * @param {Record<string, unknown> | null | undefined} memberData
 */
export function isAdminPreprovisionedMember(memberData) {
  return (
    memberData &&
    typeof memberData === "object" &&
    typeof memberData.created_by === "string" &&
    memberData.created_by === "invite-preprovision"
  );
}

/**
 * Invite registration already proved email ownership for address-locked invites.
 * Legacy `self-invite` rows without `registration_invite_kind` predate open-link invites
 * and never received a verification email — treat them as verified at registration.
 *
 * @param {Record<string, unknown> | null | undefined} memberData
 */
export function isEmailConfirmedInviteMember(memberData) {
  if (!memberData || typeof memberData !== "object") return false;
  if (typeof memberData.created_by !== "string" || memberData.created_by !== "self-invite") {
    return false;
  }
  const inviteKind =
    typeof memberData.registration_invite_kind === "string"
      ? memberData.registration_invite_kind.trim().toLowerCase()
      : "";
  if (inviteKind === "open_link") return false;
  return inviteKind === "email" || inviteKind === "";
}

/**
 * @param {import("firebase-admin/auth").UserRecord} userRecord
 * @param {{ mustChangePassword?: boolean; memberData?: Record<string, unknown> | null }} [options]
 */
export function requiresEmailVerification(userRecord, options = {}) {
  const mustChangePassword = options.mustChangePassword === true;
  if (mustChangePassword) return false;
  if (!isPasswordProviderUser(userRecord)) return false;
  if (userRecord.emailVerified) return false;
  if (isAdminPreprovisionedMember(options.memberData)) return false;
  if (isEmailConfirmedInviteMember(options.memberData)) return false;
  return true;
}

/**
 * @param {{
 *   userRecord: import("firebase-admin/auth").UserRecord;
 *   memberId?: string | null;
 *   memberData?: Record<string, unknown> | null;
 *   profile?: Record<string, unknown> | null;
 *   memberBootstrapSkipped?: string;
 *   db?: import("firebase-admin/firestore").Firestore | null;
 * }} input
 */
export async function validateSessionAuthorization(input) {
  const { userRecord, memberId, memberData, profile, memberBootstrapSkipped, db } = input;

  if (userRecord.disabled) {
    return {
      ok: false,
      status: 403,
      code: "ACCOUNT_DISABLED",
      error: "This account has been disabled. Contact your administrator.",
    };
  }

  const mustChangePassword =
    profile?.must_change_password === true || profile?.mustChangePassword === true;
  const pendingAuth = memberBootstrapSkipped === "pending_auth";

  if (requiresEmailVerification(userRecord, { mustChangePassword, memberData })) {
    return {
      ok: false,
      status: 403,
      code: "EMAIL_NOT_VERIFIED",
      error: "Email verification is required before signing in. Check your inbox for the verification link.",
    };
  }

  if (!memberId && !pendingAuth && !mustChangePassword) {
    return {
      ok: false,
      status: 403,
      code: "NO_MEMBER_PROFILE",
      error: "No member profile is linked to this account. Contact your administrator.",
    };
  }

  if (memberData && typeof memberData === "object") {
    const status = typeof memberData.status === "string" ? memberData.status.trim().toLowerCase() : "";
    if (status === "banned") {
      return {
        ok: false,
        status: 403,
        code: "ACCOUNT_BANNED",
        error: "Your access to Virtual Tracker has been restricted. If you believe this was a mistake, contact support.",
      };
    }
    if (status && status !== "active" && status !== "pending_auth") {
      return {
        ok: false,
        status: 403,
        code: "ACCOUNT_INACTIVE",
        error: "This account is not active. Contact your administrator.",
      };
    }
  }

  if (db) {
    const banGate = await assertMemberNotBanned(db, {
      email: userRecord.email || "",
      memberId: memberId || "",
      firebaseUid: userRecord.uid,
    });
    if (!banGate.ok) {
      return {
        ok: false,
        status: banGate.status,
        code: banGate.code,
        error: banGate.error,
      };
    }
  }

  return { ok: true };
}
