import crypto from "node:crypto";
import { getEnv } from "../../../config/env/index.js";
import { assertValidPhone } from "../../../core/middleware/http/validate-body.js";
import { logSafeWarn } from "../../../core/middleware/http/sanitize-error.js";

const CHALLENGE_COLLECTION = "phone_verification_challenges";
const TOKEN_COLLECTION = "phone_verification_tokens";
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function normalizePhoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

export function phonesMatch(a, b) {
  const left = normalizePhoneDigits(a);
  const right = normalizePhoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 10 && right.length >= 10) {
    return left.slice(-10) === right.slice(-10);
  }
  return false;
}

function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomSixDigitCode() {
  return String(crypto.randomInt(100000, 999999));
}

export function isPhoneVerificationDevMode() {
  return getEnv().phoneVerification.devMode === true;
}

async function issuePhoneVerificationToken(db, phone, context = {}) {
  const normalizedPhone = assertValidPhone(phone, { required: true, label: "Phone number" });
  const token = crypto.randomUUID();
  const now = Date.now();

  await db.collection(TOKEN_COLLECTION).doc(token).set({
    token,
    phone: normalizedPhone,
    phone_digits: normalizePhoneDigits(normalizedPhone),
    uid: typeof context.uid === "string" ? context.uid : "",
    member_id: typeof context.memberId === "string" ? context.memberId : "",
    consumed: false,
    created_at: new Date(now),
    expires_at: new Date(now + TOKEN_TTL_MS),
  });

  return {
    verificationToken: token,
    phone: normalizedPhone,
    expiresInSeconds: Math.floor(TOKEN_TTL_MS / 1000),
  };
}

export async function sendPhoneVerificationCode(db, phone, context = {}) {
  if (!isPhoneVerificationDevMode()) {
    throw new Error("Phone verification uses Firebase SMS in this environment.");
  }
  const normalizedPhone = assertValidPhone(phone, { required: true, label: "Phone number" });
  const code = randomSixDigitCode();
  const challengeId = crypto.randomUUID();
  const now = Date.now();

  await db.collection(CHALLENGE_COLLECTION).doc(challengeId).set({
    id: challengeId,
    phone: normalizedPhone,
    phone_digits: normalizePhoneDigits(normalizedPhone),
    code_hash: hashValue(`${challengeId}:${code}`),
    uid: typeof context.uid === "string" ? context.uid : "",
    member_id: typeof context.memberId === "string" ? context.memberId : "",
    attempts: 0,
    created_at: new Date(now),
    expires_at: new Date(now + CHALLENGE_TTL_MS),
  });

  logSafeWarn(`[phone-verification] Code for ${normalizedPhone}: ${code}`);

  return {
    challengeId,
    expiresInSeconds: Math.floor(CHALLENGE_TTL_MS / 1000),
  };
}

export async function confirmPhoneVerificationCode(db, input) {
  if (!isPhoneVerificationDevMode()) {
    throw new Error("Phone verification uses Firebase SMS in this environment.");
  }
  const challengeId = typeof input.challengeId === "string" ? input.challengeId.trim() : "";
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!challengeId || !/^\d{6}$/.test(code)) {
    throw new Error("Enter the 6-digit verification code.");
  }

  const ref = db.collection(CHALLENGE_COLLECTION).doc(challengeId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Verification code expired. Request a new code.");
  }

  const row = snap.data() || {};
  const expiresAt = row.expires_at?.toDate?.() ?? new Date(row.expires_at || 0);
  if (expiresAt.getTime() < Date.now()) {
    await ref.delete().catch(() => {});
    throw new Error("Verification code expired. Request a new code.");
  }

  const attempts = typeof row.attempts === "number" ? row.attempts : 0;
  if (attempts >= MAX_ATTEMPTS) {
    throw new Error("Too many incorrect attempts. Request a new code.");
  }

  const expectedHash = typeof row.code_hash === "string" ? row.code_hash : "";
  const actualHash = hashValue(`${challengeId}:${code}`);
  if (expectedHash !== actualHash) {
    await ref.set({ attempts: attempts + 1 }, { merge: true });
    throw new Error("Incorrect verification code.");
  }

  const phone = typeof row.phone === "string" ? row.phone : "";
  await ref.delete().catch(() => {});

  return issuePhoneVerificationToken(db, phone, {
    uid: typeof row.uid === "string" ? row.uid : "",
    memberId: typeof row.member_id === "string" ? row.member_id : "",
  });
}

export async function exchangeFirebasePhoneVerification(db, authAdmin, input) {
  const idToken = typeof input.idToken === "string" ? input.idToken.trim() : "";
  if (!idToken) {
    throw new Error("Phone verification is incomplete.");
  }

  const normalizedPhone = assertValidPhone(input.phone, { required: true, label: "Phone number" });
  const decoded = await authAdmin.verifyIdToken(idToken);
  const firebasePhone = typeof decoded.phone_number === "string" ? decoded.phone_number : "";
  if (!firebasePhone.trim()) {
    throw new Error("Phone verification is incomplete.");
  }
  if (!phonesMatch(firebasePhone, normalizedPhone)) {
    throw new Error("Verified phone does not match the number entered.");
  }

  return issuePhoneVerificationToken(db, normalizedPhone, {
    uid: typeof input.uid === "string" ? input.uid.trim() : "",
    memberId: typeof input.memberId === "string" ? input.memberId : "",
  });
}

export async function assertPhoneVerificationToken(db, token, phone, options = {}) {
  const trimmedToken = typeof token === "string" ? token.trim() : "";
  const normalizedPhone = assertValidPhone(phone, { required: true, label: "Phone number" });
  if (!trimmedToken) {
    throw new Error("Verify your phone number before continuing.");
  }

  const ref = db.collection(TOKEN_COLLECTION).doc(trimmedToken);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Phone verification expired. Verify your phone number again.");
  }

  const row = snap.data() || {};
  const expiresAt = row.expires_at?.toDate?.() ?? new Date(row.expires_at || 0);
  if (expiresAt.getTime() < Date.now()) {
    await ref.delete().catch(() => {});
    throw new Error("Phone verification expired. Verify your phone number again.");
  }
  if (row.consumed === true) {
    throw new Error("Phone verification already used. Verify your phone number again.");
  }
  if (!phonesMatch(row.phone, normalizedPhone)) {
    throw new Error("Phone verification does not match the number entered.");
  }
  if (options.memberId) {
    const tokenMemberId = typeof row.member_id === "string" ? row.member_id.trim() : "";
    if (tokenMemberId !== options.memberId) {
      throw new Error("Only the member can verify their own phone number.");
    }
  }
  if (options.uid && typeof row.uid === "string" && row.uid && row.uid !== options.uid) {
    throw new Error("Only the member can verify their own phone number.");
  }

  if (options.consume !== false) {
    await ref.set({ consumed: true, consumed_at: new Date() }, { merge: true });
  }

  return normalizedPhone;
}

export function memberPhoneIsVerified(memberData) {
  return memberData?.phone_verified === true;
}

export function assertMemberPhoneVerifiedForUse(memberData, operationLabel = "This action") {
  const phone =
    (typeof memberData?.phone_number === "string" ? memberData.phone_number : "") ||
    (typeof memberData?.mobile === "string" ? memberData.mobile : "") ||
    (typeof memberData?.phone === "string" ? memberData.phone : "");
  if (!phone.trim()) return;
  if (!memberPhoneIsVerified(memberData)) {
    throw new Error(`${operationLabel} requires a verified phone number.`);
  }
}
