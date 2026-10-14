"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Check, ImagePlus, X } from "lucide-react"
import { Input } from "@/shared/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select"
import { Switch } from "@/shared/ui/switch"
import { cn } from "@/shared/utils/utils"
import { ReportModalFieldLabel } from "@/features/reports/components/amounts-owed/report-dialog-shared"
import { PAY_RATE_CURRENCIES } from "@/features/members/config/pay-currencies"
import { formatDate, formatNumber, todayIso } from "@/shared/pdf-core/format"
import { prepareLogo } from "@/features/reports/utils/pdf-logo"
import {
  PDF_DATE_FORMATS,
  type PdfDocument,
  type PdfNumberFormat,
  type PdfOptions,
  type PdfShowKey,
  type PdfTemplate,
} from "@/shared/pdf-core/options"

const AUTOMATIC = "__automatic"

const DOCUMENT_LABEL: Record<PdfDocument, string> = {
  report: "Team report",
  client: "Client statement",
  payslip: "Pay slip",
}

const DOCUMENT_HELP: Record<PdfDocument, string> = {
  report: "The table and charts as they are on screen, for your own team.",
  client: "The hours on a client's projects, priced at each project's client hourly rate, with the client's tax and terms.",
  payslip: "One member's hours, priced at their pay rate from the Members page.",
}

const TEMPLATE_LABEL: Record<PdfTemplate, string> = {
  "virtual-tracker": "Virtual Tracker",
  classic: "Classic invoice",
  stripe: "Stripe invoice",
}

const TEMPLATE_HELP: Record<PdfTemplate, string> = {
  "virtual-tracker": "The look these reports have always had: A4, the summary in a box, a coloured table header.",
  classic:
    "A plain A4 invoice: the number and dates top right, From and To side by side, a ruled grid table, totals in a box. Modelled on EasyInvoicePDF's Default template.",
  stripe:
    "US Letter with a yellow top bar, the amount due, a clean table, and a footer on every page. Modelled on EasyInvoicePDF's Stripe template.",
}

const NUMBER_FORMAT_LABEL: Record<PdfNumberFormat, string> = {
  en: "English",
  de: "German",
  fr: "French",
  ar: "Arabic (Eastern digits)",
}

interface ShowSwitch {
  key: PdfShowKey
  label: string
  help: string
  /** Only for the documents that have the thing to switch. */
  only?: PdfDocument[]
}

const SHOW_SWITCHES: ShowSwitch[] = [
  { key: "summary", label: "Summary", help: "The totals strip at the top." },
  { key: "charts", label: "Charts", help: "Hours by date and by project or member." },
  { key: "filters", label: "Details", help: "The lines under the title: client, projects, dates, filters." },
  { key: "details", label: "Day-by-day rows", help: "A line for every day under each project. Off keeps only the totals.", only: ["client", "payslip"] },
  { key: "rate", label: "Rate", help: "The rate column and the hourly rate figure.", only: ["client", "payslip"] },
  { key: "members", label: "Members / projects column", help: "Who worked, or what they worked on, beside each line.", only: ["client", "payslip"] },
  { key: "notes", label: "Notes", help: "The small print: how the figures were worked out." },
  { key: "logo", label: "Logo", help: "Your logo in the header, when one is uploaded." },
  { key: "footer", label: "Footer", help: "The date made and the page number on every page." },
]

export function FieldSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-auto min-h-9 w-full border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 text-left shadow-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="z-100 max-h-72 overflow-y-auto scrollbar-hide">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="border-b border-slate-100 pb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <ReportModalFieldLabel>{label}</ReportModalFieldLabel>
      {children}
      {help ? <p className="text-xs text-slate-500 dark:text-slate-400">{help}</p> : null}
    </div>
  )
}

/** Upload, preview and remove the logo. The file is scaled down in the browser first. */
function LogoField({ value, onChange }: { value: string; onChange: (logo: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      onChange(await prepareLogo(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use that image.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Logo preview" className="max-h-10 max-w-28 object-contain" />
          <button
            type="button"
            onClick={() => onChange("")}
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      ) : null}
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
        <ImagePlus className="h-4 w-4" />
        {busy ? "Preparing…" : value ? "Replace logo" : "Upload logo"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => {
            void pick(e.target.files?.[0])
            e.target.value = ""
          }}
        />
      </label>
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  )
}

export interface PdfSettingsFormProps {
  value: PdfOptions
  onChange: (next: PdfOptions) => void
  /** The viewer may not see pay or cost: only the team report, without amounts. */
  moneyHidden: boolean
  /** The viewer may see what clients are charged. */
  billingAvailable: boolean
  /** The currency the report is showing now. */
  resolvedCurrency: string
  projectOptions: string[]
  memberOptions: { id: string; name: string }[]
  /** Which of the given projects have hours but no client rate. */
  projectsWithoutRate: (projectNames: string[]) => string[]
}

/**
 * Everything that decides what a report PDF looks like and says. Used in the
 * Export dialog (beside a live preview) and inside the email dialogs, so an
 * emailed PDF is made from the same choices as a downloaded one.
 */
export function PdfSettingsForm({
  value,
  onChange,
  moneyHidden,
  billingAvailable,
  resolvedCurrency,
  projectOptions,
  memberOptions,
  projectsWithoutRate,
}: PdfSettingsFormProps) {
  const set = (patch: Partial<PdfOptions>) => onChange({ ...value, ...patch })
  const documents: PdfDocument[] = moneyHidden ? ["report"] : billingAvailable ? ["report", "client", "payslip"] : ["report", "payslip"]

  // A choice that is no longer on offer (the viewer's rights, or nobody to pick) falls back.
  useEffect(() => {
    if (!documents.includes(value.document)) onChange({ ...value, document: "report" })
    else if (value.document === "payslip" && memberOptions.length > 0 && !memberOptions.some((m) => m.id === value.memberId)) {
      onChange({ ...value, memberId: memberOptions[0].id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.document, value.memberId, memberOptions, moneyHidden, billingAvailable])

  const unpriced = value.document === "client" ? projectsWithoutRate(value.projectNames) : []
  const picksCurrency = value.document !== "report"
  const today = todayIso()

  function toggleProject(name: string) {
    set({ projectNames: value.projectNames.includes(name) ? value.projectNames.filter((n) => n !== name) : [...value.projectNames, name] })
  }

  return (
    <div className="space-y-6">
      <Section title="Document">
        <Field label="Type" help={DOCUMENT_HELP[value.document]}>
          <FieldSelect
            value={value.document}
            onChange={(next) => set({ document: next as PdfDocument })}
            options={documents.map((d) => ({ value: d, label: DOCUMENT_LABEL[d] }))}
          />
        </Field>

        {value.document === "report" && !moneyHidden ? (
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={value.includeAmounts}
              onChange={(e) => set({ includeAmounts: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500 dark:border-slate-600"
            />
            <span>
              <span className="block text-sm text-slate-700 dark:text-slate-200">Include amounts</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Adds Total spent - what the time cost in pay. Leave off for a report about time only.
              </span>
            </span>
          </label>
        ) : null}

        {value.document === "client" ? (
          <Field
            label="Projects"
            help={value.projectNames.length === 0 ? "None ticked: every project in the range is included." : `${value.projectNames.length} selected.`}
          >
            {projectOptions.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No project has time in this date range.</p>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 py-1 scrollbar-hide dark:border-slate-700">
                {projectOptions.map((name) => {
                  const on = value.projectNames.includes(name)
                  return (
                    <button
                      key={name}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleProject(name)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          on ? "border-blue-500 bg-blue-500" : "border-slate-300 dark:border-slate-600",
                        )}
                      >
                        {on ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                      </span>
                      <span className="truncate">{name}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {unpriced.length > 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                No client hourly rate is set for {unpriced.join(", ")}. Their hours will be listed without an amount - set the rate on
                the project (General &gt; Client hourly rate) to price them.
              </p>
            ) : null}
          </Field>
        ) : null}

        {value.document === "payslip" ? (
          <Field label="Member">
            {memberOptions.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nobody has time in this date range.</p>
            ) : (
              <FieldSelect
                value={value.memberId}
                onChange={(next) => set({ memberId: next })}
                options={memberOptions.map((m) => ({ value: m.id, label: m.name }))}
                placeholder="Choose a member"
              />
            )}
          </Field>
        ) : null}

        {picksCurrency ? (
          <Field
            label="Currency"
            help="Every amount is converted into this currency at the rate of the day the time was worked."
          >
            <FieldSelect
              value={value.currency || AUTOMATIC}
              onChange={(next) => set({ currency: next === AUTOMATIC ? "" : next })}
              options={[
                { value: AUTOMATIC, label: resolvedCurrency ? `Same as the report (${resolvedCurrency})` : "Same as the report" },
                ...PAY_RATE_CURRENCIES.map((c) => ({ value: c.value, label: c.label })),
              ]}
            />
          </Field>
        ) : null}
      </Section>

      <Section title="Design">
        <Field label="Template" help={TEMPLATE_HELP[value.template]}>
          <FieldSelect
            value={value.template}
            onChange={(next) => set({ template: next as PdfTemplate })}
            options={(Object.keys(TEMPLATE_LABEL) as PdfTemplate[]).map((t) => ({ value: t, label: TEMPLATE_LABEL[t] }))}
          />
        </Field>
        <Field label="PDF language" help="Labels, headings and notes. Names are always printed as they are written, in any script.">
          <FieldSelect
            value={value.language}
            onChange={(next) => {
              const language = next as PdfOptions["language"]
              // Arabic reads best with Eastern digits; English with Western ones. Only
              // moved when the format was still the other language's natural one.
              set({
                language,
                numberFormat: language === "ar" && value.numberFormat === "en" ? "ar" : language === "en" && value.numberFormat === "ar" ? "en" : value.numberFormat,
              })
            }}
            options={[
              { value: "en", label: "English" },
              { value: "ar", label: "العربية (Arabic)" },
            ]}
          />
        </Field>
        <Field label="Header note" help="One line printed under the title - payment instructions, a thank-you, a reference number.">
          <Input
            value={value.headerNote}
            onChange={(e) => set({ headerNote: e.target.value })}
            maxLength={300}
            placeholder="Optional"
            className="border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900"
          />
        </Field>
      </Section>

      <Section title="Branding">
        <Field label="Logo" help="JPEG, PNG or WebP, up to 3 MB. It is scaled down before it is saved, and shown at the top of the page.">
          <LogoField value={value.logo} onChange={(logo) => set({ logo })} />
        </Field>
      </Section>

      <Section title="Format">
        <Field label="Date format">
          <FieldSelect
            value={value.dateFormat}
            onChange={(next) => set({ dateFormat: next as PdfOptions["dateFormat"] })}
            options={PDF_DATE_FORMATS.map((f) => ({
              value: f,
              label: `${f}  (${formatDate(today, f, "en", "en")})`,
            }))}
          />
        </Field>
        <Field label="Number format" help="How amounts and times are written. Applies to client statements and pay slips.">
          <FieldSelect
            value={value.numberFormat}
            onChange={(next) => set({ numberFormat: next as PdfNumberFormat })}
            options={(Object.keys(NUMBER_FORMAT_LABEL) as PdfNumberFormat[]).map((f) => ({
              value: f,
              label: `${NUMBER_FORMAT_LABEL[f]}  (${formatNumber(1234.5, f)})`,
            }))}
          />
        </Field>
      </Section>

      <Section title="Show in PDF">
        <div className="space-y-2.5">
          {SHOW_SWITCHES.filter((s) => !s.only || s.only.includes(value.document)).map((s) => (
            <label key={s.key} className="flex cursor-pointer items-start justify-between gap-4">
              <span className="min-w-0">
                <span className="block text-sm text-slate-700 dark:text-slate-200">{s.label}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{s.help}</span>
              </span>
              <Switch
                checked={value.show[s.key]}
                onCheckedChange={(checked) => set({ show: { ...value.show, [s.key]: checked } })}
                aria-label={`Show ${s.label} in the PDF`}
                className="mt-0.5"
              />
            </label>
          ))}
        </div>
      </Section>
    </div>
  )
}
