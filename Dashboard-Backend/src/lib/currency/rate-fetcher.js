import { logSafeWarn } from "../../http/sanitize-error.js";
import { getLatestRateDayPg, upsertRatesPg } from "../postgres/currency-rates.service.js";
import { localDayFor } from "../time/timezone-utils.js";

/**
 * Keeps `currency_rates` current from a public feed.
 *
 * open.er-api.com is the source: it needs no API key or account, publishes
 * every currency in one response against a chosen base, and states when it
 * last updated and when it will next. That last part matters - it means the
 * job can tell "today's rate has not been published yet" apart from "the fetch
 * failed", and only the second is worth warning about.
 *
 * A missed day is not an outage. Conversion falls back to the most recent rate
 * on or before the day being converted (see lib/currency/convert.js), so a
 * failed fetch degrades to yesterday's rate rather than to no answer, and the
 * report says which day's rate it used.
 */

const RATE_SOURCE_URL = "https://open.er-api.com/v6/latest/USD";
const BASE = "USD";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

let rateTimer = null;

export function parseRateResponse(payload) {
  if (!payload || payload.result !== "success") return null;
  const rates = payload.rates ?? payload.conversion_rates;
  if (!rates || typeof rates !== "object") return null;

  // The feed's own "as of", not our clock: a rate published at 00:00 UTC
  // belongs to that UTC day wherever this process happens to be running.
  const updatedMs = Number(payload.time_last_update_unix) * 1000;
  const day = Number.isFinite(updatedMs) && updatedMs > 0
    ? new Date(updatedMs).toISOString().slice(0, 10)
    : localDayFor(new Date(), "UTC");

  return { day, base: String(payload.base_code ?? BASE).toUpperCase(), rates };
}

export async function fetchLatestRates(fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(RATE_SOURCE_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`rate feed returned ${response.status}`);
    return parseRateResponse(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns { stored, day, skipped } - `skipped` when the feed had nothing newer
 *          than what is already on record, which is the normal case for all
 *          but one check a day.
 */
export async function refreshCurrencyRates({ fetchImpl = fetch } = {}) {
  const latest = await fetchLatestRates(fetchImpl);
  if (!latest) return { stored: 0, day: null, skipped: true };

  const known = await getLatestRateDayPg(latest.base);
  if (known && known >= latest.day) return { stored: 0, day: latest.day, skipped: true };

  const stored = await upsertRatesPg({ day: latest.day, base: latest.base, rates: latest.rates, source: "api" });
  return { stored, day: latest.day, skipped: false };
}

export function scheduleCurrencyRateRefresh() {
  if (rateTimer) return;

  const run = () => {
    refreshCurrencyRates().catch((err) => {
      // Warn, never throw: a rate feed being unreachable must not take down
      // the process or a report - yesterday's rate still converts.
      logSafeWarn("[currency-rates] refresh failed, existing rates still apply:", err);
    });
  };

  run();
  // Four checks a day rather than one: the feed publishes at a time it does not
  // guarantee, and a check that finds nothing new costs one request.
  rateTimer = setInterval(run, CHECK_INTERVAL_MS);
  if (typeof rateTimer.unref === "function") rateTimer.unref();
}
