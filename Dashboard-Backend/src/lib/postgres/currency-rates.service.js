import { query } from "./client.js";
import { normalizeCurrency } from "../currency/convert.js";

/**
 * Storage for daily exchange rates and the workspace's display currency.
 *
 * Rates are kept per day rather than as a single "current rate" row so that a
 * report of a past period converts at the rate that applied then - see the
 * reasoning in lib/currency/convert.js. That makes this table append-only in
 * practice: a day's rate is written once and then only ever corrected by hand.
 */

const CURRENCY_RE = /^[A-Z]{3}$/;

export function isValidCurrencyCode(value) {
  return CURRENCY_RE.test(normalizeCurrency(value));
}

/**
 * Every rate needed to convert anything in `[fromDay, toDay]`.
 *
 * The window reaches back before `fromDay` deliberately: feeds skip weekends
 * and holidays, and a fetch can fail, so the rate that applies to the first
 * day of a range was often published before it. One extra row per currency is
 * enough - `buildRateBook` only ever needs the latest rate on or before a day.
 */
export async function getRatesForRangePg({ fromDay, toDay, base = "USD" }) {
  const rows = await query(
    `(
       SELECT day, quote, rate FROM currency_rates
       WHERE base = $3 AND day >= $1::date AND day <= $2::date
     )
     UNION ALL
     (
       -- The last rate before the range, per currency, so day one converts.
       SELECT DISTINCT ON (quote) day, quote, rate FROM currency_rates
       WHERE base = $3 AND day < $1::date
       ORDER BY quote, day DESC
     )`,
    [fromDay, toDay, normalizeCurrency(base)],
  );
  return rows.map((r) => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
    quote: r.quote,
    rate: Number(r.rate),
  }));
}

/** Currencies we hold any rate for, so the API can say what it can convert. */
export async function listKnownCurrenciesPg(base = "USD") {
  const rows = await query(
    `SELECT DISTINCT quote FROM currency_rates WHERE base = $1 ORDER BY quote`,
    [normalizeCurrency(base)],
  );
  return [normalizeCurrency(base), ...rows.map((r) => r.quote)];
}

/**
 * Writes one day's rates.
 *
 * `source` distinguishes a feed value from a hand-entered correction, and a
 * manual rate is never overwritten by a later fetch - someone who corrected a
 * day meant it.
 */
export async function upsertRatesPg({ day, base = "USD", rates, source = "api" }) {
  const entries = Object.entries(rates ?? {})
    .map(([quote, rate]) => [normalizeCurrency(quote), Number(rate)])
    .filter(([quote, rate]) => CURRENCY_RE.test(quote) && Number.isFinite(rate) && rate > 0);
  if (entries.length === 0) return 0;

  await query(
    `INSERT INTO currency_rates (day, base, quote, rate, source)
     SELECT $1::date, $2, q.quote, q.rate, $5
     FROM unnest($3::text[], $4::numeric[]) AS q(quote, rate)
     ON CONFLICT (day, base, quote) DO UPDATE
       SET rate = EXCLUDED.rate, fetched_at = now(), source = EXCLUDED.source
       WHERE currency_rates.source <> 'manual' OR EXCLUDED.source = 'manual'`,
    [day, normalizeCurrency(base), entries.map((e) => e[0]), entries.map((e) => e[1]), source],
  );
  return entries.length;
}

export async function getDisplayCurrencyPg() {
  const rows = await query("SELECT display_currency FROM currency_settings WHERE id = 1 LIMIT 1");
  return normalizeCurrency(rows[0]?.display_currency) || "USD";
}

export async function setDisplayCurrencyPg(currency, actorId = null) {
  const code = normalizeCurrency(currency);
  if (!CURRENCY_RE.test(code)) throw Object.assign(new Error("A three-letter currency code is required."), { status: 400 });
  await query(
    `INSERT INTO currency_settings (id, display_currency, updated_by, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET display_currency = $1, updated_by = $2, updated_at = now()`,
    [code, actorId],
  );
  return code;
}

/** Most recent day we hold any rate for, so staleness can be reported. */
export async function getLatestRateDayPg(base = "USD") {
  const rows = await query("SELECT MAX(day) AS day FROM currency_rates WHERE base = $1", [normalizeCurrency(base)]);
  const day = rows[0]?.day;
  if (!day) return null;
  return day instanceof Date ? day.toISOString().slice(0, 10) : String(day).slice(0, 10);
}
