import { notifyRequest } from "./notify-request.js";

export async function validatePhoneViaNotify(phone, options = {}) {
  let response;
  let payload;
  try {
    ({ response, payload } = await notifyRequest("/api/notify/phone/validate", {
      phone,
      required: options.required === true,
      label: options.label,
      defaultCountry: options.defaultCountry,
    }));
  } catch {
    throw new Error("Phone validation is temporarily unavailable.");
  }

  if (!response.ok || payload?.success !== true) {
    const message =
      typeof payload?.error === "string" && payload.error.trim()
        ? payload.error
        : "Enter a valid phone number.";
    throw new Error(message);
  }

  const data = payload.data;
  if (!data || data.e164 === null || data.e164 === undefined) {
    return "";
  }
  return typeof data.e164 === "string" ? data.e164 : "";
}
