import { buildRateBook, convertAmount, normalizeCurrency } from "./convert.js";
import { getDisplayCurrencyPg, getRatesForRangePg } from "../postgres/currency-rates.service.js";
import { getSingleByMemberId } from "../postgres/member-data-store.js";

/**
 * A member's hourly pay in the one currency the workspace counts in.
 *
 * Members are paid in their own currency, but budgets, client bill rates and
 * project spend are all a single number. Multiplying hours by a raw pay rate
 * added EGP to USD and called the result dollars - a project's "spent" figure
 * that meant nothing. Every rate is converted into the workspace's display
 * currency first, at today's rate (see lib/currency/convert.js).
 *
 * With no rate on record for a currency the pay rate is used as it stands,
 * which is what the code did before conversion existed - wrong, but no more
 * wrong than it was, and visible rather than a silent zero.
 */

/** Rates move daily; an hour between refreshes is plenty. */
const CONTEXT_TTL_MS = 60 * 60_000;
let context = null;
/** The load in flight, so a batch of members shares one rate lookup. */
let loading = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function loadCurrencyContext() {
  if (context && context.expiresAt > Date.now()) return context;
  if (loading) return loading;
  const day = today();
  loading = (async () => {
    const [display, rows] = await Promise.all([
      getDisplayCurrencyPg(),
      getRatesForRangePg({ fromDay: day, toDay: day }),
    ]);
    context = {
      day,
      display: normalizeCurrency(display),
      book: buildRateBook(rows),
      expiresAt: Date.now() + CONTEXT_TTL_MS,
    };
    return context;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/** `amount` of `currency` in the workspace's display currency. */
export async function toDisplayCurrency(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) return 0;
  const from = normalizeCurrency(currency);
  try {
    const ctx = await loadCurrencyContext();
    if (!from || from === ctx.display) return value;
    const converted = convertAmount(ctx.book, { amount: value, currency: from, day: ctx.day, to: ctx.display });
    return converted.converted ? converted.amount : value;
  } catch {
    return value;
  }
}

/** One member's hourly pay, converted. 0 when they have no rate. */
export async function memberHourlyRateInDisplayCurrency(memberId, db = null) {
  if (!memberId) return 0;
  let row;
  try {
    row = await getSingleByMemberId(db, "pay_rates", memberId);
  } catch {
    return 0;
  }
  const rate = Number(row?.rate ?? 0);
  if (!(rate > 0)) return 0;
  return toDisplayCurrency(rate, row?.currency);
}

/** Hourly pay for several members at once, keyed by member id. */
export async function memberHourlyRatesInDisplayCurrency(memberIds, db = null) {
  const unique = [...new Set((memberIds ?? []).filter(Boolean).map(String))];
  const entries = await Promise.all(
    unique.map(async (memberId) => [memberId, await memberHourlyRateInDisplayCurrency(memberId, db)]),
  );
  return new Map(entries);
}

export function __resetCurrencyContextForTests() {
  context = null;
  loading = null;
}
