// Every report money figure is per-member currency now (Amounts Owed, Daily
// Totals, Time & Activity's cost column - each row's amount is that member's
// own pay rate currency, not a flat assumption of USD). These two concerns
// come up everywhere a report shows or sums a dollar figure:
//  1. Formatting one amount - formatMoney, same $-for-USD/CODE-for-everything-
//     else convention pay-currencies.ts's formatPayRateDisplay already uses,
//     so a rate label and its amount read consistently.
//  2. Summing several amounts that may not share one currency - summing raw
//     numbers across different currencies produces a number that means
//     nothing (100 USD + 500 EGP is not "600" of anything). sumMoneyStrings
//     keeps every currency's own subtotal separate instead.

/** $-for-USD, "CODE amount" for anything else - matches formatPayRateDisplay. */
export function formatMoney(amount: number, currency: string = "USD"): string {
  const rounded = amount.toFixed(2)
  return currency === "USD" ? `$${rounded}` : `${currency} ${rounded}`
}

/** Inverse of formatMoney (and tolerant of a bare "$400.00" with no code) -
 *  pulls the currency code and numeric amount back out of an already-
 *  formatted string. */
export function parseMoneyLabel(label: string): { currency: string; amount: number } {
  const trimmed = String(label ?? "").trim()
  const amount = Number(trimmed.replace(/[^0-9.-]/g, "")) || 0
  const codeMatch = trimmed.match(/^([A-Za-z]{2,5})\s/)
  const currency = codeMatch ? codeMatch[1].toUpperCase() : "USD"
  return { currency, amount }
}

/**
 * Sums already-formatted money strings, grouped by currency. A range with
 * only one currency in play (the common case) reads exactly like a plain
 * sum always did. A range spanning more than one currency (a real,
 * deliberately-supported case - members can be paid in either USD or EGP)
 * shows each currency's own subtotal joined with " + ", rather than adding
 * different currencies together into a total that looks precise but isn't
 * measuring anything.
 *
 * Idempotent on its own output: each input is split on " + " before
 * parsing, so summing a list that already contains a joined "$300.00 + EGP
 * 200.00" string (a per-day total that was itself already mixed-currency,
 * being summed again into a grand total) attributes each half to its real
 * currency instead of mangling both numbers together.
 */
export function sumMoneyStrings(amountList: string[]): string {
  const byCurrency = new Map<string, number>()
  for (const label of amountList) {
    for (const part of String(label ?? "").split("+")) {
      if (!part.trim()) continue
      const { currency, amount } = parseMoneyLabel(part)
      byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount)
    }
  }
  if (byCurrency.size === 0) return formatMoney(0, "USD")
  return [...byCurrency.entries()]
    .sort(([a], [b]) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)))
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" + ")
}

/** Same grouped-by-currency summing as sumMoneyStrings, for callers that
 *  already have raw {amount, currency} pairs instead of formatted strings
 *  (e.g. summing straight off API rows before they're ever displayed). */
export function sumMoneyByCurrency(rows: { amount: number; currency?: string }[]): string {
  const byCurrency = new Map<string, number>()
  for (const row of rows) {
    const currency = (row.currency || "USD").toUpperCase()
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + row.amount)
  }
  if (byCurrency.size === 0) return formatMoney(0, "USD")
  return [...byCurrency.entries()]
    .sort(([a], [b]) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)))
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" + ")
}
