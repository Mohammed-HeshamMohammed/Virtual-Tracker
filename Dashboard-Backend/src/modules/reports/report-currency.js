import { buildRateBook, normalizeCurrency } from "../../lib/currency/convert.js";
import {
  getDisplayCurrencyPg,
  getRatesForRangePg,
  isValidCurrencyCode,
} from "../../lib/postgres/currency-rates.service.js";

/**
 * Decides which currency a report renders in, and loads the rates to get there.
 *
 * The workspace has one display currency, set by an admin - that is what
 * scheduled emails and exports use, so two people opening the same PDF always
 * read the same number. On screen, a viewer's own currency wins when they have
 * one: the client resolves it from the browser's locale and passes it as
 * `displayCurrency`, and someone sitting in Cairo sees Egyptian pounds without
 * having to configure anything.
 *
 * A requested currency is honoured only if there is actually a rate for it.
 * Otherwise the org default stands, because a currency we cannot convert into
 * would turn every figure back into the mixed list this replaced.
 */
export async function resolveReportCurrency(url, { fromDay, toDay }) {
  const requested = normalizeCurrency(url?.searchParams?.get("displayCurrency") ?? "");
  const orgCurrency = await getDisplayCurrencyPg();

  const rateRows = await getRatesForRangePg({ fromDay, toDay });
  const rateBook = buildRateBook(rateRows);

  const wanted = isValidCurrencyCode(requested) ? requested : "";
  const displayCurrency = wanted && rateBook.has(wanted) ? wanted : orgCurrency;

  return {
    rateBook,
    displayCurrency,
    orgCurrency,
    /** True when the viewer asked for something we hold no rate for, so the UI
     *  can explain why it is not showing the currency they expected. */
    requestedUnavailable: Boolean(wanted) && wanted !== displayCurrency,
  };
}

/**
 * The block every converting report returns alongside its rows, so the client
 * never has to guess what it is looking at.
 */
export function currencyMeta({ displayCurrency, orgCurrency, requestedUnavailable }, rateAsOf = null) {
  return {
    displayCurrency,
    orgCurrency,
    requestedUnavailable,
    // Which day's rate the oldest converted figure leaned on. Shown when it
    // trails the period, so a stale feed is visible rather than assumed.
    rateAsOf,
  };
}
