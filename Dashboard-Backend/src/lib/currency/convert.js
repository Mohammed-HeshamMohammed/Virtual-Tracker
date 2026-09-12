/**
 * Converting the money in a report into one currency.
 *
 * Members are paid in their own currency, so a report covering a mixed team
 * had nothing it could honestly total: it listed each currency side by side
 * ("$0.00 + EGP 6.08"), which is correct but unreadable, and gets worse with
 * every currency added. This turns those into a single figure.
 *
 * Two rules make the result trustworthy rather than merely tidy.
 *
 * 1. **The rate on the day the money was earned.** Converting everything at
 *    today's rate would silently rewrite the past: last month's payroll would
 *    read differently tomorrow, and no two exports of the same period would
 *    ever agree. Each amount is converted at the rate for its own day, so a
 *    closed period stays closed.
 *
 * 2. **The original never goes away.** A converted figure is derived, and
 *    derived money is the kind people dispute. Every converted amount travels
 *    with the currency and value it was actually earned in, so the report can
 *    show its working and an export can carry both columns.
 *
 * Rates are stored against a single base (USD) because that is what rate feeds
 * publish; a cross rate is two lookups, not a second table.
 */

/** Amounts are rounded to whole minor units - a converted figure that carries
 *  ten decimal places is claiming a precision the rate does not have. */
const MINOR_UNITS = 100;

/**
 * An indexed set of daily rates with "most recent on or before" lookup.
 *
 * Rate feeds publish on business days, so a Sunday has no rate of its own and
 * a fetch that failed on Monday leaves a hole. Falling back to the last known
 * rate is what makes a weekend shift convert at all - and `asOf` reports which
 * day was actually used, so a stale rate is visible rather than assumed.
 *
 * @param rows { day: "YYYY-MM-DD", quote: "EGP", rate: number } against USD.
 */
export function buildRateBook(rows, { base = "USD" } = {}) {
  const byQuote = new Map();
  for (const row of rows ?? []) {
    const quote = normalizeCurrency(row.quote);
    const day = String(row.day ?? "").slice(0, 10);
    const rate = Number(row.rate);
    if (!quote || !day || !Number.isFinite(rate) || rate <= 0) continue;
    const list = byQuote.get(quote) ?? [];
    list.push({ day, rate });
    byQuote.set(quote, list);
  }
  for (const list of byQuote.values()) list.sort((a, b) => a.day.localeCompare(b.day));

  /** USD -> `currency` on `day`, or null when nothing is known yet. */
  function rateOn(day, currency) {
    const code = normalizeCurrency(currency);
    // The base is worth one of itself on every day, so it is never stale -
    // `exact` keeps that from being read as a rate published on `day`.
    if (code === base) return { rate: 1, asOf: day, exact: true };
    const list = byQuote.get(code);
    if (!list?.length) return null;

    // Binary search for the latest entry on or before `day`.
    let lo = 0;
    let hi = list.length - 1;
    let found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].day <= day) {
        found = list[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found) return { rate: found.rate, asOf: found.day };
    // Nothing on or before that day: rates only started being collected at
    // some point, and a report covering the weeks before that would otherwise
    // fall back to an unreadable per-currency list. The earliest rate we hold
    // converts it, and `asOf` says which day it came from - visibly stale
    // beats silently mixed.
    const earliest = list[0];
    return earliest ? { rate: earliest.rate, asOf: earliest.day } : null;
  }

  return {
    base,
    rateOn,
    currencies: () => [base, ...byQuote.keys()],
    has: (currency) => normalizeCurrency(currency) === base || byQuote.has(normalizeCurrency(currency)),
  };
}

/** The staler of the two legs' rate days, ignoring the base's implicit 1. */
function publishedAsOf(fromRate, toRate) {
  const days = [fromRate, toRate].filter((leg) => leg && !leg.exact).map((leg) => leg.asOf);
  if (!days.length) return null;
  return days.reduce((oldest, day) => (day < oldest ? day : oldest));
}

export function normalizeCurrency(value) {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * One amount, converted.
 *
 * @returns { amount, currency, originalAmount, originalCurrency, rate, rateAsOf, converted }
 *          `converted: false` means the amount is unchanged and still in its
 *          own currency - either it already was the target, or no rate exists
 *          for that day. The caller decides how to present that; it must not
 *          quietly pretend the conversion happened.
 */
export function convertAmount(rateBook, { amount, currency, day, to }) {
  const value = Number(amount) || 0;
  const from = normalizeCurrency(currency) || rateBook.base;
  const target = normalizeCurrency(to) || rateBook.base;

  const unconverted = {
    amount: value,
    currency: from,
    originalAmount: value,
    originalCurrency: from,
    rate: 1,
    rateAsOf: null,
    converted: false,
  };

  if (from === target) return { ...unconverted, currency: target, rate: 1 };
  if (value === 0) {
    // Zero is zero in every currency, and refusing to convert it is what puts
    // a stray "$0.00 +" in front of an otherwise single-currency total.
    return { ...unconverted, amount: 0, currency: target, converted: true };
  }

  const fromRate = rateBook.rateOn(day, from);
  const toRate = rateBook.rateOn(day, target);
  if (!fromRate || !toRate) return unconverted;

  const crossRate = toRate.rate / fromRate.rate;
  return {
    amount: Math.round(value * crossRate * MINOR_UNITS) / MINOR_UNITS,
    currency: target,
    originalAmount: value,
    originalCurrency: from,
    rate: crossRate,
    // The older of the two published lookups: a cross rate is only as fresh as
    // its staler leg. The base leg is left out - it holds no rate of its own,
    // and counting it would report `day` for a conversion that in fact used a
    // rate from some other day.
    rateAsOf: publishedAsOf(fromRate, toRate) ?? day,
    converted: true,
  };
}

/**
 * Totals a set of amounts into the target currency, keeping whatever could not
 * be converted separate rather than dropping it or silently adding it in.
 *
 * @returns { total, currency, unconverted: [{ currency, amount }], rateAsOf }
 */
export function sumConverted(rateBook, rows, to) {
  const target = normalizeCurrency(to) || rateBook.base;
  const leftovers = new Map();
  let total = 0;
  let oldestRate = null;

  for (const row of rows ?? []) {
    const result = convertAmount(rateBook, { ...row, to: target });
    if (result.converted || result.currency === target) {
      total += result.amount;
      if (result.rateAsOf && (!oldestRate || result.rateAsOf < oldestRate)) oldestRate = result.rateAsOf;
      continue;
    }
    leftovers.set(result.currency, (leftovers.get(result.currency) ?? 0) + result.amount);
  }

  return {
    total: Math.round(total * MINOR_UNITS) / MINOR_UNITS,
    currency: target,
    unconverted: [...leftovers.entries()].map(([currency, amount]) => ({ currency, amount })),
    rateAsOf: oldestRate,
  };
}
