import test from "node:test";
import assert from "node:assert/strict";
import { buildRateBook, convertAmount, sumConverted } from "../src/lib/currency/convert.js";

// USD is the base, so a rate is "how many of this currency one dollar buys".
const RATES = [
  { day: "2026-09-01", quote: "EGP", rate: 48.0 },
  { day: "2026-09-05", quote: "EGP", rate: 50.0 },
  { day: "2026-09-05", quote: "EUR", rate: 0.9 },
];

function book() {
  return buildRateBook(RATES);
}

test("an amount converts at the rate for its own day", () => {
  const result = convertAmount(book(), { amount: 10, currency: "USD", day: "2026-09-05", to: "EGP" });
  assert.equal(result.amount, 500);
  assert.equal(result.currency, "EGP");
  assert.equal(result.rateAsOf, "2026-09-05");
});

// The whole point of storing daily rates: a closed period must not change
// value because today's rate moved.
test("an older day keeps the older rate", () => {
  const result = convertAmount(book(), { amount: 10, currency: "USD", day: "2026-09-03", to: "EGP" });
  assert.equal(result.amount, 480);
  assert.equal(result.rateAsOf, "2026-09-01");
});

// Feeds publish on business days, so a Sunday has no rate of its own.
test("a day with no published rate falls back to the most recent one before it", () => {
  const result = convertAmount(book(), { amount: 1, currency: "USD", day: "2026-09-30", to: "EGP" });
  assert.equal(result.amount, 50);
  assert.equal(result.rateAsOf, "2026-09-05", "and says which day's rate it actually used");
});

test("converting the other direction inverts the same rate", () => {
  const result = convertAmount(book(), { amount: 500, currency: "EGP", day: "2026-09-05", to: "USD" });
  assert.equal(result.amount, 10);
});

test("a cross rate between two non-base currencies goes through the base", () => {
  const result = convertAmount(book(), { amount: 100, currency: "EGP", day: "2026-09-05", to: "EUR" });
  // 100 EGP -> 2 USD -> 1.80 EUR
  assert.equal(result.amount, 1.8);
});

test("a cross rate is only as fresh as its staler leg", () => {
  const stale = buildRateBook([
    { day: "2026-09-01", quote: "EGP", rate: 48 },
    { day: "2026-09-05", quote: "EUR", rate: 0.9 },
  ]);
  const result = convertAmount(stale, { amount: 48, currency: "EGP", day: "2026-09-05", to: "EUR" });
  assert.equal(result.rateAsOf, "2026-09-01");
});

test("an amount already in the target currency is left alone", () => {
  const result = convertAmount(book(), { amount: 7.5, currency: "USD", day: "2026-09-05", to: "USD" });
  assert.equal(result.amount, 7.5);
  assert.equal(result.converted, false);
});

// This is the "$0.00 + EGP 6.08" in the screenshot: a zero in one currency
// dragging a whole second currency into the label for nothing.
test("zero converts to zero rather than surviving as its own currency", () => {
  const result = convertAmount(book(), { amount: 0, currency: "USD", day: "2026-09-05", to: "EGP" });
  assert.equal(result.amount, 0);
  assert.equal(result.currency, "EGP");
  assert.equal(result.converted, true);
});

// Silence would be worse than a mixed total: it would understate the money.
test("an amount with no rate available is returned unconverted and flagged", () => {
  const result = convertAmount(book(), { amount: 20, currency: "GBP", day: "2026-09-05", to: "USD" });
  assert.equal(result.converted, false);
  assert.equal(result.currency, "GBP");
  assert.equal(result.amount, 20);
});

test("currency codes are matched regardless of case or padding", () => {
  const result = convertAmount(book(), { amount: 10, currency: " usd ", day: "2026-09-05", to: "egp" });
  assert.equal(result.amount, 500);
});

test("converted amounts are rounded to minor units, not left at rate precision", () => {
  const result = convertAmount(book(), { amount: 1, currency: "USD", day: "2026-09-05", to: "EUR" });
  assert.equal(result.amount, 0.9);
  const back = convertAmount(book(), { amount: 1, currency: "EUR", day: "2026-09-05", to: "USD" });
  assert.equal(back.amount, 1.11);
});

test("a mixed-currency set totals into one figure", () => {
  const result = sumConverted(
    book(),
    [
      { amount: 10, currency: "USD", day: "2026-09-05" },
      { amount: 500, currency: "EGP", day: "2026-09-05" },
    ],
    "USD",
  );
  assert.equal(result.total, 20);
  assert.equal(result.currency, "USD");
  assert.deepEqual(result.unconverted, []);
});

test("what could not be converted is kept apart rather than dropped or absorbed", () => {
  const result = sumConverted(
    book(),
    [
      { amount: 10, currency: "USD", day: "2026-09-05" },
      { amount: 20, currency: "GBP", day: "2026-09-05" },
    ],
    "USD",
  );
  assert.equal(result.total, 10);
  assert.deepEqual(result.unconverted, [{ currency: "GBP", amount: 20 }]);
});

test("a total reports the oldest rate any of its parts leaned on", () => {
  const result = sumConverted(
    book(),
    [
      { amount: 1, currency: "EGP", day: "2026-09-02" },
      { amount: 1, currency: "EGP", day: "2026-09-06" },
    ],
    "USD",
  );
  assert.equal(result.rateAsOf, "2026-09-01");
});

test("rows are summed per day, so one range can span a rate change", () => {
  const result = sumConverted(
    book(),
    [
      { amount: 48, currency: "EGP", day: "2026-09-01" },
      { amount: 50, currency: "EGP", day: "2026-09-05" },
    ],
    "USD",
  );
  assert.equal(result.total, 2, "each day used its own rate, not one blended one");
});

test("a rate book built from nothing converts nothing and claims nothing", () => {
  const empty = buildRateBook([]);
  assert.equal(empty.has("EGP"), false);
  assert.equal(convertAmount(empty, { amount: 5, currency: "EGP", day: "2026-09-05", to: "USD" }).converted, false);
});

test("malformed rate rows are ignored rather than poisoning the book", () => {
  const messy = buildRateBook([
    { day: "2026-09-05", quote: "EGP", rate: 0 },
    { day: "2026-09-05", quote: "EGP", rate: -3 },
    { day: "", quote: "EGP", rate: 50 },
    { day: "2026-09-05", quote: "", rate: 50 },
    { day: "2026-09-06", quote: "EGP", rate: 50 },
  ]);
  // Every bad row was dropped, so the only rate in the book is the 6th's -
  // which a lookup for the 5th can only reach as the earliest one held.
  assert.equal(messy.rateOn("2026-09-05", "EGP").asOf, "2026-09-06");
  assert.equal(messy.rateOn("2026-09-06", "EGP").rate, 50);
  assert.equal(messy.rateOn("2026-09-06", "GBP"), null, "and a currency with no good row at all is still null");
});

// Rates are only stored from the day the workspace started fetching them, so
// anything logged before that had no rate at all and used to convert to
// nothing - a report that silently dropped every earlier day. The earliest
// rate held is a far better answer than none, and `rateAsOf` still says the
// figure is not from that day.
test("a day before the first rate on record uses the earliest one held", () => {
  const result = convertAmount(book(), { amount: 10, currency: "USD", day: "2026-08-01", to: "EGP" });
  assert.equal(result.amount, 480);
  assert.equal(result.rateAsOf, "2026-09-01");
  assert.equal(result.converted, true);
});

test("a currency with no rate at all still converts nothing", () => {
  const result = convertAmount(book(), { amount: 10, currency: "USD", day: "2026-09-05", to: "JPY" });
  assert.equal(result.converted, false);
  assert.equal(result.amount, 10, "and is handed back untouched rather than zeroed");
});
