import { apiPath } from "@/infrastructure/api/path"
import { fetchJsonWithRetry } from "@/infrastructure/api/http"

/** The most idle time allowed - see Dashboard-Backend/src/modules/projects/idle-time.js. */
export type IdleTimeLimit = {
  maxSeconds: number
  /** Which of the budget or the member's own limit decided, or neither could. */
  source: "budget" | "member_limit" | "fallback"
  basis:
    | "hours_budget"
    | "rate_estimate"
    | "member_limit_hours"
    | "member_limit_rate"
    | "no_rate"
    | "no_budget"
  /** The budget in hours (converted at the rate for a money budget). */
  budgetHours: number | null
  /** The member's own limit in hours. */
  memberLimitHours: number | null
  perPerson: boolean
  /** Which rate converted money into hours. */
  rateBasis: "pay" | "bill" | null
}

export type MemberIdleTimeLimit = IdleTimeLimit & { memberId: string }

/** The project's figure, plus each member's own. */
export type IdleTimeLimits = IdleTimeLimit & { members: MemberIdleTimeLimit[] }

export type IdleTimeLimitRequest = {
  budget: { type: string; basedOn: string; scope: string; total: number } | null
  memberIds: string[]
  clientIds: string[]
  memberLimits: { memberId: string; type: string; basedOn: string; cost: number; startDate: string }[]
}

export async function fetchIdleTimeLimit(request: IdleTimeLimitRequest): Promise<IdleTimeLimits> {
  const { res, json } = await fetchJsonWithRetry<{ success?: boolean; data?: IdleTimeLimits; error?: string }>(
    apiPath("/api/projects/idle-time-limit"),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
  )
  if (!res.ok || !json?.success || !json.data) {
    throw new Error(json?.error || `Failed to load the idle time limit (${res.status})`)
  }
  return { ...json.data, members: Array.isArray(json.data.members) ? json.data.members : [] }
}
