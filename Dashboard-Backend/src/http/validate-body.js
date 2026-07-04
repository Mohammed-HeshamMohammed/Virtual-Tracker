const snakeToCamel = (input) => input.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/**
 * Reject JSON keys outside the allowlist (blocks mass-assignment).
 * @param {unknown} body
 * @param {string[]} allowedKeys
 */
export function rejectUnknownFields(body, allowedKeys) {
  if (body === null || body === undefined) return;
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object");
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new Error(`Unexpected field: ${key}`);
    }
  }
}

/**
 * @param {unknown} body
 * @param {Record<string, string>} entityFields
 * @param {string[]} [extraAllowed]
 */
export function rejectUnknownEntityFields(body, entityFields, extraAllowed = []) {
  const allowed = new Set([
    ...Object.keys(entityFields),
    ...Object.keys(entityFields).map(snakeToCamel),
    ...extraAllowed,
  ]);
  rejectUnknownFields(body, [...allowed]);
}

/**
 * @param {unknown} value
 * @param {number} maxLen
 * @param {string} fieldName
 */
export function assertMaxLength(value, maxLen, fieldName) {
  if (typeof value !== "string") return;
  if (value.length > maxLen) {
    throw new Error(`${fieldName} must be at most ${maxLen} characters`);
  }
}

/**
 * @param {unknown} value
 * @param {{ required?: boolean, label?: string, defaultCountry?: string }} [options]
 * @returns {Promise<string>} E.164 formatted phone, or empty string when optional and blank
 */
export async function assertValidPhone(value, options = {}) {
  const { required = false, label = "Phone number" } = options;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    if (required) throw new Error(`${label} is required.`);
    return "";
  }
  assertMaxLength(trimmed, 40, label);
  const { validatePhoneViaNotify } = await import("../lib/notify/phone-validation-client.js");
  return validatePhoneViaNotify(trimmed, options);
}
