import type { PdfDateFormat, PdfLanguage, PdfNumberFormat } from "./options.ts"

const ARABIC_INDIC = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"]
const NBSP = " "

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const MONTHS_EN_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]

const SYMBOLS: Record<string, { en: string; ar: string }> = {
  USD: { en: "$", ar: "$" },
  EGP: { en: "EGP", ar: "ج.م" },
  EUR: { en: "€", ar: "€" },
  GBP: { en: "£", ar: "£" },
}

/** Western digits as the Arabic-Indic ones, when that is the number format. */
export function toLocaleDigits(text: string, numberFormat: PdfNumberFormat): string {
  return numberFormat === "ar" ? text.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]) : text
}

/** `1234.5` as "1,234.50" / "1.234,50" / "1 234,50" / "١٬٢٣٤٫٥٠". */
export function formatNumber(value: number, numberFormat: PdfNumberFormat, decimals = 2): string {
  const safe = Number.isFinite(value) ? value : 0
  const negative = safe < 0
  const [whole, fraction] = Math.abs(safe).toFixed(decimals).split(".")
  const groupSep = numberFormat === "de" ? "." : numberFormat === "fr" ? NBSP : numberFormat === "ar" ? "٬" : ","
  const decimalSep = numberFormat === "de" || numberFormat === "fr" ? "," : numberFormat === "ar" ? "٫" : "."
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep)
  const text = fraction ? `${grouped}${decimalSep}${fraction}` : grouped
  return `${negative ? "-" : ""}${toLocaleDigits(text, numberFormat)}`
}

/** An amount in a currency, placed the way the number format places it. */
export function formatMoney(amount: number, currency: string, numberFormat: PdfNumberFormat): string {
  const code = String(currency || "USD").toUpperCase()
  const symbol = SYMBOLS[code]?.[numberFormat === "ar" ? "ar" : "en"] ?? code
  const number = formatNumber(amount, numberFormat)
  if (numberFormat === "en") return symbol.length > 1 && /^[A-Z]{3}$/.test(symbol) ? `${symbol} ${number}` : `${symbol}${number}`
  return `${number}${NBSP}${symbol}`
}

/** "2026-09-28" in the chosen format and language. The string is a calendar day, so it is read as one. */
export function formatDate(
  iso: string,
  dateFormat: PdfDateFormat,
  language: PdfLanguage,
  numberFormat: PdfNumberFormat,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""))
  if (!match) return String(iso ?? "")
  const [, year, month, day] = match
  const m = Number(month)
  const d = Number(day)
  const names = language === "ar" ? MONTHS_AR : MONTHS_EN
  const shortNames = language === "ar" ? MONTHS_AR : MONTHS_EN_SHORT
  const text = dateFormat
    .replace("YYYY", "\u0001")
    .replace("MMMM", "\u0002")
    .replace("MMM", "\u0003")
    .replace("MM", "\u0004")
    .replace("DD", "\u0005")
    .replace("D", String(d))
    .replace("\u0001", year)
    .replace("\u0002", names[m - 1] ?? month)
    .replace("\u0003", shortNames[m - 1] ?? month)
    .replace("\u0004", month)
    .replace("\u0005", day)
  return toLocaleDigits(text, numberFormat)
}

/** Day and month only, for chart axes: "Sep 1", "09-01", "01/09". */
export function formatShortDate(
  iso: string,
  dateFormat: PdfDateFormat,
  language: PdfLanguage,
  numberFormat: PdfNumberFormat,
): string {
  const withoutYear: Record<PdfDateFormat, string> = {
    "MMM D, YYYY": "MMM D",
    "MMMM D, YYYY": "MMM D",
    "D MMM YYYY": "D MMM",
    "D MMMM YYYY": "D MMM",
    "YYYY-MM-DD": "MM-DD",
    "DD/MM/YYYY": "DD/MM",
    "MM/DD/YYYY": "MM/DD",
    "DD.MM.YYYY": "DD.MM",
  }
  return formatDate(iso, withoutYear[dateFormat] as PdfDateFormat, language, numberFormat)
}

export function formatClock(totalSeconds: number, numberFormat: PdfNumberFormat): string {
  const sec = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return toLocaleDigits(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, numberFormat)
}

/** "1h 30m", "45m", "8h" - short enough to sit beside a gridline. */
export function formatAxisHours(hours: number, language: PdfLanguage, numberFormat: PdfNumberFormat): string {
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  const unitH = language === "ar" ? "س" : "h"
  const unitM = language === "ar" ? "د" : "m"
  const text = h === 0 ? `${m}${unitM}` : m === 0 ? `${h}${unitH}` : `${h}${unitH} ${m}${unitM}`
  return toLocaleDigits(text, numberFormat)
}

export function formatAxisNumber(value: number, numberFormat: PdfNumberFormat): string {
  if (value >= 1000) return toLocaleDigits(`${Math.round(value / 100) / 10}k`, numberFormat)
  return toLocaleDigits(Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100), numberFormat)
}

/** A figure that can be added up: anything that is not a finite number counts as 0. */
export function safeNumber(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
