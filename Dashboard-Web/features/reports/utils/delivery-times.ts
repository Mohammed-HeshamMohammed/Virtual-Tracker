export function buildDeliveryTimeOptions(): string[] {
  const out: string[] = []
  for (let h = 0; h < 24; h += 1) {
    for (const m of [0, 30] as const) {
      out.push(formatDeliveryTimeLabel(h, m))
    }
  }
  return out
}

function formatDeliveryTimeLabel(hour24: number, minute: number): string {
  const period = hour24 < 12 ? "am" : "pm"
  let h = hour24 % 12
  if (h === 0) h = 12
  const mm = minute === 0 ? "00" : "30"
  return `${h}:${mm} ${period}`
}
