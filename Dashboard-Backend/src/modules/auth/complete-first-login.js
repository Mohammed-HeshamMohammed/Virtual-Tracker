import { FieldValue } from "firebase-admin/firestore";
import { readFirebaseWebConfigFromEnv } from "../../config/firebase.js";
import { validateRegistrationPassword } from "../../http/password-validation.js";
import { normalizePasswordInput } from "../../http/password-request-guard.js";
import { USER_PROFILES_COLLECTION } from "./profile-collection-name.js";
import { upsertProfileFromUserRecord } from "./profile-sync.js";
import { promotePendingMemberCore } from "../members/routes/member-invites.routes.js";
import { notifyPasswordUpdated } from "./security-login-alerts.js";

async function verifyCurrentPasswordWithFirebaseWebApi(email, password) {
  const web = readFirebaseWebConfigFromEnv();
  if (!web.apiKey) {
    throw new Error("Server is not configured to verify passwords.");
  }
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(web.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  return res.ok;
}

export async function completeFirstLoginPasswordChange(db, auth, uid, body) {
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  if (!currentPassword.trim()) {
    throw Object.assign(new Error("Current password is required."), { status: 400 });
  }

  const inputError = normalizePasswordInput(newPassword);
  if (inputError) {
    throw Object.assign(new Error(inputError), { status: 400 });
  }

  const validation = await validateRegistrationPassword(newPassword, {
    confirmPassword,
    requireConfirm: true,
  });
  if (!validation.valid) {
    throw Object.assign(new Error(validation.error ?? "Password does not meet security requirements."), {
      status: 400,
    });
  }

  const profileRef = db.collection(USER_PROFILES_COLLECTION).doc(uid);
  const profileSnap = await profileRef.get();
  const profileData = profileSnap.exists ? profileSnap.data() || {} : {};
  const mustChange =
    profileData.must_change_password === true || profileData.mustChangePassword === true;
  if (!mustChange) {
    throw Object.assign(new Error("Password change is not required for this account."), { status: 403 });
  }

  const userRecord = await auth.getUser(uid);
  const email = typeof userRecord.email === "string" ? userRecord.email.trim().toLowerCase() : "";
  if (!email) {
    throw Object.assign(new Error("Account has no email for password verification."), { status: 400 });
  }

  const currentOk = await verifyCurrentPasswordWithFirebaseWebApi(email, currentPassword);
  if (!currentOk) {
    throw Object.assign(new Error("Current password is incorrect."), { status: 401 });
  }

  await auth.updateUser(uid, { password: newPassword, emailVerified: true });
  await auth.revokeRefreshTokens(uid);

  const result = await promotePendingMemberCore(db, auth, uid);

  await profileRef.set(
    {
      must_change_password: false,
      mustChangePassword: false,
      first_login: false,
      firstLogin: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const profile = result.profile ?? (await upsertProfileFromUserRecord(db, await auth.getUser(uid)));
  void notifyPasswordUpdated(auth, uid, "changed", profile);
  return { promoted: result.promoted, memberId: result.memberId ?? null, profile };
}
