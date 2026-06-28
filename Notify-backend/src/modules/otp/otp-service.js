/**
 * OTP service — send / verify / exchange phone verification codes.
 * Ported from Dashboard-Backend/src/modules/auth/phone-verification.service.js.
 *
 * NOTE: This service does not hold Firebase Admin credentials.
 * - In dev mode (PHONE_VERIFICATION_DEV_MODE=true): codes are logged to console.
 * - In production: integrate an SMS provider (Twilio, Vonage, etc.) below.
 * - Firebase phone auth flow (exchangeFirebasePhoneVerification) requires the
 *   Dashboard-Backend to verify the ID token and then call POST /api/notify/otp/exchange.
 */
import crypto from "node:crypto";
import { getEnv } from "../../config/env.js";

const CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 min
const TOKEN_TTL_MS = 15 * 60 * 1000;     // 15 min
const MAX_ATTEMPTS = 5;

// In-memory store — replace with Redis or Firestore for multi-instance deployments.
/** @type {Map<string, {phone:string; codeHash:string; uid:string; memberId:string; attempts:number; expiresAt:number}>} */
const challenges = new Map();
/** @type {Map<string, {phone:string; uid:string; memberId:string; consumed:boolean; expiresAt:number}>} */
const tokens = new Map();

function randomSixDigitCode() {
  return String(crypto.randomInt(100000, 999999));
}

function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizePhoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

export function phonesMatch(a, b) {
  const left = normalizePhoneDigits(a);
  const right = normalizePhoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 10 && right.length >= 10) return left.slice(-10) === right.slice(-10);
  return false;
}

export function isPhoneVerificationDevMode() {
  return getEnv().phoneVerification.devMode === true;
}

/**
 * Send a phone verification OTP.
 * @param {{ phone: string; uid?: string; memberId?: string }} input
 * @returns {{ challengeId: string; expiresInSeconds: number }}
 */
export async function sendPhoneVerificationCode(input) {
  const phone = normalizePhone(input.phone);
  const code = randomSixDigitCode();
  const challengeId = crypto.randomUUID();

  challenges.set(challengeId, {
    phone,
    codeHash: hashValue(`${challengeId}:${code}`),
    uid: input.uid || "",
    memberId: input.memberId || "",
    attempts: 0,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });

  if (isPhoneVerificationDevMode()) {
    console.warn(`[otp] Code for ${phone}: ${code} (challengeId=${challengeId})`);
  } else {
    // TODO: Integrate SMS provider here, e.g.:
    // await twilioClient.messages.create({ to: phone, from: SMS_FROM, body: `Your code is ${code}` });
    throw new Error("SMS provider not configured. Set PHONE_VERIFICATION_DEV_MODE=true for local testing.");
  }

  return { challengeId, expiresInSeconds: Math.floor(CHALLENGE_TTL_MS / 1000) };
}

/**
 * Verify OTP code and issue a short-lived verification token.
 * @param {{ challengeId: string; code: string }} input
 */
export async function confirmPhoneVerificationCode(input) {
  const challengeId = typeof input.challengeId === "string" ? input.challengeId.trim() : "";
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!challengeId || !/^\d{6}$/.test(code)) {
    throw new Error("Enter the 6-digit verification code.");
  }

  const challenge = challenges.get(challengeId);
  if (!challenge) throw new Error("Verification code expired. Request a new code.");
  if (challenge.expiresAt < Date.now()) {
    challenges.delete(challengeId);
    throw new Error("Verification code expired. Request a new code.");
  }
  if (challenge.attempts >= MAX_ATTEMPTS) throw new Error("Too many incorrect attempts. Request a new code.");

  const actualHash = hashValue(`${challengeId}:${code}`);
  if (challenge.codeHash !== actualHash) {
    challenge.attempts += 1;
    throw new Error("Incorrect verification code.");
  }

  challenges.delete(challengeId);
  return issueToken(challenge.phone, challenge.uid, challenge.memberId);
}

/**
 * Exchange a verified phone token — called after Firebase SMS phone auth.
 * Dashboard-Backend verifies the Firebase ID token, then calls this endpoint.
 *
 * @param {{ phone: string; uid?: string; memberId?: string }} input
 */
export async function exchangePhoneVerification(input) {
  const phone = normalizePhone(input.phone);
  return issueToken(phone, input.uid || "", input.memberId || "");
}

function issueToken(phone, uid, memberId) {
  const token = crypto.randomUUID();
  tokens.set(token, {
    phone,
    uid,
    memberId,
    consumed: false,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return { verificationToken: token, phone, expiresInSeconds: Math.floor(TOKEN_TTL_MS / 1000) };
}

function normalizePhone(raw) {
  if (!raw || typeof raw !== "string") throw new Error("Phone number is required.");
  const digits = normalizePhoneDigits(raw.trim());
  if (digits.length < 7) throw new Error("Invalid phone number.");
  return raw.trim();
}
