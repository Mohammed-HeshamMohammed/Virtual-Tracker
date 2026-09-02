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
import {
  buildYTicks,
  formatMetricDisplayValue,
  formatYTick,
  getMetricNumeric,
  normalizeSeriesTo01,
} from "@/features/reports/utils/time-and-activity"
import type { TimeActivityDayRow, TimeActivityMetric } from "@/features/reports/models/time-and-activity"

// Slightly lighter, friendlier palette – closer to the reference screenshot
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
  const wrapRef = useRef<HTMLDivElement>(null)

  const activeMetrics = useMemo((): TimeActivityMetric[] => {
    const found = CHART_METRIC_ORDER.filter((m) => enabledMetrics.has(m))
    return found.length > 0 ? found : ["total_hours"]
  }, [enabledMetrics])

  const primaryMetric: TimeActivityMetric = activeMetrics[0] ?? "total_hours"
  const multi = activeMetrics.length > 1

  // ── Layout ──────────────────────────────────────────────────────────────
  const CHART_H  = 260
  const padL     = 48   // room for Y-axis labels
  const padR     = 16
  const padT     = 16
  const padB     = 52   // room for angled X-axis labels

  // Each day gets a fixed slot width so bars stay wide even with few points.
  // For many points the SVG scrolls horizontally.
  const MIN_SLOT = 52
  const n = Math.max(days.length, 1)

  // dynamic viewbox width: at least fill the container, at most scroll
  const VB_MIN_W = 700
  const slotW    = Math.max(MIN_SLOT, (VB_MIN_W - padL - padR) / n)
  const vbW      = padL + n * slotW + padR
  const plotW    = n * slotW
  const plotH    = CHART_H - padT - padB

  // Bar width: ~80 % of slot, flat tops (radius = 0)
  const BAR_PAD  = slotW * 0.10
  const barW     = slotW - BAR_PAD * 2

  // ── Data ─────────────────────────────────────────────────────────────────
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

  // ── Hover hit detection ───────────────────────────────────────────────────
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

  // ── Bar shape: flat-topped rect ───────────────────────────────────────────
  function renderBar(x: number, w: number, yTop: number, fill: string, opacity = 1, key?: string | number) {
    const h = padT + plotH - yTop
    if (h <= 0) return null
    return <rect key={key} x={x} y={yTop} width={w} height={h} fill={fill} opacity={opacity} rx={0} />
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">

      {/* ── Card header ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Chart</h3>

        {/* Legend – top right, like the reference */}
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
              {/* dot swatch */}
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: enabledMetrics.has(m) ? LEGEND_DOTS[m] : "#94a3b8" }}
              />
              {METRIC_OPTIONS.find((o) => o.value === m)?.label}
            </button>
          ))}
          {/* show inactive pills too so user can re-enable */}
          {CHART_METRIC_ORDER.filter((m) => !enabledMetrics.has(m) || !activeMetrics.includes(m)).map((m) => {
            if (enabledMetrics.has(m)) return null   // already shown above
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

      {/* ── Chart area (horizontally scrollable) ───────────────────────── */}
      <div
        ref={wrapRef}
        className="overflow-x-auto"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {days.length === 0 ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-slate-400 dark:text-slate-500">
            No data for this filter
          </div>
        ) : (
          <div
            className="relative"
            // A fixed width, not minWidth: the SVG below stretches to fill
            // whatever this div ends up (preserveAspectRatio="none", so it
            // has no aspect ratio of its own to fall back on) - minWidth is
            // only a floor, so this div (and the chart with it) was filling
            // the full width of whatever oversized card/page it sat in,
            // turning a week of bars into a thin, flat smear. Pinned to the
            // chart's own natural data-driven width instead; overflow-x-auto
            // on the wrapper above still scrolls for a range with many days.
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
              {/* ── Grid lines + Y labels ─────────────────────────────── */}
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

              {/* ── Baseline ─────────────────────────────────────────── */}
              <line
                x1={padL} x2={padL + plotW}
                y1={padT + plotH} y2={padT + plotH}
                stroke="#94a3b8" strokeWidth={1.5}
              />

              {/* ── Single-metric bars ────────────────────────────────── */}
              {!multi && singleBar && days.map((d, i) => {
                const val   = singleBar.series[i] ?? 0
                const yTop  = singleBar.yAt(val)
                const x     = padL + i * slotW + BAR_PAD
                const isHov = hovered === i
                return (
                  <g key={d.date}>
                    {/* hover column highlight */}
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

              {/* ── Multi-metric grouped bars ─────────────────────────── */}
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

              {/* ── X-axis labels (angled) ────────────────────────────── */}
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

            {/* ── Hover tooltip ─────────────────────────────────────── */}
            {hovered !== null && days[hovered] && (() => {
              const d   = days[hovered]
              const cx  = padL + hovered * slotW + slotW / 2
              // pixel position relative to SVG viewbox, convert to %
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
