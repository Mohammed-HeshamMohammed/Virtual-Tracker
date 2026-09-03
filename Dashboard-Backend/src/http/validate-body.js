const snakeToCamel = (input) => input.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

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

export function rejectUnknownEntityFields(body, entityFields, extraAllowed = []) {
  const allowed = new Set([
    ...Object.keys(entityFields),
    ...Object.keys(entityFields).map(snakeToCamel),
    ...extraAllowed,
  ]);
  rejectUnknownFields(body, [...allowed]);
}

export function assertMaxLength(value, maxLen, fieldName) {
  if (typeof value !== "string") return;
  if (value.length > maxLen) {
    throw new Error(`${fieldName} must be at most ${maxLen} characters`);
  }
}

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
