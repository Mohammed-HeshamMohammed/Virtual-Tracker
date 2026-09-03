
export function formatMoney(amount: number, currency: string = "USD"): string {
  const rounded = amount.toFixed(2)
  return currency === "USD" ? `$${rounded}` : `${currency} ${rounded}`
}

export function parseMoneyLabel(label: string): { currency: string; amount: number } {
  const trimmed = String(label ?? "").trim()
  const amount = Number(trimmed.replace(/[^0-9.-]/g, "")) || 0
  const codeMatch = trimmed.match(/^([A-Za-z]{2,5})\s/)
  const currency = codeMatch ? codeMatch[1].toUpperCase() : "USD"
  return { currency, amount }
}

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
