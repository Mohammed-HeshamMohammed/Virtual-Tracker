import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

import { todayDateParam } from "@/features/reports/utils/time-and-activity/date-range"
export type ReportPdfAlign = "left" | "right" | "center"

export interface ReportPdfColumn {
  header: string
  key: string
  align?: ReportPdfAlign
  width?: number
}

export interface ReportPdfSummaryItem {
  label: string
  value: string
}

/** What a chart's Y axis counts. "hours" steps in clock-friendly amounts
 *  (15 minutes, 1 hour, 4 hours...) and labels them "2h", "1h 30m". */
export type ReportPdfAxisUnit = "number" | "hours"

interface ReportPdfYAxis {
  /** Printed sideways beside the axis: what the numbers are ("Hours"). */
  yLabel?: string
  yUnit?: ReportPdfAxisUnit
  /** Overrides the gridline labels the unit would give. */
  yTickFormatter?: (value: number) => string
}

export interface ReportPdfBarChart extends ReportPdfYAxis {
  type: "bar"
  title: string
  data: { label: string; value: number }[]
  valueFormatter?: (value: number) => string
  color?: [number, number, number]
}

export interface ReportPdfLineChart extends ReportPdfYAxis {
  type: "line"
  title: string
  points: { label: string; value: number }[]
  valueFormatter?: (value: number) => string
  color?: [number, number, number]
}

export interface ReportPdfProgressChart {
  type: "progress"
  title: string
  rows: { label: string; pct: number; sublabel?: string }[]
}

export type ReportPdfChart = ReportPdfBarChart | ReportPdfLineChart | ReportPdfProgressChart

export interface ReportPdfSpec {
  title: string
  subtitle?: string
  orgLabel: string
  timezoneLabel?: string
  rangeLabel?: string
  scopeLabel?: string
  /** One line per applied filter (members, projects, grouping...). Printed
   *  under the letterhead so a reader can tell what the figures are limited
   *  to without seeing the screen the report was exported from. */
  filterLines?: string[]
  /** Wide tables (many columns) do not fit portrait A4 without crushing. */
  orientation?: "portrait" | "landscape"
  summary?: ReportPdfSummaryItem[]
  charts?: ReportPdfChart[]
  table: {
    columns: ReportPdfColumn[]
    rows: Record<string, string | number>[]
    /** Parallel to rows. "group" rows are the table's totals lines and are
     *  drawn bold on a tint; "detail" rows are the people or projects under
     *  them, in a lighter style. Omit for a plain table. */
    rowKinds?: ("group" | "detail")[]
    emptyMessage?: string
  }
  /** Small print under the table: how a figure was worked out, or what is
   *  missing from it. One paragraph each. */
  notes?: string[]
  filename: string
}

const PAGE_MARGIN = 40
const INK = { r: 30, g: 41, b: 59 }
const MUTED = { r: 100, g: 116, b: 139 }
const RULE = { r: 226, g: 232, b: 240 }
const BRAND: [number, number, number] = [37, 99, 235]

function setInk(doc: jsPDF) {
  doc.setTextColor(INK.r, INK.g, INK.b)
}
function setMuted(doc: jsPDF) {
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
}

function contentWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2
}

function pctColor(pct: number): [number, number, number] {
  if (pct >= 100) return [220, 38, 38]
  if (pct >= 80) return [217, 119, 6]
  return [22, 163, 74]
}

function drawLetterhead(doc: jsPDF, spec: ReportPdfSpec): number {
  const left = PAGE_MARGIN
  let y = PAGE_MARGIN

  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  setInk(doc)
  doc.text(spec.title, left, y)
  y += 18

  if (spec.subtitle) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9.5)
    setMuted(doc)
    const wrapped = doc.splitTextToSize(spec.subtitle, contentWidth(doc))
    doc.text(wrapped, left, y)
    y += wrapped.length * 12
  }

  const metaParts = [
    spec.orgLabel,
    spec.timezoneLabel,
    spec.rangeLabel,
    spec.scopeLabel ? `Scope: ${spec.scopeLabel}` : undefined,
  ].filter((part): part is string => Boolean(part && part.length > 0))
  if (metaParts.length > 0) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    setMuted(doc)
    doc.text(metaParts.join("   •   "), left, y)
    y += 14
  }

  if (spec.filterLines && spec.filterLines.length > 0) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    setInk(doc)
    const wrapped = doc.splitTextToSize(spec.filterLines.join("   |   "), contentWidth(doc))
    doc.text(wrapped, left, y)
    y += wrapped.length * 11
  }

  y += 4
  doc.setDrawColor(RULE.r, RULE.g, RULE.b)
  doc.setLineWidth(1)
  doc.line(left, y, left + contentWidth(doc), y)
  return y + 20
}

function drawSummary(doc: jsPDF, items: ReportPdfSummaryItem[], y: number): number {
  const left = PAGE_MARGIN
  const w = contentWidth(doc)
  const h = 44
  const cellW = w / items.length

  doc.setDrawColor(RULE.r, RULE.g, RULE.b)
  doc.setLineWidth(1)
  doc.roundedRect(left, y, w, h, 4, 4)

  items.forEach((item, i) => {
    const cx = left + i * cellW
    if (i > 0) doc.line(cx, y + 8, cx, y + h - 8)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    setMuted(doc)
    doc.text(item.label.toUpperCase(), cx + 12, y + 16)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    setInk(doc)
    doc.text(item.value, cx + 12, y + 33)
  })

  return y + h + 24
}

const CHART_HEIGHT = 140
const Y_TICKS = 4

/** Steps a clock reads naturally in: quarter hours up to half a day. Past
 *  that the hours are just a count, and round numbers serve better. */
const HOUR_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12]
const ROUND_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/**
 * The scale of a chart's Y axis: a round top value and the step between its
 * gridlines, so every gridline can carry a label a reader can use ("2h", "4h")
 * instead of whatever a quarter of the largest value happens to be.
 */
export function yAxisScale(maxValue: number, unit: ReportPdfAxisUnit = "number"): { top: number; step: number } {
  const max = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1
  const hourStep = unit === "hours" ? HOUR_STEPS.find((s) => s * Y_TICKS >= max) : undefined
  if (hourStep) return { top: hourStep * Y_TICKS, step: hourStep }
  const raw = max / Y_TICKS
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const multipliers = unit === "hours" ? ROUND_STEPS : [1, 2, 2.5, 5, 10]
  const step = (multipliers.find((m) => m * magnitude >= raw - 1e-9) ?? 10) * magnitude
  return { top: step * Y_TICKS, step }
}

/** "1h 30m", "45m", "8h" - short enough to sit beside a gridline. */
export function formatAxisHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function formatAxisNumber(value: number): string {
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
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
 * the marks go. The gutter is measured from the labels it has to hold, so
 * "120h" and "30m" both fit without a fixed guess.
 */
function drawChartFrame(
  doc: jsPDF,
  chart: ReportPdfBarChart | ReportPdfLineChart,
  y: number,
  maxValue: number,
): PlotArea {
  const left = PAGE_MARGIN
  const w = contentWidth(doc)
  const plotTop = y + 20
  const plotH = CHART_HEIGHT
  const axisY = plotTop + plotH

  doc.setFont("helvetica", "bold")
  doc.setFontSize(10.5)
  setInk(doc)
  doc.text(chart.title, left, y + 6)

  const unit = chart.yUnit ?? "number"
  const { top, step } = yAxisScale(maxValue, unit)
  const formatTick = chart.yTickFormatter ?? (unit === "hours" ? formatAxisHours : formatAxisNumber)
  const ticks = Array.from({ length: Y_TICKS + 1 }, (_, i) => i * step)
  const labels = ticks.map(formatTick)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  const labelW = Math.max(...labels.map((l) => doc.getTextWidth(l)))
  const titleW = chart.yLabel ? 12 : 0
  const plotLeft = left + titleW + labelW + 8
  const plotW = w - (plotLeft - left)

  ticks.forEach((value, i) => {
    const gy = axisY - (value / top) * plotH
    doc.setDrawColor(i === 0 ? RULE.r : 241, i === 0 ? RULE.g : 245, i === 0 ? RULE.b : 249)
    doc.setLineWidth(0.5)
    doc.line(plotLeft, gy, plotLeft + plotW, gy)
    setMuted(doc)
    doc.text(labels[i], plotLeft - 5, gy + 2.5, { align: "right" })
  })
  doc.setDrawColor(RULE.r, RULE.g, RULE.b)
  doc.line(plotLeft, plotTop, plotLeft, axisY)

  if (chart.yLabel) {
    setMuted(doc)
    doc.setFontSize(7.5)
    doc.text(chart.yLabel, left + 7, plotTop + plotH / 2 + doc.getTextWidth(chart.yLabel) / 2, { angle: 90 })
  }

  return { plotLeft, plotW, plotTop, plotH, axisY, top }
}

function drawBarChart(doc: jsPDF, chart: ReportPdfBarChart, y: number): number {
  const data = chart.data.slice(0, 12)
  const { plotLeft, plotW, plotH, axisY, top } = drawChartFrame(doc, chart, y, Math.max(0, ...data.map((d) => d.value)))
  const fmt = chart.valueFormatter ?? ((v: number) => String(Math.round(v)))
  const [r, g, b] = chart.color ?? BRAND

  const n = data.length
  const slot = plotW / Math.max(1, n)
  const barW = Math.min(34, slot * 0.55)
  data.forEach((d, i) => {
    const cx = plotLeft + slot * i + slot / 2
    const barH = (d.value / top) * plotH
    // Set per bar: the label drawn after each one changes the colour jsPDF
    // fills with, which left every bar past the first grey.
    doc.setFillColor(r, g, b)
    doc.roundedRect(cx - barW / 2, axisY - barH, barW, Math.max(1, barH), 1.5, 1.5, "F")

    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    setMuted(doc)
    doc.text(fmt(d.value), cx, axisY - barH - 4, { align: "center" })

    const label = d.label.length > 14 ? `${d.label.slice(0, 13)}…` : d.label
    doc.text(label, cx, axisY + 12, { align: "center", maxWidth: slot })
  })

  return axisY + 26
}

function drawLineChart(doc: jsPDF, chart: ReportPdfLineChart, y: number): number {
  const points = chart.points
  const { plotLeft, plotW, plotH, axisY, top } = drawChartFrame(doc, chart, y, Math.max(0, ...points.map((p) => p.value)))
  const fmt = chart.valueFormatter ?? ((v: number) => String(Math.round(v)))
  const [r, g, b] = chart.color ?? BRAND
  const n = points.length
  // Inset from both ends so the first and last points, and the value printed
  // over each, do not sit on top of the Y axis or run off the page edge.
  const inset = Math.min(18, plotW / 10)
  const xAt = (i: number) => plotLeft + (n <= 1 ? plotW / 2 : inset + (i / (n - 1)) * (plotW - inset * 2))
  const yAt = (v: number) => axisY - (v / top) * plotH

  doc.setDrawColor(r, g, b)
  doc.setLineWidth(1.5)
  for (let i = 0; i < n - 1; i++) {
    doc.line(xAt(i), yAt(points[i].value), xAt(i + 1), yAt(points[i + 1].value))
  }
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(r, g, b)
  points.forEach((p, i) => {
    doc.circle(xAt(i), yAt(p.value), 2.2, "FD")
  })

  const labelStep = n <= 10 ? 1 : Math.ceil(n / 10)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  setMuted(doc)
  points.forEach((p, i) => {
    if (i % labelStep !== 0 && i !== n - 1) return
    doc.text(p.label, xAt(i), axisY + 12, { align: "center" })
  })

  // Every point gets its value, not just the last one. Markers were already
  // drawn above, but with a single number on the far right the reader could
  // see THAT the line moved without being able to read what it moved
  // between - which is what made the exported chart unreadable. Thinned by
  // the same labelStep as the x-axis so a long range does not overprint
  // itself, and the last point is always kept.
  if (n > 0) {
    setInk(doc)
    const valueStep = n <= 12 ? 1 : Math.ceil(n / 12)
    points.forEach((p, i) => {
      if (i % valueStep !== 0 && i !== n - 1) return
      doc.text(fmt(p.value), xAt(i), yAt(p.value) - 6, { align: "center" })
    })
  }

  return axisY + 26
}

function drawProgressRows(doc: jsPDF, chart: ReportPdfProgressChart, y: number): number {
  const left = PAGE_MARGIN
  const w = contentWidth(doc)
  const labelW = w * 0.34
  const trackX = left + labelW
  const trackW = w - labelW - 40
  const rowH = 20

  doc.setFont("helvetica", "bold")
  doc.setFontSize(10.5)
  setInk(doc)
  doc.text(chart.title, left, y + 6)

  let cy = y + 20
  const rows = chart.rows.slice(0, 14)
  for (const row of rows) {
    const pct = Math.max(0, Math.min(100, row.pct))
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    setInk(doc)
    const label = row.label.length > 28 ? `${row.label.slice(0, 27)}…` : row.label
    doc.text(label, left, cy + 10)

    doc.setFillColor(241, 245, 249)
    doc.roundedRect(trackX, cy + 3, trackW, 9, 2, 2, "F")
    const [r, g, b] = pctColor(pct)
    doc.setFillColor(r, g, b)
    doc.roundedRect(trackX, cy + 3, Math.max(2, (trackW * pct) / 100), 9, 2, 2, "F")

    doc.setFont("helvetica", "bold")
    doc.setFontSize(8)
    doc.text(`${Math.round(pct)}%`, trackX + trackW + 8, cy + 10)
    if (row.sublabel) {
      doc.setFont("helvetica", "normal")
      doc.setFontSize(7)
      setMuted(doc)
      doc.text(row.sublabel, left, cy + 19)
      cy += rowH + 6
    } else {
      cy += rowH
    }
  }
  return cy + 8
}

function drawChart(doc: jsPDF, chart: ReportPdfChart, y: number): number {
  if (chart.type === "bar") return drawBarChart(doc, chart, y)
  if (chart.type === "line") return drawLineChart(doc, chart, y)
  return drawProgressRows(doc, chart, y)
}

function chartHeightEstimate(chart: ReportPdfChart): number {
  if (chart.type === "progress") return 26 + Math.min(14, chart.rows.length) * 26 + 20
  return CHART_HEIGHT + 46
}

export function downloadReportPdf(spec: ReportPdfSpec): void {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: spec.orientation ?? "portrait" })
  const pageH = doc.internal.pageSize.getHeight()
  const bottomLimit = pageH - PAGE_MARGIN - 16

  let y = drawLetterhead(doc, spec)

  if (spec.summary && spec.summary.length > 0) {
    y = drawSummary(doc, spec.summary, y)
  }

  for (const chart of spec.charts ?? []) {
    if (y + chartHeightEstimate(chart) > bottomLimit) {
      doc.addPage()
      y = PAGE_MARGIN
    }
    y = drawChart(doc, chart, y)
  }

  if (y + 60 > bottomLimit) {
    doc.addPage()
    y = PAGE_MARGIN
  }

  const { columns, rows, emptyMessage, rowKinds } = spec.table
  if (rows.length === 0) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    setMuted(doc)
    doc.text(emptyMessage ?? "Nothing to report for this range.", PAGE_MARGIN, y + 14)
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      head: [columns.map((c) => c.header)],
      body: rows.map((row) => columns.map((c) => String(row[c.key] ?? ""))),
      columnStyles: Object.fromEntries(
        columns.map((c, i) => [
          i,
          {
            halign: c.align ?? "left",
            ...(c.width ? { cellWidth: c.width } : {}),
          },
        ]),
      ),
      styles: { fontSize: 8, cellPadding: 5, textColor: [INK.r, INK.g, INK.b], lineColor: [RULE.r, RULE.g, RULE.b] },
      headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: rowKinds ? {} : { fillColor: [248, 250, 252] },
      // autotable draws every header cell left-aligned regardless of the
      // column's own halign, which left numeric headers sitting off their
      // right-aligned figures. Align each header with its column.
      didParseCell: (data) => {
        const align = columns[data.column.index]?.align ?? "left"
        if (data.section === "head") {
          data.cell.styles.halign = align
          return
        }
        if (data.section === "body" && rowKinds) {
          if (rowKinds[data.row.index] === "group") {
            data.cell.styles.fontStyle = "bold"
            data.cell.styles.fillColor = [239, 246, 255]
          } else {
            data.cell.styles.textColor = [MUTED.r, MUTED.g, MUTED.b]
          }
        }
      },
    })
  }

  if (spec.notes && spec.notes.length > 0) {
    const tableEnd = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY
    let ny = (rows.length === 0 || !tableEnd ? y + 30 : tableEnd) + 18
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    setMuted(doc)
    for (const note of spec.notes) {
      const wrapped = doc.splitTextToSize(note, contentWidth(doc)) as string[]
      if (ny + wrapped.length * 10 > bottomLimit) {
        doc.addPage()
        ny = PAGE_MARGIN + 8
      }
      doc.text(wrapped, PAGE_MARGIN, ny)
      ny += wrapped.length * 10 + 6
    }
  }

  const pageCount = doc.getNumberOfPages()
  const generatedOn = new Date().toLocaleString()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    setMuted(doc)
    doc.text(`Generated ${generatedOn}`, PAGE_MARGIN, pageH - 20)
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() - PAGE_MARGIN, pageH - 20, {
      align: "right",
    })
  }

  doc.save(`${spec.filename}-${todayDateParam()}.pdf`)
}
