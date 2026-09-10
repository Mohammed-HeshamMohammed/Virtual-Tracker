/**
 * The currency to show a report in, worked out from where the viewer is.
 *
 * Nobody should have to configure this. The browser already knows the region
 * the person is in - twice over, in fact - so someone opening the dashboard in
 * Cairo sees Egyptian pounds and someone in London sees sterling, without a
 * setting or a toggle.
 *
 * Two signals, because each has a blind spot:
 *
 *  - **Locale** (`en-EG`, `ar-EG`) is the region the browser is configured for.
 *    Accurate when set, but a great many people run a bare `en-US` or `en-GB`
 *    locale from anywhere in the world.
 *  - **Timezone** (`Africa/Cairo`) reflects where the machine actually is, and
 *    is almost always right, but maps to a region only through a table.
 *
 * Timezone is trusted first for exactly that reason: a laptop set to `en-US`
 * sitting in Cairo is far more common than the reverse, and the clock is the
 * signal that had to be set correctly for anything else to work.
 *
 * Whatever comes out is only a *request*. The server honours it only if it
 * holds a rate for that currency, and falls back to the workspace currency
 * otherwise - so a wrong guess here degrades to the org default rather than to
 * an unconvertible report.
 */

/** IANA zone prefix -> ISO 3166 region. Only zones whose region is unambiguous
 *  from the identifier; anything else falls through to the locale. */
const ZONE_REGION: Record<string, string> = {
  "Africa/Cairo": "EG",
  "Africa/Algiers": "DZ",
  "Africa/Casablanca": "MA",
  "Africa/Johannesburg": "ZA",
  "Africa/Lagos": "NG",
  "Africa/Nairobi": "KE",
  "Africa/Tunis": "TN",
  "America/Argentina": "AR",
  "America/Bogota": "CO",
  "America/Mexico_City": "MX",
  "America/Sao_Paulo": "BR",
  "America/Santiago": "CL",
  "America/Lima": "PE",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Edmonton": "CA",
  "America/Winnipeg": "CA",
  "America/Halifax": "CA",
  "Asia/Dubai": "AE",
  "Asia/Riyadh": "SA",
  "Asia/Qatar": "QA",
  "Asia/Kuwait": "KW",
  "Asia/Bahrain": "BH",
  "Asia/Muscat": "OM",
  "Asia/Amman": "JO",
  "Asia/Beirut": "LB",
  "Asia/Baghdad": "IQ",
  "Asia/Jerusalem": "IL",
  "Asia/Tehran": "IR",
  "Asia/Karachi": "PK",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Dhaka": "BD",
  "Asia/Colombo": "LK",
  "Asia/Kathmandu": "NP",
  "Asia/Bangkok": "TH",
  "Asia/Jakarta": "ID",
  "Asia/Manila": "PH",
  "Asia/Singapore": "SG",
  "Asia/Kuala_Lumpur": "MY",
  "Asia/Ho_Chi_Minh": "VN",
  "Asia/Saigon": "VN",
  "Asia/Hong_Kong": "HK",
  "Asia/Taipei": "TW",
  "Asia/Shanghai": "CN",
  "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR",
  "Asia/Istanbul": "TR",
  "Europe/Istanbul": "TR",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Lisbon": "PT",
  "Europe/Madrid": "ES",
  "Europe/Paris": "FR",
  "Europe/Brussels": "BE",
  "Europe/Amsterdam": "NL",
  "Europe/Berlin": "DE",
  "Europe/Rome": "IT",
  "Europe/Vienna": "AT",
  "Europe/Zurich": "CH",
  "Europe/Athens": "GR",
  "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK",
  "Europe/Helsinki": "FI",
  "Europe/Warsaw": "PL",
  "Europe/Prague": "CZ",
  "Europe/Budapest": "HU",
  "Europe/Bucharest": "RO",
  "Europe/Kiev": "UA",
  "Europe/Kyiv": "UA",
  "Europe/Moscow": "RU",
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Perth": "AU",
  "Pacific/Auckland": "NZ",
}

/** ISO 3166 region -> ISO 4217 currency, for the regions above. */
const REGION_CURRENCY: Record<string, string> = {
  AE: "AED", AR: "ARS", AT: "EUR", AU: "AUD", BD: "BDT", BE: "EUR", BH: "BHD",
  BR: "BRL", CA: "CAD", CH: "CHF", CL: "CLP", CN: "CNY", CO: "COP", CZ: "CZK",
  DE: "EUR", DK: "DKK", DZ: "DZD", EG: "EGP", ES: "EUR", FI: "EUR", FR: "EUR",
  GB: "GBP", GR: "EUR", HK: "HKD", HU: "HUF", ID: "IDR", IE: "EUR", IL: "ILS",
  IN: "INR", IQ: "IQD", IR: "IRR", IT: "EUR", JO: "JOD", JP: "JPY", KE: "KES",
  KR: "KRW", KW: "KWD", LB: "LBP", LK: "LKR", MA: "MAD", MX: "MXN", MY: "MYR",
  NG: "NGN", NL: "EUR", NO: "NOK", NP: "NPR", NZ: "NZD", OM: "OMR", PE: "PEN",
  PH: "PHP", PK: "PKR", PL: "PLN", PT: "EUR", QA: "QAR", RO: "RON", RU: "RUB",
  SA: "SAR", SE: "SEK", SG: "SGD", TH: "THB", TN: "TND", TR: "TRY", TW: "TWD",
  UA: "UAH", US: "USD", VN: "VND", ZA: "ZAR",
}

function regionFromTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone) return null
    if (ZONE_REGION[zone]) return ZONE_REGION[zone]
    // "America/Argentina/Buenos_Aires" and friends: match the longest prefix.
    const prefix = Object.keys(ZONE_REGION).find((key) => zone.startsWith(`${key}/`))
    return prefix ? ZONE_REGION[prefix] : null
  } catch {
    return null
  }
}

function regionFromLocale(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || navigator.language
    if (!locale) return null
    // `new Intl.Locale` is not in every runtime this ships to, so parse the
    // subtag directly: the region is the two-letter part of e.g. "ar-EG".
    const region = locale.split("-").find((part) => /^[A-Z]{2}$/.test(part.toUpperCase()) && part.length === 2)
    return region ? region.toUpperCase() : null
  } catch {
    return null
  }
}

/**
 * The viewer's likely currency, or null when their location says nothing
 * useful - in which case the caller sends nothing and gets the org default.
 */
export function resolveViewerCurrency(): string | null {
  const region = regionFromTimezone() ?? regionFromLocale()
  return region ? (REGION_CURRENCY[region] ?? null) : null
}

/** Formats money in the viewer's own locale, so separators and symbol
 *  placement read naturally rather than always looking American. */
export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      currencyDisplay: "narrowSymbol",
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}
