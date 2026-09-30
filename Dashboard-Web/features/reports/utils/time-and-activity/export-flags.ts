// Which rows of the Time & Activity report deserve a second look, and why.
//
// Self-contained on purpose (no imports): the thresholds and the rules that use them are
// tested straight from Node, and the workbook's legend is printed from the same constants so
// what a colour means on the sheet can never drift from what the code actually checks.
//
// Every rule reads only what the report already has - active, idle and manual hours - so a
// flag never depends on pay (a viewer who may not see money sees exactly the same flags).

export const RISK_RULES = {
  /** Idle time as a share of tracked time (active + idle). Under `minSampleHours` of tracking
   *  there is too little to judge, so a short session that happened to start idle is not flagged. */
  idle: { warningShare: 0.3, criticalShare: 0.5, minSampleHours: 0.5 },
  /** One member's hours in one day (tracked + manual) - a forgotten running timer, or overwork. */
  longDay: { warningHours: 10, criticalHours: 14 },
  /** Hours entered by hand rather than tracked: worth a review, not an accusation. */
  manual: { reviewShare: 0.5, minManualHours: 1 },
} as const

export type Severity = "none" | "review" | "warning" | "critical"

const RANK: Record<Severity, number> = { none: 0, review: 1, warning: 2, critical: 3 }

export function worstSeverity(a: Severity, b: Severity): Severity {
  return RANK[b] > RANK[a] ? b : a
}

export interface RowMetrics {
  activeHours: number
  idleHours: number
  manualHours: number
}

export interface RowFlags {
  /** The worst thing found on the row. */
  severity: Severity
  /** Plain-language reasons, worst first - what the Flags column prints. */
  reasons: string[]
  /** Which metric columns to emphasise, by the table's own column key. */
  cells: Record<string, Severity>
}

export interface FlagContext {
  /** The row is one member's single day, so the long-day rule means something. In any other
   *  grouping a row spans several days and its total says nothing about one day's length. */
  memberDay: boolean
}

/** "h:mm:ss" (hours may run past two digits) to seconds; null for anything else, such as "-". */
export function hmsToSeconds(text: string): number | null {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(text.trim())
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

const hours = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)} h`
const percent = (share: number) => `${Math.round(share * 100)}%`

export function evaluateRowFlags(m: RowMetrics, ctx: FlagContext): RowFlags {
  const found: { severity: Severity; reason: string; cols: string[] }[] = []

  const sample = m.activeHours + m.idleHours
  if (sample >= RISK_RULES.idle.minSampleHours) {
    const share = m.idleHours / sample
    if (share >= RISK_RULES.idle.criticalShare) {
      found.push({ severity: "critical", reason: `High idle time: ${percent(share)} of tracked time`, cols: ["idle_pct", "idle_hr", "activity_pct"] })
    } else if (share >= RISK_RULES.idle.warningShare) {
      found.push({ severity: "warning", reason: `Elevated idle time: ${percent(share)} of tracked time`, cols: ["idle_pct", "idle_hr", "activity_pct"] })
    }
  }

  if (ctx.memberDay) {
    const day = m.activeHours + m.manualHours
    if (day >= RISK_RULES.longDay.criticalHours) {
      found.push({ severity: "critical", reason: `Very long day: ${hours(day)}`, cols: ["total_hours", "regular_hours"] })
    } else if (day >= RISK_RULES.longDay.warningHours) {
      found.push({ severity: "warning", reason: `Long day: ${hours(day)}`, cols: ["total_hours", "regular_hours"] })
    }
  }

  const all = m.activeHours + m.manualHours
  if (m.manualHours >= RISK_RULES.manual.minManualHours && all > 0 && m.manualHours / all >= RISK_RULES.manual.reviewShare) {
    found.push({ severity: "review", reason: `Mostly manual time: ${percent(m.manualHours / all)} of hours (${hours(m.manualHours)})`, cols: ["manual_hours"] })
  }

  found.sort((a, b) => RANK[b.severity] - RANK[a.severity])
  const cells: Record<string, Severity> = {}
  for (const f of found) for (const c of f.cols) cells[c] = worstSeverity(cells[c] ?? "none", f.severity)
  return {
    severity: found.reduce<Severity>((worst, f) => worstSeverity(worst, f.severity), "none"),
    reasons: found.map((f) => f.reason),
    cells,
  }
}

/** What each colour means, worded from the thresholds above - the workbook's legend. */
export function describeRiskRules(): { severity: Severity; label: string; text: string }[] {
  const { idle, longDay, manual } = RISK_RULES
  return [
    {
      severity: "critical",
      label: "Critical",
      text: `Idle time is ${percent(idle.criticalShare)} or more of tracked time, or one member's day reaches ${longDay.criticalHours} h. The whole row is shaded red.`,
    },
    {
      severity: "warning",
      label: "Warning",
      text: `Idle time is ${percent(idle.warningShare)} or more of tracked time, or one member's day reaches ${longDay.warningHours} h. The whole row is shaded amber.`,
    },
    {
      severity: "review",
      label: "Review",
      text: `Manual time is ${percent(manual.reviewShare)} or more of the hours (and at least ${manual.minManualHours} h). Only the manual-hours cell is marked.`,
    },
    {
      severity: "none",
      label: "Not judged",
      text: `Idle time is only judged once ${idle.minSampleHours} h or more has been tracked, so a short session is never flagged.`,
    },
  ]
}
