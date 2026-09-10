/** One period a limit is actually about: a Monday-Sunday week, or a day. */
export interface LimitPeriodRow {
  periodStart: string
  periodEnd: string
  limitHours: number
  trackedHours: number
  /** Not clamped: 130% means 30% over, which is the point of the report. */
  pctUsed: number
  overLimit: boolean
  /** The period extends outside the selected range, so these hours are only
   *  part of it and the percentage will keep climbing. */
  partial: boolean
}

export interface LimitUsageRow {
  memberId: string
  name: string
  initials: string
  limitHours: number
  /** Across every period in range - a total, never compared to one limit. */
  totalTrackedHours: number
  periods: number
  periodsOverLimit: number
  peakPctUsed: number
  periodRows: LimitPeriodRow[]
}
