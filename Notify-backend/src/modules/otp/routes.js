/**
 * OTP routes — /api/notify/otp/*
 */
import { sendJson } from "../../http/response.js";
import { requireInternalAuth } from "../../http/internal-auth.js";
import {
  sendPhoneVerificationCode,
  confirmPhoneVerificationCode,
  exchangePhoneVerification,
} from "./otp-service.js";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeOtp(req, res, url, origin) {
  if (!url.pathname.startsWith("/api/notify/otp")) return false;

  if (!requireInternalAuth(req, res, origin)) return true;

  const body = await readBody(req);

  // POST /api/notify/otp/send
  if (url.pathname === "/api/notify/otp/send" && req.method === "POST") {
    try {
      const result = await sendPhoneVerificationCode({
        phone: body.phone,
        uid: body.uid,
        memberId: body.memberId,
      });
      sendJson(res, origin, 200, { success: true, ...result });
    } catch (err) {
      sendJson(res, origin, 400, { success: false, error: err instanceof Error ? err.message : "Failed" });
    }
    return true;
  }

  // POST /api/notify/otp/verify
  if (url.pathname === "/api/notify/otp/verify" && req.method === "POST") {
    try {
      const result = await confirmPhoneVerificationCode({
        challengeId: body.challengeId,
        code: body.code,
      });
      sendJson(res, origin, 200, { success: true, ...result });
    } catch (err) {
      sendJson(res, origin, 400, { success: false, error: err instanceof Error ? err.message : "Failed" });
    }
    return true;
  }

  // POST /api/notify/otp/exchange
  if (url.pathname === "/api/notify/otp/exchange" && req.method === "POST") {
    try {
      const result = await exchangePhoneVerification({
        phone: body.phone,
        uid: body.uid,
        memberId: body.memberId,
      });
      sendJson(res, origin, 200, { success: true, ...result });
    } catch (err) {
      sendJson(res, origin, 400, { success: false, error: err instanceof Error ? err.message : "Failed" });
    }
    return true;
  }

  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}
