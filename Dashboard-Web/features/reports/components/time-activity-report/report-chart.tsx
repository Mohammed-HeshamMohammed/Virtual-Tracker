/* eslint-disable react-doctor/exhaustive-deps */
"use client"

import { useMemo, useRef, useState } from "react"
import {
  CHART_METRIC_ORDER,
  CHART_METRIC_PILL_ON,
  CHART_SERIES_STYLES,
  METRIC_OPTIONS,
} from "@/features/reports/components/shared/constants"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import {
  buildYTicks,
  formatMetricDisplayValue,
  formatYTick,
  getMetricNumeric,
  normalizeSeriesTo01,
} from "@/features/reports/utils/time-and-activity"
import type { TimeActivityDayRow, TimeActivityMetric } from "@/features/reports/models/time-and-activity"

export function ReportTimeActivityChart({
  days,
  enabledMetrics,
  onToggleMetric,
}: {
  days: TimeActivityDayRow[]
  enabledMetrics: Set<TimeActivityMetric>
  onToggleMetric: (m: TimeActivityMetric) => void
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const activeMetrics = useMemo((): TimeActivityMetric[] => {
    const found = CHART_METRIC_ORDER.filter((m) => enabledMetrics.has(m))
    return found.length > 0 ? found : ["total_hours"]
  }, [enabledMetrics])

  const primaryMetric: TimeActivityMetric = activeMetrics[0] ?? "total_hours"
  const multi = activeMetrics.length > 1

  const CHART_H = 240
  const padL = 44
  const padR = 12
  const padT = 12
  const padB = 28
  const vbW = 960
  const plotW = vbW - padL - padR
  const plotH = CHART_H - padT - padB

  const n = Math.max(days.length, 1)

  // Bar layout constants
  const BAR_GAP_RATIO = 0.25   // fraction of slot width used as gap between day-slots
  const GROUP_GAP_RATIO = 0.08 // fraction of bar width used as gap between bars in a group
  const BAR_RADIUS = 3

  const slotW = plotW / n
  const dayPad = slotW * BAR_GAP_RATIO
  const groupW = slotW - dayPad

  // Single-metric bar data
  const singleBar = useMemo(() => {
    if (multi || days.length === 0) return null
    const series = days.map((d) => getMetricNumeric(primaryMetric, d))
    const rawMax = Math.max(0, ...series)
    const yTicks = buildYTicks(rawMax, primaryMetric)
    const yMax = Math.max(yTicks[yTicks.length - 1] ?? 1, 1e-6)
    const yAtAbs = (val: number) => padT + plotH - (val / yMax) * plotH
    return { series, yTicks, yAtAbs, yMax }
  }, [multi, days, primaryMetric, padT, plotH])

  // Multi-metric bar data (normalised 0-1 per series)
  const multiBar = useMemo(() => {
    if (!multi || days.length === 0) return null
    return activeMetrics.map((m) => {
      const raw = days.map((d) => getMetricNumeric(m, d))
      const norm = normalizeSeriesTo01(raw)
      return { metric: m, raw, norm, style: CHART_SERIES_STYLES[m] }
    })
  }, [multi, days, activeMetrics])

  /** Map a clientX position to the nearest day index */
  function indexFromClientX(clientX: number): number {
    const el = svgRef.current
    if (!el || days.length === 0) return 0
    const rect = el.getBoundingClientRect()
    const w = el.viewBox.baseVal.width
    const x = ((clientX - rect.left) / rect.width) * w
    const t = (x - padL) / plotW
    if (days.length === 1) return 0
    const idx = Math.round(t * (days.length - 1))
    return Math.max(0, Math.min(days.length - 1, idx))
  }

  /** Render a single bar with a rounded top via SVG path */
  function renderBar(
    x: number,
    barW: number,
    yTop: number,
    fill: string,
    opacity = 1,
    key?: string | number,
  ) {
    const h = padT + plotH - yTop
    if (h <= 0) return null
    const r = Math.min(BAR_RADIUS, barW / 2, h / 2)
    const d = `M${x + r},${yTop} h${barW - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} h${-barW} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r}z`
    return <path key={key} d={d} fill={fill} opacity={opacity} />
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
      {/* Header: title + metric toggle pills */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 dark:border-slate-800 px-6 py-3">
        <h3 className="shrink-0 text-base font-semibold text-slate-800 dark:text-slate-100">Chart</h3>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <span className="sr-only">Choose metrics to show on the chart</span>
          {METRIC_OPTIONS.map((opt) => {
            const m = opt.value as TimeActivityMetric
            const on = enabledMetrics.has(m)
            return (
              <button
                key={m}
                type="button"
                onClick={() => onToggleMetric(m)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  on
                    ? CHART_METRIC_PILL_ON[m]
                    : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800",
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Legend - square swatch suits bars better than a line swatch */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-50/80 dark:border-slate-800/80 px-6 py-2">
        {activeMetrics.map((m) => (
          <div key={m} className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: CHART_SERIES_STYLES[m].stroke }} />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {METRIC_OPTIONS.find((o) => o.value === m)?.label}
            </span>
          </div>
        ))}
        {multi && (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            (Y axis: 0-100% of each series&apos; range)
          </span>
        )}
      </div>

      {/* Chart body */}
      <div className="px-6 pb-6 pt-1">
        {days.length === 0 ? (
          <div className="flex h-[240px] items-center justify-center text-sm text-slate-400 dark:text-slate-500">
            No data for this filter
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: CHART_H }}
            onMouseMove={(e) => setHovered(indexFromClientX(e.clientX))}
            onMouseLeave={() => setHovered(null)}
          >
            <svg
              ref={svgRef}
              className="h-full w-full"
              viewBox={`0 0 ${vbW} ${CHART_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="Bar chart"
            >
              {/* Single-metric bars */}
              {!multi && singleBar && (() => {
                const { series, yTicks, yAtAbs } = singleBar
                const style = CHART_SERIES_STYLES[primaryMetric]
                return (
                  <>
                    {yTicks.map((t) => {
                      const yy = yAtAbs(t)
                      return (
                        <g key={t}>
                          <line
                            x1={padL} x2={padL + plotW} y1={yy} y2={yy}
                            stroke="#e2e8f0" strokeWidth={0.75} strokeDasharray="3 3"
                          />
                          <text x={padL - 6} y={yy + 4} textAnchor="end" fill="#94a3b8" style={{ fontSize: 10 }}>
                            {formatYTick(primaryMetric, t)}
                          </text>
                        </g>
                      )
                    })}
                    {days.map((d, i) => {
                      const val = series[i] ?? 0
                      const yTop = yAtAbs(val)
                      const x = padL + i * slotW + dayPad / 2
                      const isHov = hovered === i
                      return (
                        <g key={d.date}>
                          {renderBar(x, groupW, yTop, style.stroke, isHov ? 1 : 0.75)}
                          {isHov && val > 0 && (
                            <rect x={x} y={yTop - 2} width={groupW} height={3} rx={1.5} fill={style.stroke} />
                          )}
                        </g>
                      )
                    })}
                  </>
                )
              })()}

              {/* Multi-metric grouped bars */}
              {multi && multiBar && (() => {
                const mc = multiBar.length
                const barW = (groupW - (mc - 1) * groupW * GROUP_GAP_RATIO) / mc
                const barGap = groupW * GROUP_GAP_RATIO
                const yAtN = (t: number) => padT + plotH - t * plotH
                return (
                  <>
                    {[0, 25, 50, 75, 100].map((pct) => {
                      const yy = padT + plotH - (pct / 100) * plotH
                      return (
                        <g key={pct}>
                          <line
                            x1={padL} x2={padL + plotW} y1={yy} y2={yy}
                            stroke="#e2e8f0" strokeWidth={0.75} strokeDasharray="3 3"
                          />
                          <text x={padL - 6} y={yy + 4} textAnchor="end" fill="#94a3b8" style={{ fontSize: 10 }}>
                            {pct}%
                          </text>
                        </g>
                      )
                    })}
                    {days.map((d, i) => {
                      const groupX = padL + i * slotW + dayPad / 2
                      const isHov = hovered === i
                      return (
                        <g key={d.date}>
                          {multiBar.map(({ metric: m, norm, style }, mi) => {
                            const val = norm[i] ?? 0
                            const barX = groupX + mi * (barW + barGap)
                            const yTop = yAtN(val)
                            return (
                              <g key={m}>
                                {renderBar(barX, barW, yTop, style.stroke, isHov ? 1 : 0.75)}
                                {isHov && val > 0 && (
                                  <rect x={barX} y={yTop - 2} width={barW} height={3} rx={1.5} fill={style.stroke} />
                                )}
                              </g>
                            )
                          })}
                        </g>
                      )
                    })}
                  </>
                )
              })()}

              {/* Baseline */}
              <line
                x1={padL} x2={padL + plotW}
                y1={padT + plotH} y2={padT + plotH}
                stroke="#cbd5e1" strokeWidth={1}
              />
            </svg>

            {/* Hover tooltip */}
            {hovered !== null && days[hovered] && (
              <div className="pointer-events-none absolute left-1/2 top-2 z-10 max-w-sm -translate-x-1/2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white shadow-lg">
                <div className="font-semibold">{days[hovered].dateLabel}</div>
                <div className="mt-1 space-y-0.5 text-slate-300">
                  {activeMetrics.map((m) => (
                    <div key={m} className="flex justify-between gap-4">
                      <span>{METRIC_OPTIONS.find((o) => o.value === m)?.label}</span>
                      <span className="font-medium text-white">{formatMetricDisplayValue(m, days[hovered])}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* X-axis labels */}
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-between gap-0.5 px-1"
              style={{ paddingLeft: padL, paddingRight: padR }}
            >
              {days.map((d, i) => (
                <IconTooltip key={d.date} text={d.dateLabel} placement="top">
                  <span className="min-w-0 flex-1 truncate text-center text-[9px] leading-tight text-slate-400 dark:text-slate-500">
                    {days.length > 12 && i % 2 === 1 ? "" : d.dateLabel.replace(", 2026", "")}
                  </span>
                </IconTooltip>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
