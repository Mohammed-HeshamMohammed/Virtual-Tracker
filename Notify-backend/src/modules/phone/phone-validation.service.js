import { parsePhoneNumberFromString } from "libphonenumber-js";

export function validatePhoneNumber(input) {
  const label = typeof input.label === "string" && input.label.trim() ? input.label.trim() : "Phone number";
  const required = input.required === true;
  const raw = typeof input.phone === "string" ? input.phone.trim() : "";

  if (!raw) {
    if (required) {
      throw new Error(`${label} is required.`);
    }
    return { valid: true, e164: null, phone: "" };
  }

  const defaultCountry = normalizeCountryCode(input.defaultCountry);
  const parsed = parsePhoneNumberFromString(raw, defaultCountry);

  if (!parsed || !parsed.isValid()) {
    throw new Error(`Enter a valid ${label.toLowerCase()}.`);
  }

  return {
    valid: true,
    e164: parsed.format("E.164"),
    nationalNumber: parsed.nationalNumber,
    countryCallingCode: parsed.countryCallingCode,
    country: parsed.country,
    nationalFormat: parsed.formatNational(),
    internationalFormat: parsed.formatInternational(),
  };
}

function normalizeCountryCode(value) {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}
