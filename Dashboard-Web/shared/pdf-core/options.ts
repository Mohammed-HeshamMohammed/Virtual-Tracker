/**
 * What a report PDF looks like and says - the one description every consumer
 * shares: the Export dialog on screen, and the emailed and scheduled reports
 * the server builds. The server copy of this folder is generated from this one
 * (see scripts/sync-pdf-core.mjs), so a PDF cannot come out differently
 * depending on where it was made.
 *
 * Plain TypeScript with no framework or path-alias imports, so it runs
 * unchanged under Node (tests) and, once its types are stripped, on the server.
 */

/**
 * The three looks a document can have:
 *   - "virtual-tracker": the look these reports have always had;
 *   - "classic": a plain A4 invoice with a ruled grid (EasyInvoicePDF's Default template);
 *   - "stripe": a US Letter invoice led by the amount due (EasyInvoicePDF's Stripe template).
 */
export const PDF_TEMPLATES = ["virtual-tracker", "classic", "stripe"] as const
export type PdfTemplate = (typeof PDF_TEMPLATES)[number]

export const PDF_LANGUAGES = ["en", "ar"] as const
export type PdfLanguage = (typeof PDF_LANGUAGES)[number]

export const PDF_DATE_FORMATS = [
  "MMM D, YYYY",
  "MMMM D, YYYY",
  "D MMM YYYY",
  "D MMMM YYYY",
  "YYYY-MM-DD",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "DD.MM.YYYY",
] as const
export type PdfDateFormat = (typeof PDF_DATE_FORMATS)[number]

export const PDF_NUMBER_FORMATS = ["en", "de", "fr", "ar"] as const
export type PdfNumberFormat = (typeof PDF_NUMBER_FORMATS)[number]

export const PDF_DOCUMENTS = ["report", "client", "payslip"] as const
export type PdfDocument = (typeof PDF_DOCUMENTS)[number]

export const PDF_CURRENCIES = ["USD", "EGP"] as const

/** The pieces of a document the reader can switch off, one switch each. */
export const PDF_SHOW_KEYS = [
  "summary",
  "charts",
  "filters",
  "details",
  "rate",
  "members",
  "notes",
  "logo",
  "footer",
] as const
export type PdfShowKey = (typeof PDF_SHOW_KEYS)[number]

export interface PdfOptions {
  document: PdfDocument
  template: PdfTemplate
  language: PdfLanguage
  dateFormat: PdfDateFormat
  numberFormat: PdfNumberFormat
  /** "" keeps the currency the report is already in. */
  currency: string
  /** One line printed under the title, e.g. payment instructions. */
  headerNote: string
  /** Your logo as a PNG or JPEG data URL, already scaled down (see LOGO_MAX_CHARS). Empty = none. */
  logo: string
  show: Record<PdfShowKey, boolean>
  /** Client statement: the projects to bill. Empty = every project in the range. */
  projectNames: string[]
  /** Pay slip: whose. */
  memberId: string
  /** The team report keeps the money columns off unless asked. */
  includeAmounts: boolean
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  document: "report",
  template: "virtual-tracker",
  language: "en",
  dateFormat: "MMM D, YYYY",
  numberFormat: "en",
  currency: "",
  headerNote: "",
  logo: "",
  show: {
    summary: true,
    charts: true,
    filters: true,
    details: true,
    rate: true,
    members: true,
    notes: true,
    logo: true,
    footer: true,
  },
  projectNames: [],
  memberId: "",
  includeAmounts: false,
}

const MAX_HEADER_NOTE = 300
const MAX_NAMES = 200
/** The size of a logo, as the characters of its data URL: a 440x160 PNG is a fraction of this. */
export const LOGO_MAX_CHARS = 400_000
const LOGO_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/

function cleanLogo(value: unknown): string {
  return typeof value === "string" && value.length <= LOGO_MAX_CHARS && LOGO_PATTERN.test(value) ? value : ""
}


function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * Whatever came in - a saved setting, a request body, a stored schedule - as a
 * complete, safe set of options. Unknown values fall back to the default, so an
 * old saved view or a hand-edited request can never reach the renderer.
 */
export function normalizePdfOptions(raw: unknown): PdfOptions {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const show = src.show && typeof src.show === "object" ? (src.show as Record<string, unknown>) : {}
  const currency = typeof src.currency === "string" ? src.currency.trim().toUpperCase() : ""
  return {
    document: pick(PDF_DOCUMENTS, src.document, DEFAULT_PDF_OPTIONS.document),
    // "default" is what the Virtual Tracker look was called before there were three.
    template: pick(PDF_TEMPLATES, src.template === "default" ? "virtual-tracker" : src.template, DEFAULT_PDF_OPTIONS.template),
    language: pick(PDF_LANGUAGES, src.language, DEFAULT_PDF_OPTIONS.language),
    dateFormat: pick(PDF_DATE_FORMATS, src.dateFormat, DEFAULT_PDF_OPTIONS.dateFormat),
    numberFormat: pick(PDF_NUMBER_FORMATS, src.numberFormat, DEFAULT_PDF_OPTIONS.numberFormat),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "",
    headerNote: typeof src.headerNote === "string" ? src.headerNote.replace(/\s+/g, " ").trim().slice(0, MAX_HEADER_NOTE) : "",
    logo: cleanLogo(src.logo),
    show: Object.fromEntries(
      PDF_SHOW_KEYS.map((key) => [key, typeof show[key] === "boolean" ? show[key] : DEFAULT_PDF_OPTIONS.show[key]]),
    ) as Record<PdfShowKey, boolean>,
    projectNames: Array.isArray(src.projectNames)
      ? [
          ...new Set(
            src.projectNames
              .filter((n): n is string => typeof n === "string")
              .map((n) => n.trim().slice(0, 200))
              .filter((n) => n.length > 0),
          ),
        ].slice(0, MAX_NAMES)
      : [],
    memberId: typeof src.memberId === "string" ? src.memberId.trim().slice(0, 64) : "",
    includeAmounts: src.includeAmounts === true,
  }
}

/** The settings worth remembering between visits: how documents look, not what is in this one. */
export function appearanceOf(options: PdfOptions): Pick<
  PdfOptions,
  | "template"
  | "language"
  | "dateFormat"
  | "numberFormat"
  | "headerNote"
  | "logo"
  | "show"
> {
  const { template, language, dateFormat, numberFormat, headerNote, logo, show } = options
  return { template, language, dateFormat, numberFormat, headerNote, logo, show }
}
