"use client"

import { useMemo, useRef, useState, type CSSProperties } from "react"
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
import { useWorkspaceCurrency } from "@/shared/utils/workspace-currency"

const BAR_COLORS: Record<TimeActivityMetric, string> = {
  total_hours: "rgb(56 189 248)",   // sky-400
  activity:    "rgb(74 222 128)",   // green-400
  total_spent: "rgb(251 191 36)",   // amber-400
}

/** Manually added time, stacked on top of tracked time in the total-hours
 *  bar. A lighter tint of the same sky rather than a new hue: it is the
 *  same measure, just not machine-recorded. */
const MANUAL_BAR_COLOR = "rgb(186 230 253)" // sky-200

/** Decimal hours as H:MM, matching how the tooltip's other durations read. */
function formatHoursClock(hours: number): string {
  const total = Math.max(0, Math.round(hours * 3600))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
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
  const currency = useWorkspaceCurrency()
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
  // A slot fills the chart width, so with one day (or a handful) a bar was
  // as wide as the whole plot - one giant block, which is what made the
  // single-day chart look broken (PLAN-bug-fixes-round-1.md item 7). Bars
  // are capped and centred in their slot instead.
  const MAX_BAR_W = 72
  const barW     = Math.min(slotW - BAR_PAD * 2, MAX_BAR_W)
  const barInset = (slotW - barW) / 2

  const singleBar = useMemo(() => {
    if (multi || days.length === 0) return null
    const series = days.map((d) => getMetricNumeric(primaryMetric, d))
    // Manually added hours, stacked above the tracked ones. Only the
    // total-hours metric has a manual component - an activity percentage or
    // a spend figure does not split this way.
    //
    // getMetricNumeric("total_hours") returns trackedHours ALONE, while the
    // table's own "Total hours" column is tracked + manual. The chart was
    // therefore quietly excluding manual time from the very number the
    // table said included it.
    const manualSeries =
      primaryMetric === "total_hours" ? days.map((d) => Math.max(0, d.manualHours ?? 0)) : days.map(() => 0)
    // Scale to the stacked total, so a bar that is mostly manual time is not
    // clipped at the top.
    const rawMax = Math.max(0, ...series.map((v, i) => v + (manualSeries[i] ?? 0)))
    const yTicks = buildYTicks(rawMax, primaryMetric)
    const yMax   = Math.max(yTicks[yTicks.length - 1] ?? 1, 1e-6)
    const yAt    = (val: number) => padT + plotH - (val / yMax) * plotH
    return { series, manualSeries, yTicks, yMax, yAt }
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
                      {formatYTick(primaryMetric, t, currency)}
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
                const val    = singleBar.series[i] ?? 0
                const manual = singleBar.manualSeries[i] ?? 0
                const x      = padL + i * slotW + barInset
                const isHov  = hovered === i
                // Tracked sits on the axis, manual stacks on top of it, so
                // the bar's full height is the same total the table shows.
                const trackedTop = singleBar.yAt(val)
                const stackedTop = singleBar.yAt(val + manual)
                return (
                  <g key={d.date}>
                    {isHov && (
                      <rect
                        x={padL + i * slotW} y={padT}
                        width={slotW} height={plotH}
                        fill="rgba(0,0,0,0.04)"
                      />
                    )}
                    {renderBar(x, barW, trackedTop, BAR_COLORS[primaryMetric], isHov ? 1 : 0.82, "tracked")}
                    {manual > 0
                      ? (() => {
                          const h = trackedTop - stackedTop
                          return h > 0 ? (
                            <rect
                              key="manual"
                              x={x}
                              y={stackedTop}
                              width={barW}
                              height={h}
                              fill={MANUAL_BAR_COLOR}
                              opacity={isHov ? 1 : 0.82}
                            />
                          ) : null
                        })()
                      : null}
                  </g>
                )
              })}

              {multi && multiBar && days.map((d, i) => {
                const mc     = multiBar.length
                const gW     = barW
                const bW     = (gW - (mc - 1) * 3) / mc
                const groupX = padL + i * slotW + barInset
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

              // The top of whichever bar is hovered, in viewBox units. Single
              // metric: that bar's own top. Multi: the tallest of the grouped
              // bars, so the card clears all of them rather than overlapping
              // the tall one while clearing the short one.
              const barTopVb = !multi && singleBar
                ? // The STACKED top (tracked + manual), not the tracked one -
                  // otherwise the card is placed against a bar shorter than
                  // the one actually drawn and lands on top of the manual
                  // segment.
                  singleBar.yAt((singleBar.series[hovered] ?? 0) + (singleBar.manualSeries[hovered] ?? 0))
                : multiBar
                  ? Math.min(
                      ...multiBar.map(({ norm }) => padT + plotH - (norm[hovered] ?? 0) * plotH),
                    )
                  : padT + plotH

              // Tracked and manual are shown as their own rows when there is
              // manual time on this day, matching the two stacked segments.
              const manualHrs = !multi && primaryMetric === "total_hours" ? (d.manualHours ?? 0) : 0
              const showManualSplit = manualHrs > 0

              // viewBox units map 1:1 to CSS pixels vertically here: the
              // wrapper is exactly CHART_H tall and the viewBox is CHART_H
              // high, so no scaling factor is needed.
              const TOOLTIP_GAP = 10
              // Used only to DECIDE between above and beside - never to place
              // the card. Placement is anchored with CSS transforms, so the
              // card's real rendered size cannot push it onto the bar (an
              // estimated height did exactly that once the text wrapped).
              const EST_TOOLTIP_H = 36 + (activeMetrics.length + (showManualSplit ? 1 : 0)) * 20
              const EST_TOOLTIP_W = 180
              // Horizontal viewBox units are 1:1 with CSS pixels too: the
              // wrapper is exactly vbW wide and the viewBox is vbW wide.
              const barLeftVb = padL + hovered * slotW + barInset
              const barRightVb = barLeftVb + barW

              // Above the bar when there is room. When there is not - the
              // tallest bars - BESIDE it, never over it: an earlier version
              // fell back to "just below the bar's top", which for a tall bar
              // is simply on top of the bar again (measured in the browser,
              // not assumed). The original fixed `top-3` covered any bar tall
              // enough to reach it.
              let tipStyle: CSSProperties
              if (barTopVb - TOOLTIP_GAP - EST_TOOLTIP_H >= 0) {
                // Bottom edge sits TOOLTIP_GAP above the bar, whatever the
                // card's actual height. Horizontally centred on the bar, but
                // pinned to an edge near the chart's ends so it is not clipped.
                const alignLeft = cx - EST_TOOLTIP_W / 2 < 0
                const alignRight = cx + EST_TOOLTIP_W / 2 > vbW
                tipStyle = {
                  left: alignLeft ? 0 : alignRight ? vbW : cx,
                  top: barTopVb - TOOLTIP_GAP,
                  transform: `translate(${alignLeft ? "0" : alignRight ? "-100%" : "-50%"}, -100%)`,
                }
              } else {
                const fitsRight = barRightVb + TOOLTIP_GAP + EST_TOOLTIP_W <= vbW
                tipStyle = {
                  left: fitsRight ? barRightVb + TOOLTIP_GAP : barLeftVb - TOOLTIP_GAP,
                  top: Math.max(padT, barTopVb),
                  transform: fitsRight ? undefined : "translateX(-100%)",
                }
              }

              return (
                <div className="pointer-events-none absolute z-20 whitespace-nowrap" style={tipStyle}>
                  <div className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-white shadow-xl min-w-[140px]">
                    <div className="mb-1.5 font-semibold text-[11px] text-slate-200">{d.dateLabel}</div>
                    {activeMetrics.map((m) => (
                      <div key={m} className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-sm shrink-0"
                          style={{ backgroundColor: BAR_COLORS[m] }}
                        />
                        <span className="text-slate-300">
                          {showManualSplit && m === "total_hours"
                            ? "Tracked"
                            : METRIC_OPTIONS.find((o) => o.value === m)?.label}
                          :
                        </span>
                        <span className="ml-auto font-medium text-white pl-2">
                          {showManualSplit && m === "total_hours"
                            ? // The tracked segment alone. formatMetricDisplayValue
                              // returns totalHours, which already includes the
                              // manual time listed on the next row - showing
                              // it here counted manual time twice.
                              formatHoursClock(d.trackedHours ?? 0)
                            : formatMetricDisplayValue(m, d)}
                        </span>
                      </div>
                    ))}
                    {showManualSplit ? (
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-sm shrink-0"
                          style={{ backgroundColor: MANUAL_BAR_COLOR }}
                        />
                        <span className="text-slate-300">Manual:</span>
                        <span className="ml-auto font-medium text-white pl-2">
                          {formatHoursClock(manualHrs)}
                        </span>
                      </div>
                    ) : null}
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
