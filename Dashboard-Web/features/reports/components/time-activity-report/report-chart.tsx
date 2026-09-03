"use client"

import { useMemo, useRef, useState } from "react"
import {
  CHART_METRIC_ORDER,
  CHART_METRIC_PILL_ON,
  CHART_SERIES_STYLES,
  METRIC_OPTIONS,
} from "@/features/reports/components/shared/constants"
import { useFillChartWidth } from "@/features/reports/hooks/use-fill-chart-width"
import { cn } from "@/shared/utils/utils"
import {
  buildYTicks,
  formatMetricDisplayValue,
  formatYTick,
  getMetricNumeric,
  normalizeSeriesTo01,
} from "@/features/reports/utils/time-and-activity"
import type { TimeActivityDayRow, TimeActivityMetric } from "@/features/reports/models/time-and-activity"

const BAR_COLORS: Record<TimeActivityMetric, string> = {
  total_hours: "rgb(56 189 248)",   // sky-400
  activity:    "rgb(74 222 128)",   // green-400
  total_spent: "rgb(251 191 36)",   // amber-400
}

const LEGEND_DOTS: Record<TimeActivityMetric, string> = {
  total_hours: "rgb(56 189 248)",
  activity:    "rgb(74 222 128)",
  total_spent: "rgb(251 191 36)",
}

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

  const CHART_H  = 260
  const padL     = 48
  const padR     = 16
  const padT     = 16
  const padB     = 52

  const MIN_SLOT = 44
  const n = Math.max(days.length, 1)
  const { containerRef: wrapRef, slotW, vbW } = useFillChartWidth({
    pointCount: n,
    minSlot: MIN_SLOT,
    padL,
    padR,
  })
  const plotW = n * slotW
  const plotH = CHART_H - padT - padB

  const BAR_PAD  = slotW * 0.10
  const barW     = slotW - BAR_PAD * 2

  const singleBar = useMemo(() => {
    if (multi || days.length === 0) return null
    const series = days.map((d) => getMetricNumeric(primaryMetric, d))
    const rawMax = Math.max(0, ...series)
    const yTicks = buildYTicks(rawMax, primaryMetric)
    const yMax   = Math.max(yTicks[yTicks.length - 1] ?? 1, 1e-6)
    const yAt    = (val: number) => padT + plotH - (val / yMax) * plotH
    return { series, yTicks, yMax, yAt }
  }, [multi, days, primaryMetric, padT, plotH])

  const multiBar = useMemo(() => {
    if (!multi || days.length === 0) return null
    return activeMetrics.map((m) => {
      const raw  = days.map((d) => getMetricNumeric(m, d))
      const norm = normalizeSeriesTo01(raw)
      return { metric: m, raw, norm }
    })
  }, [multi, days, activeMetrics])

  function indexFromClientX(clientX: number): number {
    const el  = svgRef.current
    const wr  = wrapRef.current
    if (!el || !wr || days.length === 0) return 0
    const rect = el.getBoundingClientRect()
    const vbw  = el.viewBox.baseVal.width
    const x    = ((clientX - rect.left) / rect.width) * vbw
    const i    = Math.floor((x - padL) / slotW)
    return Math.max(0, Math.min(days.length - 1, i))
  }

  function renderBar(x: number, w: number, yTop: number, fill: string, opacity = 1, key?: string | number) {
    const h = padT + plotH - yTop
    if (h <= 0) return null
    return <rect key={key} x={x} y={yTop} width={w} height={h} fill={fill} opacity={opacity} rx={0} />
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Chart</h3>

        <div className="flex items-center gap-4">
          {activeMetrics.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onToggleMetric(m)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                enabledMetrics.has(m)
                  ? CHART_METRIC_PILL_ON[m]
                  : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800",
              )}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: enabledMetrics.has(m) ? LEGEND_DOTS[m] : "#94a3b8" }}
              />
              {METRIC_OPTIONS.find((o) => o.value === m)?.label}
            </button>
          ))}
          {CHART_METRIC_ORDER.filter((m) => !enabledMetrics.has(m) || !activeMetrics.includes(m)).map((m) => {
            if (enabledMetrics.has(m)) return null
            return (
              <button
                key={m}
                type="button"
                onClick={() => onToggleMetric(m)}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                {METRIC_OPTIONS.find((o) => o.value === m)?.label}
              </button>
            )
          })}
        </div>
      </div>

      <div
        ref={wrapRef}
        className="overflow-x-auto custom-scrollbar-x"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {days.length === 0 ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-slate-400 dark:text-slate-500">
            No data for this filter
          </div>
        ) : (
          <div
            className="relative"
            style={{ height: CHART_H, width: vbW }}
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
              {!multi && singleBar && singleBar.yTicks.map((t) => {
                const yy = singleBar.yAt(t)
                return (
                  <g key={t}>
                    <line x1={padL} x2={padL + plotW} y1={yy} y2={yy} stroke="#e2e8f0" strokeWidth={0.8} />
                    <text x={padL - 6} y={yy + 4} textAnchor="end" fill="#94a3b8" fontSize={10}>
                      {formatYTick(primaryMetric, t)}
                    </text>
                  </g>
                )
              })}
              {multi && [0, 25, 50, 75, 100].map((pct) => {
                const yy = padT + plotH - (pct / 100) * plotH
                return (
                  <g key={pct}>
                    <line x1={padL} x2={padL + plotW} y1={yy} y2={yy} stroke="#e2e8f0" strokeWidth={0.8} />
                    <text x={padL - 6} y={yy + 4} textAnchor="end" fill="#94a3b8" fontSize={10}>
                      {pct}%
                    </text>
                  </g>
                )
              })}

              <line
                x1={padL} x2={padL + plotW}
                y1={padT + plotH} y2={padT + plotH}
                stroke="#94a3b8" strokeWidth={1.5}
              />

              {!multi && singleBar && days.map((d, i) => {
                const val   = singleBar.series[i] ?? 0
                const yTop  = singleBar.yAt(val)
                const x     = padL + i * slotW + BAR_PAD
                const isHov = hovered === i
                return (
                  <g key={d.date}>
                    {isHov && (
                      <rect
                        x={padL + i * slotW} y={padT}
                        width={slotW} height={plotH}
                        fill="rgba(0,0,0,0.04)"
                      />
                    )}
                    {renderBar(x, barW, yTop, BAR_COLORS[primaryMetric], isHov ? 1 : 0.82)}
                  </g>
                )
              })}

              {multi && multiBar && days.map((d, i) => {
                const mc     = multiBar.length
                const gW     = barW
                const bW     = (gW - (mc - 1) * 3) / mc
                const groupX = padL + i * slotW + BAR_PAD
                const isHov  = hovered === i
                const yAtN   = (t: number) => padT + plotH - t * plotH
                return (
                  <g key={d.date}>
                    {isHov && (
                      <rect
                        x={padL + i * slotW} y={padT}
                        width={slotW} height={plotH}
                        fill="rgba(0,0,0,0.04)"
                      />
                    )}
                    {multiBar.map(({ metric: m, norm }, mi) => {
                      const val  = norm[i] ?? 0
                      const barX = groupX + mi * (bW + 3)
                      return renderBar(barX, bW, yAtN(val), BAR_COLORS[m], isHov ? 1 : 0.82, m)
                    })}
                  </g>
                )
              })}

              {days.map((d, i) => {
                const cx = padL + i * slotW + slotW / 2
                const label = d.dateLabel
                return (
                  <text
                    key={d.date}
                    x={cx}
                    y={padT + plotH + 14}
                    textAnchor="end"
                    fill="#64748b"
                    fontSize={9.5}
                    transform={`rotate(-35, ${cx}, ${padT + plotH + 14})`}
                  >
                    {label}
                  </text>
                )
              })}
            </svg>

            {hovered !== null && days[hovered] && (() => {
              const d   = days[hovered]
              const cx  = padL + hovered * slotW + slotW / 2
              const pct = cx / vbW
              return (
                <div
                  className="pointer-events-none absolute top-3 z-20"
                  style={{ left: `calc(${pct * 100}% - 80px)` }}
                >
                  <div className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-white shadow-xl min-w-[140px]">
                    <div className="mb-1.5 font-semibold text-[11px] text-slate-200">{d.dateLabel}</div>
                    {activeMetrics.map((m) => (
                      <div key={m} className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-sm shrink-0"
                          style={{ backgroundColor: BAR_COLORS[m] }}
                        />
                        <span className="text-slate-300">
                          {METRIC_OPTIONS.find((o) => o.value === m)?.label}:
                        </span>
                        <span className="ml-auto font-medium text-white pl-2">
                          {formatMetricDisplayValue(m, d)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
