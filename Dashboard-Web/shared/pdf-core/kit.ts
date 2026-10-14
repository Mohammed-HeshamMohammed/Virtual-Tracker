import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { CAIRO_BOLD_BASE64, CAIRO_REGULAR_BASE64 } from "./fonts.ts"
import { hasArabic, visualOrder } from "./bidi.ts"
import { formatAxisHours, formatAxisNumber, formatDate, toLocaleDigits, todayIso } from "./format.ts"
import { getLabels, type PdfLabels } from "./labels.ts"
import type { PdfOptions, PdfTemplate } from "./options.ts"

export type PdfAlign = "left" | "right" | "center"
export type PdfAxisUnit = "number" | "hours"

export interface PdfColumn {
  header: string
  key: string
  align?: PdfAlign
  width?: number
}

export interface PdfSummaryItem {
  label: string
  value: string
}

interface PdfYAxis {
  /** Printed sideways beside the axis: what the numbers are ("Hours"). */
  yLabel?: string
  yUnit?: PdfAxisUnit
  /** Overrides the gridline labels the unit would give. */
  yTickFormatter?: (value: number) => string
}

export interface PdfBarChart extends PdfYAxis {
  type: "bar"
  title: string
  data: { label: string; value: number }[]
  valueFormatter?: (value: number) => string
  color?: [number, number, number]
}

export interface PdfLineChart extends PdfYAxis {
  type: "line"
  title: string
  points: { label: string; value: number }[]
  valueFormatter?: (value: number) => string
  color?: [number, number, number]
}

export interface PdfProgressChart {
  type: "progress"
  title: string
  rows: { label: string; pct: number; sublabel?: string }[]
}

export type PdfChart = PdfBarChart | PdfLineChart | PdfProgressChart

/** One of the two parties on an invoice-style document: who it is from, who it is for. */
export interface PdfParty {
  title: string
  name: string
  lines?: string[]
}

/** A labelled fact in the document's header: its number, the dates. */
export interface PdfInfoRow {
  label: string
  value: string
}

/** A line of the totals block under the table. */
export interface PdfTotalRow {
  label: string
  value: string
  /** The line that matters: what is due, what is paid. */
  strong?: boolean
}

export type PdfRowKind = "group" | "detail" | "total"

export interface PdfSpec {
  title: string
  subtitle?: string
  orgLabel: string
  timezoneLabel?: string
  rangeLabel?: string
  scopeLabel?: string
  /** One line per applied filter or fact about the document. */
  filterLines?: string[]
  /** The document's number and dates. Invoice-style templates set them out as a block. */
  info?: PdfInfoRow[]
  parties?: { from?: PdfParty; to?: PdfParty }
  /** Wide tables (many columns) do not fit portrait without crushing. */
  orientation?: "portrait" | "landscape"
  summary?: PdfSummaryItem[]
  /** The one figure the invoice-style templates lead with; `due` is the formatted due date. */
  headline?: { label: string; value: string; sub?: string; due?: string }
  charts?: PdfChart[]
  table: {
    columns: PdfColumn[]
    rows: Record<string, string | number>[]
    /** Parallel to rows. "group" rows are subtotal lines, "detail" the lines under them,
     *  "total" the final lines - which the invoice-style templates draw as a block instead. */
    rowKinds?: PdfRowKind[]
    emptyMessage?: string
  }
  /** What goes in the totals block under the table (invoice-style templates). */
  totals?: PdfTotalRow[]
  /** Small print under the table: how a figure was worked out, or what is missing from it. */
  notes?: string[]
  /** Printed in the footer beside the amount. */
  documentNumber?: string
  filename: string
}

type RGB = [number, number, number]

interface Theme {
  format: "a4" | "letter"
  margin: number
  ink: RGB
  muted: RGB
  rule: RGB
  brand: RGB
  headFill: RGB | null
  headText: RGB
  groupFill: RGB | null
  zebra: RGB | null
}

const THEMES: Record<PdfTemplate, Theme> = {
  "virtual-tracker": {
    format: "a4",
    margin: 40,
    ink: [30, 41, 59],
    muted: [100, 116, 139],
    rule: [226, 232, 240],
    brand: [37, 99, 235],
    headFill: [37, 99, 235],
    headText: [255, 255, 255],
    groupFill: [239, 246, 255],
    zebra: [248, 250, 252],
  },
  classic: {
    format: "a4",
    margin: 30,
    ink: [0, 0, 0],
    muted: [90, 90, 90],
    rule: [128, 128, 128],
    brand: [37, 99, 235],
    headFill: null,
    headText: [0, 0, 0],
    groupFill: null,
    zebra: null,
  },
  stripe: {
    format: "letter",
    margin: 30,
    ink: [17, 24, 39],
    muted: [107, 114, 128],
    rule: [229, 231, 235],
    brand: [99, 91, 255],
    headFill: null,
    headText: [17, 24, 39],
    groupFill: null,
    zebra: null,
  },
}

const STRIPE_BAR: RGB = [251, 191, 36]
const CHART_HEIGHT = 140
const Y_TICKS = 4
const HOUR_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12]
const ROUND_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/**
 * The scale of a chart's Y axis: a round top value and the step between its
 * gridlines, so every gridline can carry a label a reader can use ("2h", "4h")
 * instead of whatever a quarter of the largest value happens to be.
 */
export function yAxisScale(maxValue: number, unit: PdfAxisUnit = "number"): { top: number; step: number } {
  const max = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1
  const hourStep = unit === "hours" ? HOUR_STEPS.find((s) => s * Y_TICKS >= max) : undefined
  if (hourStep) return { top: hourStep * Y_TICKS, step: hourStep }
  const raw = max / Y_TICKS
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const multipliers = unit === "hours" ? ROUND_STEPS : [1, 2, 2.5, 5, 10]
  const step = (multipliers.find((m) => m * magnitude >= raw - 1e-9) ?? 10) * magnitude
  return { top: step * Y_TICKS, step }
}

interface Ctx {
  doc: jsPDF
  o: PdfOptions
  L: PdfLabels
  rtl: boolean
  theme: Theme
  pageW: number
  pageH: number
  /** The lowest a line of content may go before a new page is needed. */
  bottom: number
}

interface SayStyle {
  size: number
  bold?: boolean
  color: RGB
  align?: PdfAlign
  maxWidth?: number
  angle?: number
  /** Draw where it is told, left to right, whatever the document's direction (chart geometry). */
  fixed?: boolean
}

function registerFonts(doc: jsPDF) {
  doc.addFileToVFS("Cairo-Regular.ttf", CAIRO_REGULAR_BASE64)
  doc.addFont("Cairo-Regular.ttf", "Cairo", "normal")
  doc.addFileToVFS("Cairo-Bold.ttf", CAIRO_BOLD_BASE64)
  doc.addFont("Cairo-Bold.ttf", "Cairo", "bold")
}

/**
 * jsPDF reorders any Arabic it is given as if the text were in reading order.
 * It has already been put in drawing order here (see bidi.ts), so every text
 * call - ours and autoTable's - is told its input is already visual and its
 * output should be too, which leaves it exactly as given.
 */
function forceVisualText(doc: jsPDF) {
  const original = doc.text.bind(doc) as (...args: unknown[]) => jsPDF
  ;(doc as unknown as { text: (...args: unknown[]) => jsPDF }).text = (text, x, y, options, transform) =>
    original(text, x, y, { isInputVisual: true, isOutputVisual: true, isInputRtl: false, isOutputRtl: false, ...(options as object) }, transform)
}

function shaper(doc: jsPDF) {
  return (run: string) => (doc as unknown as { processArabic: (t: string) => string }).processArabic(run)
}

/** Sets the font for a piece of text: Cairo when it holds any Arabic, Helvetica otherwise. */
function useFont(c: Ctx, text: string, size: number, bold: boolean | undefined, color: RGB) {
  c.doc.setFont(hasArabic(text) ? "Cairo" : "helvetica", bold ? "bold" : "normal")
  c.doc.setFontSize(size)
  c.doc.setTextColor(color[0], color[1], color[2])
}

/** A left-to-right x, as it lands on the page in this document's direction. */
function mx(c: Ctx, x: number): number {
  return c.rtl ? c.pageW - x : x
}

/** Draws text the way this document reads: mirrored in a right-to-left one, with Arabic shaped. */
function say(c: Ctx, text: string, x: number, y: number, s: SayStyle) {
  const mirror = c.rtl && !s.fixed
  useFont(c, text, s.size, s.bold, s.color)
  const visual = visualOrder(text, c.rtl && !s.fixed, shaper(c.doc))
  const align = s.align ?? "left"
  const flipped: PdfAlign = mirror ? (align === "left" ? "right" : align === "right" ? "left" : "center") : align
  c.doc.text(visual, mirror ? c.pageW - x : x, y, {
    align: flipped,
    ...(s.maxWidth ? { maxWidth: s.maxWidth } : {}),
    ...(s.angle ? { angle: s.angle } : {}),
  })
}

/** How wide a piece of text is, in the font and size `say` would draw it in. */
function widthOf(c: Ctx, text: string, size: number, bold?: boolean): number {
  useFont(c, text, size, bold, c.theme.ink)
  return c.doc.getTextWidth(visualOrder(text, c.rtl, shaper(c.doc)))
}

function contentWidth(c: Ctx): number {
  return c.pageW - c.theme.margin * 2
}

function hline(c: Ctx, x1: number, x2: number, y: number, color: RGB, width: number) {
  c.doc.setDrawColor(color[0], color[1], color[2])
  c.doc.setLineWidth(width)
  c.doc.line(mx(c, x1), y, mx(c, x2), y)
}

/** Wraps on the logical text, so the lines can each be shaped and ordered on their own. */
function wrap(c: Ctx, text: string, width: number, size: number, bold?: boolean): string[] {
  useFont(c, text, size, bold, c.theme.ink)
  return c.doc.splitTextToSize(text, width) as string[]
}

// ── logo ───────────────────────────────────────────────────────────────────

/** Draws the logo inside a box, never stretched. Returns what it took, or null if there is none. */
function drawLogo(c: Ctx, x: number, y: number, maxW: number, maxH: number, rightEdge?: number): { w: number; h: number } | null {
  const data = c.o.logo
  if (!data || !c.o.show.logo) return null
  try {
    const props = c.doc.getImageProperties(data)
    const scale = Math.min(maxW / props.width, maxH / props.height)
    const w = props.width * scale
    const h = props.height * scale
    const left = rightEdge !== undefined ? rightEdge - w : x
    c.doc.addImage(data, data.startsWith("data:image/png") ? "PNG" : "JPEG", c.rtl ? c.pageW - left - w : left, y, w, h)
    return { w, h }
  } catch {
    // A logo that cannot be read is left out; the document still draws.
    return null
  }
}

// ── the letterhead, per template ───────────────────────────────────────────

function metaParts(spec: PdfSpec, skipOrg: boolean): string[] {
  return [skipOrg ? undefined : spec.orgLabel, spec.timezoneLabel, spec.rangeLabel, spec.scopeLabel].filter(
    (part): part is string => Boolean(part && part.length > 0),
  )
}

/** The facts under the title as one wrapped line: the template's way of saying "details". */
function detailsLine(spec: PdfSpec): string[] {
  return [...(spec.info ?? []).map((i) => `${i.label}: ${i.value}`), ...(spec.filterLines ?? [])]
}

function headlineOf(spec: PdfSpec) {
  return spec.headline ?? (spec.summary && spec.summary.length > 0 ? spec.summary[spec.summary.length - 1] : null)
}

function drawLetterheadVT(c: Ctx, spec: PdfSpec): number {
  const { theme } = c
  const left = theme.margin
  const right = left + contentWidth(c)
  let y = theme.margin

  const logo = drawLogo(c, left, y - 12, 110, 40, right)
  const textWidth = logo ? contentWidth(c) - 124 : contentWidth(c)

  say(c, spec.title, left, y, { size: 18, bold: true, color: theme.ink })
  y += 18

  if (spec.subtitle) {
    const lines = wrap(c, spec.subtitle, textWidth, 9.5)
    lines.forEach((line, i) => say(c, line, left, y + i * 12, { size: 9.5, color: theme.muted }))
    y += lines.length * 12
  }
  if (c.o.headerNote) {
    const lines = wrap(c, c.o.headerNote, textWidth, 9)
    lines.forEach((line, i) => say(c, line, left, y + i * 12, { size: 9, color: theme.ink }))
    y += lines.length * 12 + 2
  }

  const meta = metaParts(spec, false)
  if (meta.length > 0) {
    say(c, meta.join("   •   "), left, y, { size: 9, color: theme.muted })
    y += 14
  }
  if (c.o.show.filters) {
    const details = detailsLine(spec)
    if (details.length > 0) {
      const lines = wrap(c, details.join("   |   "), contentWidth(c), 8.5)
      lines.forEach((line, i) => say(c, line, left, y + i * 11, { size: 8.5, color: theme.ink }))
      y += lines.length * 11
    }
  }
  y += 4
  hline(c, left, right, y, theme.rule, 1)
  return y + 20
}

/** A "label: value" pair at the right edge, the label small and the value bold. */
function pairRight(c: Ctx, label: string, value: string, xRight: number, y: number) {
  say(c, value, xRight, y, { size: 8, bold: true, color: c.theme.ink, align: "right" })
  say(c, `${label}:`, xRight - widthOf(c, value, 8, true) - 4, y, { size: 7, color: c.theme.ink, align: "right" })
}

function drawParty(c: Ctx, party: PdfParty, x: number, y: number, width: number, style: "classic" | "stripe"): number {
  if (style === "classic") {
    say(c, party.title, x, y + 10, { size: 12, bold: true, color: c.theme.ink })
    hline(c, x, x + width, y + 14, c.theme.rule, 0.75)
    say(c, party.name, x, y + 27, { size: 10, bold: true, color: c.theme.ink, maxWidth: width })
    let cy = y + 38
    for (const line of party.lines ?? []) {
      const wrapped = wrap(c, line, width, 8)
      wrapped.forEach((l, i) => say(c, l, x, cy + i * 10, { size: 8, color: c.theme.ink }))
      cy += wrapped.length * 10
    }
    return cy - y
  }
  say(c, party.title, x, y + 8, { size: 8, color: c.theme.muted })
  say(c, party.name, x, y + 21, { size: 10, bold: true, color: c.theme.ink, maxWidth: width })
  let cy = y + 33
  for (const line of party.lines ?? []) {
    const wrapped = wrap(c, line, width, 9)
    wrapped.forEach((l, i) => say(c, l, x, cy + i * 11, { size: 9, color: c.theme.muted }))
    cy += wrapped.length * 11
  }
  return cy - y
}

function drawParties(c: Ctx, spec: PdfSpec, y: number, style: "classic" | "stripe"): number {
  const parties = [spec.parties?.from, spec.parties?.to].filter((p): p is PdfParty => Boolean(p))
  if (parties.length === 0) return y
  const gap = 25
  const width = (contentWidth(c) - gap) / 2
  let tallest = 0
  parties.forEach((party, i) => {
    tallest = Math.max(tallest, drawParty(c, party, c.theme.margin + i * (width + gap), y, width, style))
  })
  return y + tallest + 10
}

function drawLetterheadClassic(c: Ctx, spec: PdfSpec): number {
  const { theme } = c
  const left = theme.margin
  const right = left + contentWidth(c)
  let y = theme.margin
  const info = spec.info ?? []

  // The logo, when there is one, sits above the title; the dates stay on the right.
  const logo = drawLogo(c, left, y, 110, 40)
  info.forEach((row, i) => pairRight(c, row.label, row.value, right, y + 8 + i * 10))
  if (logo) y += Math.max(logo.h, info.length * 10) + 12

  say(c, spec.title, left, y + 12, { size: 16, bold: true, color: theme.ink })
  if (!logo) y += Math.max(28, info.length * 10 + 10)
  else y += 28

  if (spec.subtitle) {
    const lines = wrap(c, spec.subtitle, contentWidth(c), 9)
    lines.forEach((line, i) => say(c, line, left, y + i * 11, { size: 9, color: theme.muted }))
    y += lines.length * 11 + 2
  }
  if (c.o.headerNote) {
    const lines = wrap(c, c.o.headerNote, contentWidth(c), 9)
    lines.forEach((line, i) => say(c, line, left, y + i * 11, { size: 9, color: theme.ink }))
    y += lines.length * 11 + 2
  }
  const meta = metaParts(spec, true)
  if (meta.length > 0) {
    say(c, meta.join("   •   "), left, y + 2, { size: 8.5, color: theme.muted })
    y += 14
  }

  y = drawParties(c, spec, y + 6, "classic")

  if (c.o.show.filters && spec.filterLines && spec.filterLines.length > 0) {
    const lines = wrap(c, spec.filterLines.join("   |   "), contentWidth(c), 8)
    lines.forEach((line, i) => say(c, line, left, y + 6 + i * 10, { size: 8, color: theme.ink }))
    y += lines.length * 10 + 8
  }
  y += 8
  return y
}

function drawLetterheadStripe(c: Ctx, spec: PdfSpec): number {
  const { theme, doc } = c
  const left = theme.margin
  const right = left + contentWidth(c)

  // The thin yellow bar across the top of the first page.
  doc.setFillColor(STRIPE_BAR[0], STRIPE_BAR[1], STRIPE_BAR[2])
  doc.rect(0, 0, c.pageW, 4, "F")

  let y = 4 + 27
  say(c, spec.title, left, y + 13, { size: 18, bold: true, color: theme.ink })
  const logo = drawLogo(c, left, y - 2, 110, 40, right)
  y += logo ? Math.max(logo.h, 22) + 8 : 30

  if (spec.subtitle) {
    const lines = wrap(c, spec.subtitle, contentWidth(c), 9)
    lines.forEach((line, i) => say(c, line, left, y + i * 11, { size: 9, color: theme.muted }))
    y += lines.length * 11 + 6
  }
  if (c.o.headerNote) {
    const lines = wrap(c, c.o.headerNote, contentWidth(c), 9)
    lines.forEach((line, i) => say(c, line, left, y + i * 11, { size: 9, color: theme.ink }))
    y += lines.length * 11 + 6
  }

  // The number and dates as a two-column block: label, then value.
  const column = c.o.language === "en" ? 90 : 105
  const info = [...(spec.info ?? [])]
  if (spec.rangeLabel) info.push({ label: c.L.period, value: spec.rangeLabel })
  info.forEach((row, i) => {
    say(c, row.label, left, y + 9 + i * 12, { size: 9, bold: i === 0, color: theme.ink })
    say(c, row.value, left + column, y + 9 + i * 12, { size: 9, bold: i === 0, color: theme.ink })
  })
  y += info.length * 12 + (info.length > 0 ? 14 : 0)

  if (c.o.show.filters && spec.filterLines && spec.filterLines.length > 0) {
    spec.filterLines.forEach((line, i) => say(c, line, left, y + 8 + i * 11, { size: 8.5, color: theme.muted }))
    y += spec.filterLines.length * 11 + 10
  }

  y = drawParties(c, spec, y, "stripe")

  // What is due.
  const headline = headlineOf(spec)
  if (headline) {
    y += 6
    const due = "due" in headline && (headline as { due?: string }).due ? ` ${c.L.dueWord} ${(headline as { due?: string }).due}` : ""
    say(c, `${headline.value}${due}`, left, y + 14, { size: 14, bold: true, color: theme.ink })
    y += 22
    const sub = "sub" in headline ? (headline as { sub?: string }).sub : undefined
    if (sub && !due) {
      say(c, sub, left, y + 2, { size: 9, color: theme.muted })
      y += 12
    }
    y += 8
  }
  return y + 6
}

function drawLetterhead(c: Ctx, spec: PdfSpec): number {
  if (c.o.template === "stripe") return drawLetterheadStripe(c, spec)
  if (c.o.template === "classic") return drawLetterheadClassic(c, spec)
  return drawLetterheadVT(c, spec)
}

// ── summary, charts ────────────────────────────────────────────────────────

function drawSummary(c: Ctx, items: PdfSummaryItem[], y: number): number {
  const { theme } = c
  const left = theme.margin
  const w = contentWidth(c)
  const cellW = w / items.length

  if (c.o.template !== "virtual-tracker") {
    // No box: label over figure, side by side.
    items.forEach((item, i) => {
      const cx = left + i * cellW
      say(c, item.label, cx, y + 8, { size: 8, color: theme.muted })
      say(c, item.value, cx, y + 24, { size: 12, bold: true, color: theme.ink })
    })
    return y + 46
  }

  const h = 44
  c.doc.setDrawColor(theme.rule[0], theme.rule[1], theme.rule[2])
  c.doc.setLineWidth(1)
  c.doc.roundedRect(left, y, w, h, 4, 4)
  items.forEach((item, i) => {
    const cx = left + i * cellW
    if (i > 0) {
      const lx = c.rtl ? c.pageW - cx : cx
      c.doc.line(lx, y + 8, lx, y + h - 8)
    }
    say(c, item.label.toUpperCase(), cx + 12, y + 16, { size: 7.5, color: theme.muted })
    say(c, item.value, cx + 12, y + 33, { size: 13, bold: true, color: theme.ink })
  })
  return y + h + 24
}

interface PlotArea {
  plotLeft: number
  plotW: number
  plotTop: number
  plotH: number
  axisY: number
  top: number
}

/**
 * The frame both chart types share: the title, the Y axis with a labelled
 * gridline at every step, and the axis title turned on its side. Returns where
 * the marks go. The gutter is measured from the labels it has to hold.
 */
function drawChartFrame(c: Ctx, chart: PdfBarChart | PdfLineChart, y: number, maxValue: number): PlotArea {
  const { theme, doc } = c
  const left = theme.margin
  const w = contentWidth(c)
  const plotTop = y + 20
  const plotH = CHART_HEIGHT
  const axisY = plotTop + plotH

  say(c, chart.title, left, y + 6, { size: 10.5, bold: true, color: theme.ink })

  const unit = chart.yUnit ?? "number"
  const { top, step } = yAxisScale(maxValue, unit)
  const formatTick =
    chart.yTickFormatter ??
    (unit === "hours"
      ? (v: number) => formatAxisHours(v, c.o.language, c.o.numberFormat)
      : (v: number) => formatAxisNumber(v, c.o.numberFormat))
  const ticks = Array.from({ length: Y_TICKS + 1 }, (_, i) => i * step)
  const labels = ticks.map(formatTick)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  const labelW = Math.max(...labels.map((l) => (hasArabic(l) ? l.length * 4.2 : doc.getTextWidth(l))))
  const titleW = chart.yLabel ? 12 : 0
  const plotLeft = left + titleW + labelW + 8
  const plotW = w - (plotLeft - left)

  ticks.forEach((value, i) => {
    const gy = axisY - (value / top) * plotH
    const line = i === 0 ? theme.rule : ([241, 245, 249] as RGB)
    doc.setDrawColor(line[0], line[1], line[2])
    doc.setLineWidth(0.5)
    doc.line(plotLeft, gy, plotLeft + plotW, gy)
    say(c, labels[i], plotLeft - 5, gy + 2.5, { size: 7, color: theme.muted, align: "right", fixed: true })
  })
  doc.setDrawColor(theme.rule[0], theme.rule[1], theme.rule[2])
  doc.line(plotLeft, plotTop, plotLeft, axisY)

  if (chart.yLabel) {
    const visual = visualOrder(chart.yLabel, false, shaper(doc))
    useFont(c, chart.yLabel, 7.5, false, theme.muted)
    doc.text(visual, left + 7, plotTop + plotH / 2 + doc.getTextWidth(visual) / 2, { angle: 90 })
  }

  return { plotLeft, plotW, plotTop, plotH, axisY, top }
}

function plainValue(c: Ctx): (v: number) => string {
  return (v) => toLocaleDigits(String(Math.round(v)), c.o.numberFormat)
}

function drawBarChart(c: Ctx, chart: PdfBarChart, y: number): number {
  const data = chart.data.slice(0, 12)
  const { plotLeft, plotW, plotH, axisY, top } = drawChartFrame(c, chart, y, Math.max(0, ...data.map((d) => d.value)))
  const fmt = chart.valueFormatter ?? plainValue(c)
  const [r, g, b] = chart.color ?? c.theme.brand
  const n = data.length
  const slot = plotW / Math.max(1, n)
  const barW = Math.min(34, slot * 0.55)
  data.forEach((d, i) => {
    const cx = plotLeft + slot * i + slot / 2
    const barH = (d.value / top) * plotH
    // Set per bar: the label drawn after each one changes the colour jsPDF fills with.
    c.doc.setFillColor(r, g, b)
    c.doc.roundedRect(cx - barW / 2, axisY - barH, barW, Math.max(1, barH), 1.5, 1.5, "F")
    say(c, fmt(d.value), cx, axisY - barH - 4, { size: 7, color: c.theme.muted, align: "center", fixed: true })
    const label = d.label.length > 14 ? `${d.label.slice(0, 13)}…` : d.label
    say(c, label, cx, axisY + 12, { size: 7, color: c.theme.muted, align: "center", maxWidth: slot, fixed: true })
  })
  return axisY + 26
}

function drawLineChart(c: Ctx, chart: PdfLineChart, y: number): number {
  const points = chart.points
  const { plotLeft, plotW, plotH, axisY, top } = drawChartFrame(c, chart, y, Math.max(0, ...points.map((p) => p.value)))
  const fmt = chart.valueFormatter ?? plainValue(c)
  const [r, g, b] = chart.color ?? c.theme.brand
  const n = points.length
  // Inset from both ends so the first and last points, and the value printed
  // over each, do not sit on the Y axis or run off the page edge.
  const inset = Math.min(18, plotW / 10)
  const xAt = (i: number) => plotLeft + (n <= 1 ? plotW / 2 : inset + (i / (n - 1)) * (plotW - inset * 2))
  const yAt = (v: number) => axisY - (v / top) * plotH

  c.doc.setDrawColor(r, g, b)
  c.doc.setLineWidth(1.5)
  for (let i = 0; i < n - 1; i++) {
    c.doc.line(xAt(i), yAt(points[i].value), xAt(i + 1), yAt(points[i + 1].value))
  }
  c.doc.setFillColor(255, 255, 255)
  c.doc.setDrawColor(r, g, b)
  points.forEach((p, i) => c.doc.circle(xAt(i), yAt(p.value), 2.2, "FD"))

  const labelStep = n <= 10 ? 1 : Math.ceil(n / 10)
  points.forEach((p, i) => {
    if (i % labelStep !== 0 && i !== n - 1) return
    say(c, p.label, xAt(i), axisY + 12, { size: 7, color: c.theme.muted, align: "center", fixed: true })
  })

  // Every point gets its value, thinned like the x-axis so a long range does
  // not overprint itself; the last point is always kept.
  const valueStep = n <= 12 ? 1 : Math.ceil(n / 12)
  points.forEach((p, i) => {
    if (i % valueStep !== 0 && i !== n - 1) return
    say(c, fmt(p.value), xAt(i), yAt(p.value) - 6, { size: 7, color: c.theme.ink, align: "center", fixed: true })
  })
  return axisY + 26
}

function pctColor(pct: number): RGB {
  if (pct >= 100) return [220, 38, 38]
  if (pct >= 80) return [217, 119, 6]
  return [22, 163, 74]
}

function drawProgressRows(c: Ctx, chart: PdfProgressChart, y: number): number {
  const left = c.theme.margin
  const w = contentWidth(c)
  const labelW = w * 0.34
  const trackX = left + labelW
  const trackW = w - labelW - 40
  const rowH = 20

  say(c, chart.title, left, y + 6, { size: 10.5, bold: true, color: c.theme.ink })
  let cy = y + 20
  for (const row of chart.rows.slice(0, 14)) {
    const pct = Math.max(0, Math.min(100, row.pct))
    const label = row.label.length > 28 ? `${row.label.slice(0, 27)}…` : row.label
    say(c, label, left, cy + 10, { size: 8.5, color: c.theme.ink })
    c.doc.setFillColor(241, 245, 249)
    c.doc.roundedRect(trackX, cy + 3, trackW, 9, 2, 2, "F")
    const [r, g, b] = pctColor(pct)
    c.doc.setFillColor(r, g, b)
    c.doc.roundedRect(trackX, cy + 3, Math.max(2, (trackW * pct) / 100), 9, 2, 2, "F")
    say(c, toLocaleDigits(`${Math.round(pct)}%`, c.o.numberFormat), trackX + trackW + 8, cy + 10, {
      size: 8,
      bold: true,
      color: c.theme.ink,
      fixed: true,
    })
    if (row.sublabel) {
      say(c, row.sublabel, left, cy + 19, { size: 7, color: c.theme.muted })
      cy += rowH + 6
    } else {
      cy += rowH
    }
  }
  return cy + 8
}

function drawChart(c: Ctx, chart: PdfChart, y: number): number {
  if (chart.type === "bar") return drawBarChart(c, chart, y)
  if (chart.type === "line") return drawLineChart(c, chart, y)
  return drawProgressRows(c, chart, y)
}

function chartHeightEstimate(chart: PdfChart): number {
  if (chart.type === "progress") return 26 + Math.min(14, chart.rows.length) * 26 + 20
  return CHART_HEIGHT + 46
}

// ── table, totals, notes ───────────────────────────────────────────────────

/** The columns as the document reads them: first column on the right in a right-to-left one. */
function orderedColumns(c: Ctx, columns: PdfColumn[]): PdfColumn[] {
  if (!c.rtl) return columns
  const flip = (a?: PdfAlign): PdfAlign => (a === "right" ? "left" : a === "center" ? "center" : "right")
  return [...columns].reverse().map((col) => ({ ...col, align: flip(col.align) }))
}

/** The totals under the table, on the right half of the page (the left, in a right-to-left one). */
function drawTotals(c: Ctx, rows: PdfTotalRow[], y: number): number {
  const classic = c.o.template === "classic"
  const blockW = contentWidth(c) / 2
  const x1 = c.theme.margin + contentWidth(c) - blockW
  const x2 = c.theme.margin + contentWidth(c)
  const rowH = classic ? 16 : 18
  if (y + rows.length * rowH + 10 > c.bottom) {
    c.doc.addPage()
    y = c.theme.margin
  }
  y += 14
  rows.forEach((row, i) => {
    const top = y + i * rowH
    if (classic) {
      c.doc.setDrawColor(c.theme.rule[0], c.theme.rule[1], c.theme.rule[2])
      c.doc.setLineWidth(0.5)
      const rx = c.rtl ? c.pageW - x2 : x1
      c.doc.rect(rx, top, blockW, rowH)
    } else {
      hline(c, x1, x2, top, c.theme.rule, 0.5)
    }
    const pad = classic ? 5 : 0
    say(c, row.label, x1 + pad, top + 12, { size: classic ? 8.5 : 9, bold: row.strong, color: row.strong ? c.theme.ink : classic ? c.theme.ink : c.theme.muted })
    say(c, row.value, x2 - pad, top + 12, { size: classic ? 8.5 : 9, bold: row.strong, color: c.theme.ink, align: "right" })
  })
  return y + rows.length * rowH + 14
}

/**
 * Builds the document. Returns the jsPDF instance, so the caller decides what
 * to do with it: save it, email its bytes, or show it in a preview.
 */
export function renderPdf(spec: PdfSpec, options: PdfOptions): jsPDF {
  const theme = THEMES[options.template] ?? THEMES["virtual-tracker"]
  const L = getLabels(options.language)
  const doc = new jsPDF({
    unit: "pt",
    format: theme.format,
    orientation: spec.orientation ?? "portrait",
    compress: true,
  })
  registerFonts(doc)
  forceVisualText(doc)
  doc.setProperties({ title: spec.title })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const c: Ctx = {
    doc,
    o: options,
    L,
    rtl: L.dir === "rtl",
    theme,
    pageW,
    pageH,
    bottom: pageH - theme.margin - 16,
  }
  const invoiceStyle = options.template !== "virtual-tracker"

  let y = drawLetterhead(c, spec)
  if (options.show.summary && spec.summary && spec.summary.length > 0) y = drawSummary(c, spec.summary, y)

  if (options.show.charts) {
    for (const chart of spec.charts ?? []) {
      if (y + chartHeightEstimate(chart) > c.bottom) {
        doc.addPage()
        y = theme.margin
      }
      y = drawChart(c, chart, y)
    }
  }

  if (y + 60 > c.bottom) {
    doc.addPage()
    y = theme.margin
  }

  // The invoice-style templates take the totals out of the table and set them out as a block.
  const useTotalsBlock = invoiceStyle && Boolean(spec.totals && spec.totals.length > 0)
  const keep = spec.table.rows.map((_, i) => !(useTotalsBlock && spec.table.rowKinds?.[i] === "total"))
  const rows = spec.table.rows.filter((_, i) => keep[i])
  const rowKinds = spec.table.rowKinds?.filter((_, i) => keep[i])
  const columns = orderedColumns(c, spec.table.columns)
  const kindOf = (rowIndex: number) => rowKinds?.[rowIndex]
  let tableEnd = y
  if (rows.length === 0) {
    say(c, spec.table.emptyMessage ?? "-", theme.margin, y + 14, { size: 10, color: theme.muted })
    tableEnd = y + 30
  } else {
    const stripe = options.template === "stripe"
    const classic = options.template === "classic"
    autoTable(doc, {
      startY: y,
      margin: { left: theme.margin, right: theme.margin },
      head: [columns.map((col) => col.header)],
      body: rows.map((row) => columns.map((col) => String(row[col.key] ?? ""))),
      columnStyles: Object.fromEntries(
        columns.map((col, i) => [i, { halign: col.align ?? "left", ...(col.width ? { cellWidth: col.width } : {}) }]),
      ),
      theme: stripe ? "plain" : classic ? "grid" : "striped",
      styles: {
        fontSize: stripe ? 8.5 : 8,
        cellPadding: stripe ? { top: 6, bottom: 6, left: 4, right: 4 } : classic ? 3.5 : 5,
        textColor: theme.ink,
        lineColor: theme.rule,
        ...(stripe ? { lineWidth: 0 } : classic ? { lineWidth: 0.5 } : {}),
      },
      headStyles: {
        ...(theme.headFill ? { fillColor: theme.headFill } : { fillColor: false as unknown as RGB }),
        textColor: theme.headText,
        fontStyle: "bold",
      },
      alternateRowStyles: !rowKinds && theme.zebra ? { fillColor: theme.zebra } : {},
      // Shape Arabic, pick its font, and align each header with its column.
      didParseCell: (data) => {
        const col = columns[data.column.index]
        const lines = Array.isArray(data.cell.text) ? data.cell.text : [String(data.cell.text ?? "")]
        const joined = lines.join(" ")
        data.cell.text = lines.map((line: string) => visualOrder(line, c.rtl, shaper(doc)))
        if (hasArabic(joined)) data.cell.styles.font = "Cairo"
        // The classic template centres its cells, as the invoice it copies does.
        const align = classic && data.column.index !== 0 ? "center" : (col?.align ?? "left")
        if (data.section === "head") {
          data.cell.styles.halign = align
          return
        }
        if (classic) data.cell.styles.halign = align
        if (data.section === "body" && rowKinds) {
          const kind = kindOf(data.row.index)
          if (kind === "group" || kind === "total") {
            data.cell.styles.fontStyle = "bold"
            if (theme.groupFill) data.cell.styles.fillColor = theme.groupFill
          } else {
            data.cell.styles.textColor = theme.muted
          }
        }
      },
      // The Stripe look: a black rule under the header, a light one under every line.
      didDrawCell: (data) => {
        if (!stripe) return
        const bottom = data.cell.y + data.cell.height
        if (data.section === "head") hlineAt(doc, data.cell.x, data.cell.x + data.cell.width, bottom, [1, 0, 0], 1)
        else if (data.section === "body") hlineAt(doc, data.cell.x, data.cell.x + data.cell.width, bottom, theme.rule, 0.5)
      },
    })
    tableEnd = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 30
  }

  let after = tableEnd
  if (useTotalsBlock && spec.totals) after = drawTotals(c, spec.totals, tableEnd)

  if (options.show.notes && spec.notes && spec.notes.length > 0) {
    let ny = after + 18
    for (const note of spec.notes) {
      const lines = wrap(c, note, contentWidth(c), 8)
      if (ny + lines.length * 10 > c.bottom) {
        doc.addPage()
        ny = theme.margin + 8
      }
      lines.forEach((line, i) => say(c, line, theme.margin, ny + i * 10, { size: 8, color: theme.muted }))
      ny += lines.length * 10 + 6
    }
    after = ny
  }

  if (options.show.footer) drawFooters(c, spec)
  return doc
}

function hlineAt(doc: jsPDF, x1: number, x2: number, y: number, color: RGB, width: number) {
  doc.setDrawColor(color[0], color[1], color[2])
  doc.setLineWidth(width)
  doc.line(x1, y, x2, y)
}

function drawFooters(c: Ctx, spec: PdfSpec) {
  const { doc, o, L, theme } = c
  const pageCount = doc.getNumberOfPages()
  const now = new Date()
  const stamp = `${formatDate(todayIso(now), o.dateFormat, o.language, o.numberFormat)} ${toLocaleDigits(
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    o.numberFormat,
  )}`
  const headline = headlineOf(spec)
  const due = headline && "due" in headline && (headline as { due?: string }).due ? ` ${L.dueWord} ${(headline as { due?: string }).due}` : ""
  const invoiceStyle = o.template !== "virtual-tracker"
  const left = invoiceStyle
    ? [spec.documentNumber, headline ? `${headline.value}${due}` : ""].filter(Boolean).join("  ·  ") || `${L.generated} ${stamp}`
    : `${L.generated} ${stamp}`
  const y = c.pageH - (invoiceStyle ? 22 : 20)
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    if (invoiceStyle) hline(c, theme.margin, theme.margin + contentWidth(c), y - 11, o.template === "classic" ? theme.ink : theme.rule, o.template === "classic" ? 0.75 : 0.5)
    say(c, left, theme.margin, y, { size: 7.5, color: theme.muted })
    say(c, toLocaleDigits(`${L.page} ${i} ${L.of} ${pageCount}`, o.numberFormat), theme.margin + contentWidth(c), y, {
      size: 7.5,
      color: theme.muted,
      align: "right",
    })
  }
}

/** The finished PDF as bytes, for the server to email. */
export function pdfBytes(spec: PdfSpec, options: PdfOptions): ArrayBuffer {
  return renderPdf(spec, options).output("arraybuffer")
}
