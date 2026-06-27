const snakeToCamel = (input) => input.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/**
 * Reject requests that include properties outside an explicit allowlist.
 * Prevents mass-assignment / privilege-escalation via unexpected JSON keys.
 *
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
 * @param {{ required?: boolean, label?: string }} [options]
 * @returns {string}
 */
export function assertValidPhone(value, options = {}) {
  const { required = false, label = "Phone number" } = options;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    if (required) throw new Error(`${label} is required.`);
    return "";
  }
  assertMaxLength(trimmed, 40, label);
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) {
    throw new Error(`Enter a valid ${label.toLowerCase()}.`);
  }
  if (!/^[\d\s\-+().]+$/.test(trimmed)) {
    throw new Error(`Enter a valid ${label.toLowerCase()}.`);
  }
  return trimmed;
}
