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
  const xAt = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const yBase = padT + plotH

  const singleSeries = useMemo(() => {
    if (multi || days.length === 0) return null
    const series = days.map((d) => getMetricNumeric(primaryMetric, d))
    const rawMax = Math.max(0, ...series)
    const yTicks = buildYTicks(rawMax, primaryMetric)
    const yMax = Math.max(yTicks[yTicks.length - 1] ?? 1, 1e-6)
    const yAtAbs = (val: number) => padT + plotH - (val / yMax) * plotH
    const polyPoints = days.map((_, i) => `${xAt(i)},${yAtAbs(series[i] ?? 0)}`).join(" ")
    let areaD = ""
    if (n > 0) {
      areaD = `M ${xAt(0)} ${yBase} L ${xAt(0)} ${yAtAbs(series[0] ?? 0)}`
      for (let i = 1; i < n; i++) {
        areaD += ` L ${xAt(i)} ${yAtAbs(series[i] ?? 0)}`
      }
      areaD += ` L ${xAt(n - 1)} ${yBase} Z`
    }
    return { series, yTicks, yAtAbs, polyPoints, areaD, yMax }
  }, [multi, days, primaryMetric, n, padT, plotH, yBase])

  const multiSeries = useMemo(() => {
    if (!multi || days.length === 0) return null
    return activeMetrics.map((m) => {
      const raw = days.map((d) => getMetricNumeric(m, d))
      const norm = normalizeSeriesTo01(raw)
      const yAtN = (t: number) => padT + plotH - t * plotH
      const polyPoints = norm.map((t, i) => `${xAt(i)},${yAtN(t)}`).join(" ")
      return { metric: m, raw, norm, polyPoints, style: CHART_SERIES_STYLES[m] }
    })
  }, [multi, days, activeMetrics, padT, plotH, n])

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

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-6 py-3">
        <h3 className="shrink-0 text-base font-semibold text-slate-800">Chart</h3>
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
                  on ? CHART_METRIC_PILL_ON[m] : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-50/80 px-6 py-2">
        {activeMetrics.map((m) => (
          <div key={m} className="flex items-center gap-1.5">
            <div className="h-0.5 w-5 rounded-full" style={{ backgroundColor: CHART_SERIES_STYLES[m].stroke }} />
            <span className="text-xs text-slate-500">{METRIC_OPTIONS.find((o) => o.value === m)?.label}</span>
          </div>
        ))}
        {multi && (
          <span className="text-[10px] text-slate-400">(Y axis: 0–100% of each series&apos; range)</span>
        )}
      </div>
      <div className="px-6 pb-6 pt-1">
        {days.length === 0 ? (
          <div className="flex h-[240px] items-center justify-center text-sm text-slate-400">No data for this filter</div>
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
              aria-label="Time series chart"
            >
              <defs>
                <linearGradient id="ta-area-blue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(59 130 246)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="rgb(59 130 246)" stopOpacity="0.02" />
                </linearGradient>
                <linearGradient id="ta-area-green" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(34 197 94)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="rgb(34 197 94)" stopOpacity="0.02" />
                </linearGradient>
                <linearGradient id="ta-area-amber" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(245 158 11)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="rgb(245 158 11)" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {!multi && singleSeries && (
                <>
                  {singleSeries.yTicks.map((t) => {
                    const yy = singleSeries.yAtAbs(t)
                    return (
                      <text key={t} x={padL - 6} y={yy + 4} textAnchor="end" fill="#94a3b8" style={{ fontSize: 10 }}>
                        {formatYTick(primaryMetric, t)}
                      </text>
                    )
                  })}
                  {singleSeries.areaD && (
                    <path d={singleSeries.areaD} fill={`url(#${CHART_SERIES_STYLES[primaryMetric].gradientId})`} />
                  )}
                  {singleSeries.polyPoints && (
                    <polyline
                      fill="none"
                      stroke={CHART_SERIES_STYLES[primaryMetric].stroke}
                      strokeWidth={2.25}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      points={singleSeries.polyPoints}
                    />
                  )}
                  {days.map((d, i) => {
                    const cx = xAt(i)
                    const cy = singleSeries.yAtAbs(singleSeries.series[i] ?? 0)
                    const dense = days.length > 10
                    const r = hovered === i ? (dense ? 4.5 : 5) : dense ? 2.75 : 3.5
                    return (
                      <circle
                        key={d.date}
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill="white"
                        stroke={CHART_SERIES_STYLES[primaryMetric].stroke}
                        strokeWidth={2}
                      />
                    )
                  })}
                </>
              )}
              {multi && multiSeries && (
                <>
                  {[0, 25, 50, 75, 100].map((pct) => {
                    const yy = padT + plotH - (pct / 100) * plotH
                    return (
                      <text key={pct} x={padL - 6} y={yy + 4} textAnchor="end" fill="#94a3b8" style={{ fontSize: 10 }}>
                        {pct}%
                      </text>
                    )
                  })}
                  {multiSeries.map(({ metric: m, polyPoints, style }) => (
                    <polyline
                      key={m}
                      fill="none"
                      stroke={style.stroke}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      points={polyPoints}
                      opacity={0.95}
                    />
                  ))}
                </>
              )}
            </svg>
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
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-between gap-0.5 px-1"
              style={{ paddingLeft: padL, paddingRight: padR }}
            >
              {days.map((d, i) => (
                <IconTooltip key={d.date} text={d.dateLabel} placement="top">
                  <span className="min-w-0 flex-1 truncate text-center text-[9px] leading-tight text-slate-400">
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

