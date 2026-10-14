import type { PdfChart, PdfColumn, PdfRowKind, PdfSpec, PdfTotalRow } from "./kit.ts"
import {
  addDaysIso,
  formatClock,
  toLocaleDigits,
  formatDate,
  formatMoney,
  formatShortDate,
  round2,
  safeNumber,
  todayIso,
} from "./format.ts"
import { getLabels, type PdfLabels } from "./labels.ts"
import type { PdfOptions } from "./options.ts"

/**
 * The three documents the Time & Activity report can be turned into:
 *
 *   - the team report: the table and charts the page shows, for your own people;
 *   - a client statement: the hours on a client's projects, priced at what each
 *     project's client pays per hour, with the client's own tax and terms;
 *   - a pay slip: one member's hours, priced at their own pay rate.
 *
 * They are built from the report's entries (one per day, member and project),
 * which already carry every amount in the currency the report was loaded in -
 * the server converts on the day of the work, so nothing is re-priced here.
 * The result is a description of the document; kit.ts draws it.
 */

export interface PdfEntry {
  date: string
  memberId: string
  memberName: string
  projectId?: string | null
  projectName: string
  clientName: string
  teamName?: string
  activeSeconds: number
  idleSeconds: number
  manualSeconds: number
  spentAmount: number
  currency: string
  /** The member's hourly pay rate on this day, in the currency it is paid in. */
  payRate: number
  payRateCurrency: string
  /** What the project's client is charged per hour, and for this row's hours. */
  billRate?: number
  billRateCurrency?: string
  billAmount?: number
  billCurrency?: string
  /** The client's own invoice terms, when it has set custom ones. */
  billTaxRate?: number
  billNetTermsDays?: number
  billNotes?: string
}

/** An entry as the server sends it, with every optional field made safe. */
export function normalizeEntry(raw: Record<string, unknown>): PdfEntry {
  const text = (v: unknown) => (typeof v === "string" ? v : "")
  const maybeNumber = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
  return {
    date: text(raw.date),
    memberId: text(raw.memberId),
    memberName: text(raw.memberName),
    projectId: typeof raw.projectId === "string" ? raw.projectId : null,
    projectName: text(raw.projectName),
    clientName: text(raw.clientName),
    teamName: text(raw.teamName),
    activeSeconds: safeNumber(raw.activeSeconds),
    idleSeconds: safeNumber(raw.idleSeconds),
    manualSeconds: safeNumber(raw.manualSeconds),
    spentAmount: safeNumber(raw.spentAmount),
    currency: text(raw.currency) || "USD",
    payRate: safeNumber(raw.payRate),
    payRateCurrency: text(raw.payRateCurrency) || text(raw.currency) || "USD",
    billRate: maybeNumber(raw.billRate),
    billRateCurrency: text(raw.billRateCurrency) || undefined,
    billAmount: maybeNumber(raw.billAmount),
    billCurrency: text(raw.billCurrency) || undefined,
    billTaxRate: maybeNumber(raw.billTaxRate),
    billNetTermsDays: maybeNumber(raw.billNetTermsDays),
    billNotes: text(raw.billNotes) || undefined,
  }
}

export interface DocumentBase {
  entries: PdfEntry[]
  /** "Sep 1 - Sep 30, 2026", as the report shows it. */
  rangeLabel: string
  orgLabel: string
  /** The currency the entries' amounts are in. */
  currency: string
}

export interface ClientStatementInput extends DocumentBase {
  /** The projects to bill for. Empty means every project in the entries. */
  projectNames: string[]
  /** The statement's date, `YYYY-MM-DD`. Defaults to today; the due date counts from it. */
  issueDate?: string
}

export interface PaySlipInput extends DocumentBase {
  memberId: string
}

const NO_PROJECT = "—"

function workedSeconds(e: PdfEntry): number {
  return e.activeSeconds + e.manualSeconds
}

function hoursOf(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function joinNames(L: PdfLabels, names: string[]): string {
  return names.join(L.dir === "rtl" ? "، " : ", ")
}

/**
 * The one currency a document's amounts are in.
 *
 * The server converts every amount into the report's currency, but leaves an
 * amount as it was earned when it has no rate for that day. Adding those up
 * would print a total that is neither currency, so a document that would mix
 * them is refused with a reason the reader can act on.
 */
export function singleCurrency(currencies: Iterable<string | undefined>, fallback: string): string {
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

type Rates = Map<string, { rate: number; currency: string }>

/** One rate, or how to say there is not exactly one. */
function rateLabel(rates: Rates, L: PdfLabels, o: PdfOptions): string {
  const real = [...rates.values()].filter((r) => r.rate > 0)
  if (real.length === 0) return L.notSet
  if (real.length > 1) return L.varies
  return `${formatMoney(real[0].rate, real[0].currency, o.numberFormat)} / ${L.perHour}`
}

function dateChart(L: PdfLabels, o: PdfOptions, byDate: Map<string, number>, title: string): PdfChart[] {
  const dates = [...byDate.keys()].sort()
  if (dates.length === 0) return []
  return [
    {
      type: "line",
      title,
      yLabel: L.hoursAxis,
      yUnit: "hours",
      points: dates.map((date) => ({
        label: formatShortDate(date, o.dateFormat, o.language, o.numberFormat),
        value: hoursOf(byDate.get(date) ?? 0),
      })),
      valueFormatter: (hours: number) => formatClock(hours * 3600, o.numberFormat),
    },
  ]
}

function barChart(L: PdfLabels, o: PdfOptions, title: string, data: { label: string; value: number }[]): PdfChart[] {
  if (data.length === 0) return []
  return [
    {
      type: "bar",
      title,
      yLabel: L.hoursAxis,
      yUnit: "hours",
      data: [...data].sort((a, b) => b.value - a.value),
      valueFormatter: (hours: number) => formatClock(hours * 3600, o.numberFormat),
    },
  ]
}

/** The names an entry list offers for a statement, most hours first. */
export function billableProjectNames(entries: PdfEntry[]): string[] {
  const seconds = new Map<string, number>()
  for (const e of entries) {
    if (!e.projectName) continue
    seconds.set(e.projectName, (seconds.get(e.projectName) ?? 0) + workedSeconds(e))
  }
  return [...seconds.entries()].sort(([, a], [, b]) => b - a).map(([name]) => name)
}

/** Projects among the chosen ones that have hours but no client rate to price them at. */
export function projectsWithoutClientRate(entries: PdfEntry[], projectNames: string[]): string[] {
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

export function buildClientStatementSpec(input: ClientStatementInput, o: PdfOptions): PdfSpec {
  const L = getLabels(o.language)
  const money = (amount: number, currency: string) => formatMoney(amount, currency, o.numberFormat)
  const wanted = new Set(input.projectNames)
  const rows = input.entries.filter(
    (e) => workedSeconds(e) > 0 && (wanted.size === 0 ? Boolean(e.projectName) : wanted.has(e.projectName)),
  )
  const currency = singleCurrency(
    rows.filter((e) => safeNumber(e.billAmount) !== 0).map((e) => e.billCurrency),
    input.currency,
  )

  type DayLine = { seconds: number; amount: number; members: Set<string> }
  type ProjectBlock = {
    seconds: number
    amount: number
    members: Set<string>
    rates: Rates
    days: Map<string, DayLine>
  }
  const projects = new Map<string, ProjectBlock>()
  const byDate = new Map<string, number>()
  const byMember = new Map<string, number>()
  const clients = new Set<string>()
  const allRates: Rates = new Map()
  // The client's own invoice terms ride on its billed rows.
  let taxTotal = 0
  const taxRates = new Set<number>()
  const netTerms = new Set<number>()
  // A billed client with no terms of its own has no due date to offer, and must
  // not be given another client's.
  let missingNetTerms = false
  const clientNotes = new Set<string>()

  for (const e of rows) {
    const name = e.projectName || NO_PROJECT
    if (!projects.has(name)) projects.set(name, { seconds: 0, amount: 0, members: new Set(), rates: new Map(), days: new Map() })
    const block = projects.get(name)!
    const seconds = workedSeconds(e)
    const amount = safeNumber(e.billAmount)
    const taxRate = safeNumber(e.billTaxRate)
    if (taxRate > 0 && amount > 0) {
      taxTotal += (amount * taxRate) / 100
      taxRates.add(taxRate)
    }
    if (amount > 0) {
      if (e.billNetTermsDays == null) missingNetTerms = true
      else netTerms.add(safeNumber(e.billNetTermsDays))
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
  const taxLabel = taxRates.size === 1 ? `${L.tax} (${toLocaleDigits(String([...taxRates][0]), o.numberFormat)}%)` : L.tax
  const unpriced = projectNames.filter((name) => projects.get(name)!.rates.size === 0)
  const clock = (seconds: number) => formatClock(seconds, o.numberFormat)
  const num = (n: number | string) => toLocaleDigits(String(n), o.numberFormat)

  // Columns the reader may switch off. Each row below fills every key; the
  // ones that are off are simply not in `columns`.
  const columns: PdfColumn[] = [
    { header: L.project, key: "project" },
    { header: L.date, key: "date" },
    ...(o.show.members ? [{ header: L.members, key: "members" } as PdfColumn] : []),
    { header: L.hours, key: "hours", align: "right" },
    ...(o.show.rate ? [{ header: L.rate, key: "rate", align: "right" } as PdfColumn] : []),
    { header: L.amount, key: "amount", align: "right" },
  ]

  const tableRows: Record<string, string>[] = []
  const rowKinds: PdfRowKind[] = []
  for (const name of projectNames) {
    const block = projects.get(name)!
    const priced = block.rates.size > 0
    tableRows.push({
      project: name,
      date: "",
      members: num(block.members.size),
      hours: clock(block.seconds),
      rate: rateLabel(block.rates, L, o),
      amount: priced ? money(block.amount, currency) : "-",
    })
    rowKinds.push("group")
    if (!o.show.details) continue
    for (const date of [...block.days.keys()].sort()) {
      const day = block.days.get(date)!
      tableRows.push({
        project: "",
        date: formatDate(date, o.dateFormat, o.language, o.numberFormat),
        members: joinNames(L, [...day.members].sort()),
        hours: clock(day.seconds),
        rate: "",
        amount: priced ? money(day.amount, currency) : "-",
      })
      rowKinds.push("detail")
    }
  }
  if (projectNames.length > 0) {
    const totalLine = (label: string, amount: number, extra: Record<string, string> = {}) => {
      tableRows.push({ project: label, date: "", members: "", hours: "", rate: "", amount: money(amount, currency), ...extra })
      rowKinds.push("total")
    }
    if (taxAmount > 0) {
      totalLine(L.subtotal, totalAmount, { members: num(byMember.size), hours: clock(totalSeconds) })
      totalLine(taxLabel, taxAmount)
      totalLine(L.total, amountDue)
    } else {
      totalLine(L.total, amountDue, { members: num(byMember.size), hours: clock(totalSeconds) })
    }
  }

  // Dates, the way the client's invoices carry them. The due date needs one
  // set of terms; clients with different terms on one statement get none
  // rather than a guess.
  const issueDate = input.issueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.issueDate) ? input.issueDate : todayIso()
  const fmtDate = (iso: string) => formatDate(iso, o.dateFormat, o.language, o.numberFormat)
  const dueDays = netTerms.size === 1 && !missingNetTerms ? [...netTerms][0] : null
  const dueDateText = dueDays === null ? "" : fmtDate(addDaysIso(issueDate, dueDays))
  const documentNumber = `CS-${issueDate.replace(/-/g, "")}`

  // What the invoice-style templates set out as a block under the table.
  const totals: PdfTotalRow[] =
    taxAmount > 0
      ? [
          { label: L.subtotal, value: money(totalAmount, currency) },
          { label: taxLabel, value: money(taxAmount, currency) },
          { label: L.amountDue, value: money(amountDue, currency), strong: true },
        ]
      : [{ label: L.amountDue, value: money(amountDue, currency), strong: true }]

  const clientLabel = clients.size === 1 ? [...clients][0] : ""
  const charts: PdfChart[] = [
    ...dateChart(L, o, byDate, L.hoursByDate),
    ...(projectNames.length > 1
      ? barChart(L, o, L.hoursByProject, projectNames.map((name) => ({ label: name, value: hoursOf(projects.get(name)!.seconds) })))
      : barChart(L, o, L.hoursByMember, [...byMember.entries()].map(([label, seconds]) => ({ label, value: hoursOf(seconds) })))),
  ]

  const notes = [L.noteAmount]
  if (taxAmount > 0) notes.push(L.noteTax)
  if (netTerms.size > 1 || (missingNetTerms && netTerms.size > 0)) notes.push(L.noteTermsDiffer)
  for (const note of clientNotes) notes.push(note)
  if (unpriced.length > 0) notes.push(L.noteUnpriced(joinNames(L, unpriced)))

  return {
    title: L.clientTitle,
    subtitle: clientLabel ? L.clientSubtitle(clientLabel) : L.clientSubtitleGeneric,
    orgLabel: input.orgLabel,
    rangeLabel: input.rangeLabel,
    info: [
      { label: L.documentNumber, value: documentNumber },
      { label: L.dateIssued, value: fmtDate(issueDate) },
      ...(dueDateText ? [{ label: L.dateDue, value: dueDateText }] : []),
    ],
    filterLines: [
      ...(clientLabel ? [`${L.client}: ${clientLabel}`] : []),
      `${L.projects}: ${projectNames.length > 0 ? joinNames(L, projectNames) : "-"}`,
      `${L.currency}: ${currency}`,
    ],
    parties: {
      from: { title: L.from, name: input.orgLabel },
      to: {
        title: L.billTo,
        name: clientLabel || (projectNames.length > 0 ? joinNames(L, projectNames) : "-"),
        ...(clientLabel && projectNames.length > 0 ? { lines: [`${L.projects}: ${joinNames(L, projectNames)}`] } : {}),
      },
    },
    totals: projectNames.length > 0 ? totals : undefined,
    summary: [
      { label: L.totalHours, value: clock(totalSeconds) },
      ...(o.show.rate ? [{ label: L.hourlyRate, value: rateLabel(allRates, L, o) }] : []),
      ...(taxAmount > 0
        ? [
            { label: L.subtotal, value: money(totalAmount, currency) },
            { label: taxLabel, value: money(taxAmount, currency) },
          ]
        : []),
      { label: L.amountDue, value: money(amountDue, currency) },
    ],
    headline: {
      label: L.amountDue,
      value: money(amountDue, currency),
      ...(dueDateText ? { due: dueDateText } : {}),
    },
    charts,
    table: { columns, rows: tableRows, rowKinds, emptyMessage: L.emptyClient },
    notes,
    documentNumber,
    filename: ["client-statement", slug(clientLabel || projectNames.slice(0, 2).join("-")), slug(input.rangeLabel)]
      .filter(Boolean)
      .join("_"),
  }
}

export function buildPaySlipSpec(input: PaySlipInput, o: PdfOptions): PdfSpec {
  const L = getLabels(o.language)
  const money = (amount: number, currency: string) => formatMoney(amount, currency, o.numberFormat)
  const clock = (seconds: number) => formatClock(seconds, o.numberFormat)
  const rows = input.entries.filter((e) => e.memberId === input.memberId && workedSeconds(e) > 0)
  const currency = singleCurrency(
    rows.filter((e) => safeNumber(e.spentAmount) !== 0).map((e) => e.currency),
    input.currency,
  )
  const memberName = rows[0]?.memberName ?? input.entries.find((e) => e.memberId === input.memberId)?.memberName ?? L.member

  type DayLine = { tracked: number; manual: number; amount: number; projects: Set<string>; rates: Rates }
  const days = new Map<string, DayLine>()
  const allRates: Rates = new Map()
  const byDate = new Map<string, number>()

  for (const e of rows) {
    if (!days.has(e.date)) days.set(e.date, { tracked: 0, manual: 0, amount: 0, projects: new Set(), rates: new Map() })
    const day = days.get(e.date)!
    day.tracked += e.activeSeconds
    day.manual += e.manualSeconds
    day.amount += safeNumber(e.spentAmount)
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
  const gross = round2(dates.reduce((sum, d) => sum + days.get(d)!.amount, 0))

  const columns: PdfColumn[] = [
    { header: L.date, key: "date" },
    ...(o.show.members ? [{ header: L.projects, key: "projects" } as PdfColumn] : []),
    { header: L.tracked, key: "tracked", align: "right" },
    { header: L.manual, key: "manual", align: "right" },
    { header: L.hours, key: "hours", align: "right" },
    ...(o.show.rate ? [{ header: L.rate, key: "rate", align: "right" } as PdfColumn] : []),
    { header: L.amount, key: "amount", align: "right" },
  ]

  const tableRows: Record<string, string>[] = []
  const rowKinds: PdfRowKind[] = []
  if (o.show.details) {
    for (const date of dates) {
      const day = days.get(date)!
      tableRows.push({
        date: formatDate(date, o.dateFormat, o.language, o.numberFormat),
        projects: joinNames(L, [...day.projects].sort()),
        tracked: clock(day.tracked),
        manual: clock(day.manual),
        hours: clock(day.tracked + day.manual),
        rate: rateLabel(day.rates, L, o),
        amount: money(day.amount, currency),
      })
      rowKinds.push("detail")
    }
  }
  if (dates.length > 0) {
    tableRows.push({
      date: L.total,
      projects: L.daysWorked(dates.length, toLocaleDigits(String(dates.length), o.numberFormat)),
      tracked: clock(tracked),
      manual: clock(manual),
      hours: clock(tracked + manual),
      rate: "",
      amount: money(gross, currency),
    })
    rowKinds.push("total")
  }

  const notes = [L.notePayGross]
  if (allRates.size === 0 && dates.length > 0) notes.push(L.notePayNoRate)
  if (allRates.size > 1) notes.push(L.notePayRateChanged)

  return {
    title: L.payslipTitle,
    subtitle: L.payslipSubtitle(memberName),
    orgLabel: input.orgLabel,
    rangeLabel: input.rangeLabel,
    // The pay period is the range label every template already prints.
    info: [{ label: L.documentNumber, value: `PS-${slug(memberName) || "member"}` }],
    filterLines: [`${L.employee}: ${memberName}`, `${L.currency}: ${currency}`],
    parties: {
      from: { title: L.from, name: input.orgLabel },
      to: { title: L.employee, name: memberName },
    },
    totals:
      dates.length > 0
        ? [
            { label: L.totalHours, value: clock(tracked + manual) },
            { label: L.grossPay, value: money(gross, currency), strong: true },
          ]
        : undefined,
    orientation: "portrait",
    summary: [
      { label: L.totalHours, value: clock(tracked + manual) },
      ...(o.show.rate ? [{ label: L.payRate, value: rateLabel(allRates, L, o) }] : []),
      { label: L.grossPay, value: money(gross, currency) },
    ],
    headline: { label: L.grossPay, value: money(gross, currency), sub: input.rangeLabel },
    charts: dateChart(L, o, byDate, L.hoursByDate),
    table: { columns, rows: tableRows, rowKinds, emptyMessage: L.emptyPayslip },
    notes,
    documentNumber: `PS-${slug(memberName) || "member"}`,
    filename: ["pay-slip", slug(memberName), slug(input.rangeLabel)].filter(Boolean).join("_"),
  }
}

// ── the team report ────────────────────────────────────────────────────────

export type TeamGroupKey = "date" | "week" | "member" | "project" | "client" | "team"

export interface TeamReportInput {
  groupKey: TeamGroupKey
  /** What the expanded rows under a group are. */
  detailKind: "member" | "project"
  orgLabel: string
  timezoneLabel?: string
  rangeLabel: string
  filters: {
    members: string[]
    projects: string[]
    trackedTime?: string
    manualTime?: string
    activityLevel?: string
    currency?: string
  }
  totals: { time: string; activity: number; spent: string }
  /** Hours per group - per day when grouped by date, per member or project otherwise. */
  hoursByGroup: { label: string; iso?: string; value: number }[]
  hoursByMember: { label: string; value: number }[]
  table: {
    columns: PdfColumn[]
    rows: Record<string, string>[]
    rowKinds: PdfRowKind[]
    /** Parallel to rows: the calendar day a row belongs to, when the table is by date. */
    rowIso?: (string | undefined)[]
  }
  /** The money columns and the Total spent card are left out. */
  withoutMoney: boolean
  filename: string
}

export function buildTeamReportSpec(input: TeamReportInput, o: PdfOptions): PdfSpec {
  const L = getLabels(o.language)
  const groupLabel = L[input.groupKey]
  const clockHours = (hours: number) => formatClock(hours * 3600, o.numberFormat)
  const fmtDate = (iso: string) => formatDate(iso, o.dateFormat, o.language, o.numberFormat)

  const columns: PdfColumn[] = input.table.columns.map((col) => {
    const header =
      col.key === "__group"
        ? groupLabel
        : col.key === "__detail"
          ? input.detailKind === "member"
            ? L.member
            : L.project
          : (L.columns[col.key] ?? col.header)
    return { ...col, header }
  })
  const rows = input.table.rows.map((row, index) => {
    const out = { ...row }
    const iso = input.table.rowIso?.[index]
    if (iso) out.__group = fmtDate(iso)
    if (input.table.rowKinds[index] === "group" && "__detail" in out) out.__detail = L.allDetail(input.detailKind)
    return out
  })

  const f = input.filters
  const filterLines = [
    `${L.filterMembers}: ${f.members.length === 0 ? L.allMembers : joinNames(L, f.members)}`,
    `${L.filterProjects}: ${f.projects.length === 0 ? L.allProjects : joinNames(L, f.projects)}`,
    `${L.groupedBy}: ${groupLabel}`,
    ...(f.trackedTime ? [`${L.trackedTime}: ${f.trackedTime}`] : []),
    ...(f.manualTime ? [`${L.manualTime}: ${f.manualTime}`] : []),
    ...(f.activityLevel ? [`${L.activityLevel}: ${f.activityLevel}`] : []),
    ...(!input.withoutMoney && f.currency ? [`${L.currency}: ${f.currency}`] : []),
  ]

  const byDate = input.groupKey === "date"
  const charts: PdfChart[] = []
  if (input.hoursByGroup.length > 0) {
    charts.push({
      type: "line",
      title: L.trackedHoursBy(groupLabel),
      yLabel: L.hoursAxis,
      yUnit: "hours",
      points: input.hoursByGroup.map((p) => ({
        label: byDate && p.iso ? formatShortDate(p.iso, o.dateFormat, o.language, o.numberFormat) : p.label,
        value: p.value,
      })),
      valueFormatter: clockHours,
    })
  }
  charts.push(...barChart(L, o, L.trackedHoursByMember, input.hoursByMember))

  return {
    title: L.teamTitle(groupLabel),
    subtitle: input.withoutMoney ? L.teamSubtitle : L.teamSubtitleMoney,
    orgLabel: input.orgLabel,
    timezoneLabel: input.timezoneLabel,
    rangeLabel: input.rangeLabel,
    filterLines,
    orientation: columns.length > 7 ? "landscape" : "portrait",
    summary: [
      { label: L.totalTime, value: toDigits(input.totals.time, o) },
      { label: L.averageActivity, value: toDigits(`${input.totals.activity}%`, o) },
      ...(input.withoutMoney ? [] : [{ label: L.totalSpent, value: input.totals.spent }]),
    ],
    charts,
    table: { columns, rows, rowKinds: input.table.rowKinds, emptyMessage: L.emptyTeam },
    filename: input.filename,
  }
}

function toDigits(text: string, o: PdfOptions): string {
  return o.numberFormat === "ar" ? text.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]) : text
}

/** The payload a scheduled or emailed team report is built from, as a team-report input. */
export function teamReportInputFromPayload(
  payload: {
    days: {
      date: string
      members: { name: string; activeSeconds: number; idleSeconds: number; manualSeconds?: number; spentAmount?: number; currency?: string }[]
    }[]
    moneyHidden?: boolean
    currency?: { displayCurrency?: string }
  },
  context: { orgLabel: string; rangeLabel: string },
  o: PdfOptions,
): TeamReportInput {
  const L = getLabels(o.language)
  const clock = (seconds: number) => formatClock(seconds, o.numberFormat)
  const withoutMoney = payload.moneyHidden === true || !o.includeAmounts

  let totalActive = 0
  let totalIdle = 0
  const spentBy = new Map<string, number>()
  const byMember = new Map<string, number>()
  const hoursByGroup: TeamReportInput["hoursByGroup"] = []
  const rows: Record<string, string>[] = []
  const rowKinds: ("group" | "detail")[] = []
  const rowIso: (string | undefined)[] = []

  for (const day of payload.days) {
    let dayActive = 0
    let dayIdle = 0
    let daySpent = 0
    const dayCurrency = new Set<string>()
    for (const m of day.members) {
      dayActive += m.activeSeconds
      dayIdle += m.idleSeconds
      byMember.set(m.name, (byMember.get(m.name) ?? 0) + m.activeSeconds)
      const spent = safeNumber(m.spentAmount)
      daySpent += spent
      const currency = (m.currency || payload.currency?.displayCurrency || "USD").toUpperCase()
      dayCurrency.add(currency)
      spentBy.set(currency, (spentBy.get(currency) ?? 0) + spent)
    }
    totalActive += dayActive
    totalIdle += dayIdle
    hoursByGroup.push({ label: day.date, iso: day.date, value: hoursOf(dayActive) })

    rows.push({
      __group: day.date,
      __detail: "",
      active: clock(dayActive),
      idle: clock(dayIdle),
      spent: formatMoney(daySpent, [...dayCurrency][0] ?? "USD", o.numberFormat),
    })
    rowKinds.push("group")
    rowIso.push(day.date)
    for (const m of day.members) {
      rows.push({
        __group: day.date,
        __detail: m.name,
        active: clock(m.activeSeconds),
        idle: clock(m.idleSeconds),
        spent: formatMoney(safeNumber(m.spentAmount), (m.currency || payload.currency?.displayCurrency || "USD").toUpperCase(), o.numberFormat),
      })
      rowKinds.push("detail")
      rowIso.push(day.date)
    }
  }

  const tracked = totalActive + totalIdle
  const spentText =
    [...spentBy.entries()].map(([currency, amount]) => formatMoney(amount, currency, o.numberFormat)).join(" + ") ||
    formatMoney(0, payload.currency?.displayCurrency ?? "USD", o.numberFormat)

  return {
    groupKey: "date",
    detailKind: "member",
    orgLabel: context.orgLabel,
    rangeLabel: context.rangeLabel,
    filters: { members: [], projects: [], currency: payload.currency?.displayCurrency },
    totals: { time: clock(totalActive), activity: tracked > 0 ? Math.round((totalActive / tracked) * 100) : 0, spent: spentText },
    hoursByGroup,
    hoursByMember: [...byMember.entries()].map(([label, seconds]) => ({ label, value: hoursOf(seconds) })),
    table: {
      columns: [
        { header: L.date, key: "__group" },
        { header: L.member, key: "__detail" },
        { header: L.active, key: "active", align: "right" },
        { header: L.idle, key: "idle", align: "right" },
        ...(withoutMoney ? [] : [{ header: L.totalSpent, key: "spent", align: "right" } as PdfColumn]),
      ],
      rows,
      rowKinds,
      rowIso,
    },
    withoutMoney,
    filename: "time-and-activity",
  }
}
