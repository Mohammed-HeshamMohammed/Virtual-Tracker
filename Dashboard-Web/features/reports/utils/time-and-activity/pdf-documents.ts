import type { TimeActivityEntry } from "@/features/reports/models/time-and-activity"
import type { ReportPdfChart, ReportPdfSpec } from "@/features/reports/utils/pdf/report-pdf-kit"

/**
 * The two documents the Time & Activity report can hand to someone outside
 * the team that reads the report itself:
 *
 *   - a client statement: the hours on the client's projects, priced at what
 *     each project's client pays per hour;
 *   - a pay slip: one member's hours, priced at their own pay rate.
 *
 * Both are built from the report's entries (one per day, member and project),
 * which already carry the amounts in the currency the report was loaded in -
 * the server converts on the day of the work, so nothing is re-priced here.
 *
 * Free of runtime imports so it can be tested without a browser: the result
 * is a description of the document, and report-pdf-kit draws it.
 */

export interface PdfDocumentBase {
  entries: TimeActivityEntry[]
  /** "Sep 1 - Sep 30, 2026", as the report shows it. */
  rangeLabel: string
  orgLabel: string
  /** The currency the entries' amounts are in. */
  currency: string
}

export interface ClientStatementInput extends PdfDocumentBase {
  /** The projects to bill for. Empty means every project in the entries. */
  projectNames: string[]
  /** The statement's date, `YYYY-MM-DD`. Defaults to today; the due date counts from it. */
  issueDate?: string
}

export interface PaySlipInput extends PdfDocumentBase {
  memberId: string
}

const NO_PROJECT = "No project"

function money(amount: number, currency: string): string {
  const rounded = amount.toFixed(2)
  return currency === "USD" ? `$${rounded}` : `${currency} ${rounded}`
}

function clock(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function hoursOf(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

/** "2026-09-28" -> "Mon, Sep 28". The string is a calendar day, so it is read in UTC. */
function dayLabel(date: string, withWeekday = true): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString("en-US", {
    ...(withWeekday ? { weekday: "short" as const } : {}),
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

/** A figure that can be added up: anything that is not a finite number counts as 0,
 *  so one bad row cannot turn a whole total into NaN or Infinity. */
function safe(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function fullDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function workedSeconds(e: TimeActivityEntry): number {
  return e.activeSeconds + e.manualSeconds
}

/**
 * The one currency a document's amounts are in.
 *
 * The server converts every amount into the report's currency, but leaves an
 * amount as it was earned when it has no rate for that day. Adding those up
 * would print a total that is neither currency, so a document that would mix
 * them is refused with a reason the reader can act on.
 */
function singleCurrency(currencies: Iterable<string | undefined>, fallback: string): string {
  const seen = new Set<string>()
  for (const c of currencies) if (c) seen.add(c.toUpperCase())
  if (seen.size > 1) {
    throw new Error(
      `The amounts are in more than one currency (${[...seen].sort().join(", ")}) because no exchange rate was available for part of this range. ` +
        "Choose a currency the report can convert everything into.",
    )
  }
  return seen.size === 1 ? [...seen][0] : fallback
}

/** One rate, or how to say there is not exactly one. */
function rateLabel(rates: Map<string, { rate: number; currency: string }>): string {
  const real = [...rates.values()].filter((r) => r.rate > 0)
  if (real.length === 0) return "Not set"
  if (real.length > 1) return "Varies"
  return `${money(real[0].rate, real[0].currency)} / hour`
}

function hoursByDateChart(byDate: Map<string, number>): ReportPdfChart[] {
  const dates = [...byDate.keys()].sort()
  if (dates.length === 0) return []
  return [
    {
      type: "line",
      title: "Hours by date",
      yLabel: "Hours",
      yUnit: "hours",
      points: dates.map((date) => ({ label: dayLabel(date, false), value: hoursOf(byDate.get(date) ?? 0) })),
      valueFormatter: (hours: number) => clock(hours * 3600),
    },
  ]
}

/** The names an entry list offers for a statement, most hours first. */
export function billableProjectNames(entries: TimeActivityEntry[]): string[] {
  const seconds = new Map<string, number>()
  for (const e of entries) {
    if (!e.projectName) continue
    seconds.set(e.projectName, (seconds.get(e.projectName) ?? 0) + workedSeconds(e))
  }
  return [...seconds.entries()].sort(([, a], [, b]) => b - a).map(([name]) => name)
}

/** Projects among the chosen ones that have hours but no client rate to price them at. */
export function projectsWithoutClientRate(entries: TimeActivityEntry[], projectNames: string[]): string[] {
  const wanted = new Set(projectNames)
  const priced = new Set<string>()
  const seen = new Set<string>()
  for (const e of entries) {
    if (!e.projectName || (wanted.size > 0 && !wanted.has(e.projectName))) continue
    if (workedSeconds(e) <= 0) continue
    seen.add(e.projectName)
    if ((e.billRate ?? 0) > 0) priced.add(e.projectName)
  }
  return [...seen].filter((name) => !priced.has(name)).sort()
}

export function buildClientStatementSpec(input: ClientStatementInput): ReportPdfSpec {
  const wanted = new Set(input.projectNames)
  const rows = input.entries.filter(
    (e) => workedSeconds(e) > 0 && (wanted.size === 0 ? Boolean(e.projectName) : wanted.has(e.projectName)),
  )
  const currency = singleCurrency(
    rows.filter((e) => (e.billAmount ?? 0) !== 0).map((e) => e.billCurrency),
    input.currency,
  )

  type DayLine = { seconds: number; amount: number; members: Set<string> }
  type ProjectBlock = {
    seconds: number
    amount: number
    members: Set<string>
    rates: Map<string, { rate: number; currency: string }>
    days: Map<string, DayLine>
  }
  const projects = new Map<string, ProjectBlock>()
  const byDate = new Map<string, number>()
  const byMember = new Map<string, number>()
  const clients = new Set<string>()
  const allRates = new Map<string, { rate: number; currency: string }>()
  // The client's own invoice terms ride on its billed rows.
  let taxTotal = 0
  const taxRates = new Set<number>()
  const netTerms = new Set<number>()
  let missingNetTerms = false
  const clientNotes = new Set<string>()

  for (const e of rows) {
    const name = e.projectName || NO_PROJECT
    if (!projects.has(name)) projects.set(name, { seconds: 0, amount: 0, members: new Set(), rates: new Map(), days: new Map() })
    const block = projects.get(name)!
    const seconds = workedSeconds(e)
    const amount = safe(e.billAmount)
    const taxRate = safe(e.billTaxRate)
    if (taxRate > 0 && amount > 0) {
      taxTotal += (amount * taxRate) / 100
      taxRates.add(taxRate)
    }
    if (amount > 0) {
      if (e.billNetTermsDays == null) missingNetTerms = true
      else netTerms.add(safe(e.billNetTermsDays))
    }
    if (e.billNotes?.trim()) clientNotes.add(e.billNotes.trim())
    block.seconds += seconds
    block.amount += amount
    block.members.add(e.memberName)
    if ((e.billRate ?? 0) > 0) {
      const rate = { rate: e.billRate as number, currency: e.billRateCurrency || currency }
      block.rates.set(`${rate.rate} ${rate.currency}`, rate)
      allRates.set(`${rate.rate} ${rate.currency}`, rate)
    }
    if (!block.days.has(e.date)) block.days.set(e.date, { seconds: 0, amount: 0, members: new Set() })
    const day = block.days.get(e.date)!
    day.seconds += seconds
    day.amount += amount
    day.members.add(e.memberName)

    byDate.set(e.date, (byDate.get(e.date) ?? 0) + seconds)
    byMember.set(e.memberName, (byMember.get(e.memberName) ?? 0) + seconds)
    if (e.clientName) clients.add(e.clientName)
  }

  const projectNames = [...projects.keys()].sort((a, b) => a.localeCompare(b))
  const totalSeconds = [...projects.values()].reduce((sum, p) => sum + p.seconds, 0)
  const totalAmount = round2([...projects.values()].reduce((sum, p) => sum + p.amount, 0))
  const taxAmount = round2(taxTotal)
  const amountDue = round2(totalAmount + taxAmount)
  const taxLabel = taxRates.size === 1 ? `Tax (${[...taxRates][0]}%)` : "Tax"
  const unpriced = projectNames.filter((name) => projects.get(name)!.rates.size === 0)

  const tableRows: Record<string, string>[] = []
  const rowKinds: ("group" | "detail")[] = []
  for (const name of projectNames) {
    const block = projects.get(name)!
    const priced = block.rates.size > 0
    tableRows.push({
      project: name,
      date: "",
      members: String(block.members.size),
      hours: clock(block.seconds),
      rate: rateLabel(block.rates),
      amount: priced ? money(block.amount, currency) : "-",
    })
    rowKinds.push("group")
    for (const date of [...block.days.keys()].sort()) {
      const day = block.days.get(date)!
      tableRows.push({
        project: "",
        date: dayLabel(date),
        members: [...day.members].sort().join(", "),
        hours: clock(day.seconds),
        rate: "",
        amount: priced ? money(day.amount, currency) : "-",
      })
      rowKinds.push("detail")
    }
  }
  if (projectNames.length > 0) {
    const totalLine = (label: string, amount: number, extra: Partial<Record<string, string>> = {}) => {
      tableRows.push({ project: label, date: "", members: "", hours: "", rate: "", amount: money(amount, currency), ...extra })
      rowKinds.push("group")
    }
    if (taxAmount > 0) {
      totalLine("Subtotal", totalAmount, { members: String(byMember.size), hours: clock(totalSeconds) })
      totalLine(taxLabel, taxAmount)
      totalLine("Total", amountDue)
    } else {
      totalLine("Total", amountDue, { members: String(byMember.size), hours: clock(totalSeconds) })
    }
  }

  // Dates, the way the client's invoices carry them. The due date needs one
  // set of terms; clients with different terms on one statement get none
  // rather than a guess.
  const issueDate = input.issueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.issueDate) ? input.issueDate : todayIso()
  const dueLine =
    netTerms.size === 1 && !missingNetTerms
      ? [`Due: ${fullDay(addDaysIso(issueDate, [...netTerms][0]))} (net ${[...netTerms][0]} days)`]
      : []

  const clientLabel = clients.size === 1 ? [...clients][0] : ""
  const charts: ReportPdfChart[] = [...hoursByDateChart(byDate)]
  const breakdown = projectNames.length > 1
    ? { title: "Hours by project", data: projectNames.map((name) => ({ label: name, value: hoursOf(projects.get(name)!.seconds) })) }
    : { title: "Hours by member", data: [...byMember.entries()].map(([label, seconds]) => ({ label, value: hoursOf(seconds) })) }
  if (breakdown.data.length > 0) {
    charts.push({
      type: "bar",
      title: breakdown.title,
      yLabel: "Hours",
      yUnit: "hours",
      data: breakdown.data.sort((a, b) => b.value - a.value),
      valueFormatter: (hours: number) => clock(hours * 3600),
    })
  }

  const notes = ["Amount is the hours worked on each project multiplied by that project's client hourly rate."]
  if (taxAmount > 0) notes.push("Tax is worked out on each client's own rate, from its invoice terms.")
  if (netTerms.size > 1) {
    notes.push("The clients on this statement have different payment terms, so no single due date is given.")
  }
  for (const note of clientNotes) notes.push(note)
  if (unpriced.length > 0) {
    notes.push(
      `No client hourly rate is set for: ${unpriced.join(", ")}. Their hours are listed but not priced. ` +
        "Set the rate on the project (General > Client hourly rate) and export again.",
    )
  }

  return {
    title: "Client statement",
    subtitle: clientLabel ? `Time worked for ${clientLabel} and what it comes to.` : "Time worked on the selected projects and what it comes to.",
    orgLabel: input.orgLabel,
    rangeLabel: input.rangeLabel,
    filterLines: [
      ...(clientLabel ? [`Client: ${clientLabel}`] : []),
      `Projects: ${projectNames.length > 0 ? projectNames.join(", ") : "None"}`,
      `Issued: ${fullDay(issueDate)}`,
      ...dueLine,
      `Currency: ${currency}`,
    ],
    summary: [
      { label: "Total hours", value: clock(totalSeconds) },
      { label: "Hourly rate", value: rateLabel(allRates) },
      ...(taxAmount > 0
        ? [
            { label: "Subtotal", value: money(totalAmount, currency) },
            { label: taxLabel, value: money(taxAmount, currency) },
          ]
        : []),
      { label: "Amount due", value: money(amountDue, currency) },
    ],
    charts,
    table: {
      columns: [
        { header: "Project", key: "project" },
        { header: "Date", key: "date" },
        { header: "Members", key: "members" },
        { header: "Hours", key: "hours", align: "right" },
        { header: "Rate", key: "rate", align: "right" },
        { header: "Amount", key: "amount", align: "right" },
      ],
      rows: tableRows,
      rowKinds,
      emptyMessage: "No time was tracked on these projects in this range.",
    },
    notes,
    filename: ["client-statement", slug(clientLabel || projectNames.slice(0, 2).join("-")), slug(input.rangeLabel)]
      .filter(Boolean)
      .join("_"),
  }
}

export function buildPaySlipSpec(input: PaySlipInput): ReportPdfSpec {
  const rows = input.entries.filter((e) => e.memberId === input.memberId && workedSeconds(e) > 0)
  const currency = singleCurrency(
    rows.filter((e) => e.spentAmount !== 0).map((e) => e.currency),
    input.currency,
  )
  const memberName = rows[0]?.memberName ?? input.entries.find((e) => e.memberId === input.memberId)?.memberName ?? "Member"

  type DayLine = { tracked: number; manual: number; amount: number; projects: Set<string>; rates: Map<string, { rate: number; currency: string }> }
  const days = new Map<string, DayLine>()
  const allRates = new Map<string, { rate: number; currency: string }>()
  const byDate = new Map<string, number>()

  for (const e of rows) {
    if (!days.has(e.date)) days.set(e.date, { tracked: 0, manual: 0, amount: 0, projects: new Set(), rates: new Map() })
    const day = days.get(e.date)!
    day.tracked += e.activeSeconds
    day.manual += e.manualSeconds
    day.amount += safe(e.spentAmount)
    day.projects.add(e.projectName || NO_PROJECT)
    if (e.payRate > 0) {
      const rate = { rate: e.payRate, currency: e.payRateCurrency }
      day.rates.set(`${rate.rate} ${rate.currency}`, rate)
      allRates.set(`${rate.rate} ${rate.currency}`, rate)
    }
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + workedSeconds(e))
  }

  const dates = [...days.keys()].sort()
  const tracked = dates.reduce((sum, d) => sum + days.get(d)!.tracked, 0)
  const manual = dates.reduce((sum, d) => sum + days.get(d)!.manual, 0)
  const gross = dates.reduce((sum, d) => sum + days.get(d)!.amount, 0)

  const tableRows: Record<string, string>[] = dates.map((date) => {
    const day = days.get(date)!
    return {
      date: dayLabel(date),
      projects: [...day.projects].sort().join(", "),
      tracked: clock(day.tracked),
      manual: clock(day.manual),
      hours: clock(day.tracked + day.manual),
      rate: rateLabel(day.rates),
      amount: money(day.amount, currency),
    }
  })
  const rowKinds: ("group" | "detail")[] = dates.map(() => "detail")
  if (dates.length > 0) {
    tableRows.push({
      date: "Total",
      projects: `${dates.length} ${dates.length === 1 ? "day" : "days"} worked`,
      tracked: clock(tracked),
      manual: clock(manual),
      hours: clock(tracked + manual),
      rate: "",
      amount: money(gross, currency),
    })
    rowKinds.push("group")
  }

  const notes = [
    "Gross pay is the hours worked each day multiplied by the hourly pay rate set for this member on the Members page. " +
      "Taxes, deductions and anything already paid are not included.",
  ]
  if (allRates.size === 0 && dates.length > 0) {
    notes.push("No pay rate is set for this member, so the hours are listed without an amount. Set it on the Members page and export again.")
  }
  if (allRates.size > 1) notes.push("The pay rate changed during this period; each day uses the rate that applied on that day.")

  return {
    title: "Pay slip",
    subtitle: `Hours worked by ${memberName} and the pay they come to.`,
    orgLabel: input.orgLabel,
    rangeLabel: input.rangeLabel,
    filterLines: [`Employee: ${memberName}`, `Pay period: ${input.rangeLabel}`, `Currency: ${currency}`],
    orientation: "portrait",
    summary: [
      { label: "Total hours", value: clock(tracked + manual) },
      { label: "Pay rate", value: rateLabel(allRates) },
      { label: "Gross pay", value: money(gross, currency) },
    ],
    charts: hoursByDateChart(byDate),
    table: {
      columns: [
        { header: "Date", key: "date" },
        { header: "Projects", key: "projects" },
        { header: "Tracked", key: "tracked", align: "right" },
        { header: "Manual", key: "manual", align: "right" },
        { header: "Total hours", key: "hours", align: "right" },
        { header: "Rate", key: "rate", align: "right" },
        { header: "Amount", key: "amount", align: "right" },
      ],
      rows: tableRows,
      rowKinds,
      emptyMessage: "No time was tracked by this member in this range.",
    },
    notes,
    filename: ["pay-slip", slug(memberName), slug(input.rangeLabel)].filter(Boolean).join("_"),
  }
}
