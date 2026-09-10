import test from "node:test";
import assert from "node:assert/strict";
import { parseRateResponse } from "../src/lib/currency/rate-fetcher.js";

// Shape confirmed against a live open.er-api.com response: result "success",
// base_code, time_last_update_unix, and a `rates` object of ~166 currencies.
function feedPayload(overrides = {}) {
  return {
    result: "success",
    base_code: "USD",
    time_last_update_unix: Date.UTC(2026, 8, 10, 0, 0, 2) / 1000,
    rates: { USD: 1, EGP: 51.199677, EUR: 0.859582 },
    ...overrides,
  };
}

test("a successful response yields the feed's own publication day", () => {
  const parsed = parseRateResponse(feedPayload());
  assert.equal(parsed.day, "2026-09-10");
  assert.equal(parsed.base, "USD");
  assert.equal(parsed.rates.EGP, 51.199677);
});

// The day a rate belongs to is the feed's, not this process's clock - a
// backend running in Cairo must not file a 00:00 UTC rate under the next day.
test("the day comes from the feed timestamp rather than local time", () => {
  const parsed = parseRateResponse(
    feedPayload({ time_last_update_unix: Date.UTC(2026, 8, 9, 23, 59, 0) / 1000 }),
  );
  assert.equal(parsed.day, "2026-09-09");
});

test("a failed result is rejected rather than stored as zero rates", () => {
  assert.equal(parseRateResponse({ result: "error", "error-type": "unsupported-code" }), null);
});

test("a response with no rates is rejected", () => {
  assert.equal(parseRateResponse({ result: "success", base_code: "USD" }), null);
  assert.equal(parseRateResponse(null), null);
  assert.equal(parseRateResponse({}), null);
});

test("the conversion_rates spelling is accepted too", () => {
  const parsed = parseRateResponse({
    result: "success",
    base_code: "USD",
    time_last_update_unix: Date.UTC(2026, 8, 10) / 1000,
    conversion_rates: { EGP: 51.2 },
  });
  assert.equal(parsed.rates.EGP, 51.2);
});

test("a missing timestamp falls back to today rather than dropping the rates", () => {
  const parsed = parseRateResponse(feedPayload({ time_last_update_unix: undefined }));
  assert.match(parsed.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(parsed.rates.EGP, 51.199677);
});
