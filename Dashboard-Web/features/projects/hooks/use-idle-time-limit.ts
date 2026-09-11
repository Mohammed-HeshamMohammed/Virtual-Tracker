"use client"

import { useEffect, useState } from "react"
import {
  fetchIdleTimeLimit,
  type IdleTimeLimits,
  type MemberIdleTimeLimit,
} from "@/features/projects/api/idle-time-limit-api"
import { formatMinutesAsDuration } from "@/shared/utils/hours-minutes"

export type IdleTimeLimitInput = {
  budgetType: string
  budgetBasedOn: string
  budgetScope: string
  budgetTotal: string
  memberIds: string[]
  clientIds: string[]
  /** Each member's own limit on the project, as the form holds them. */
  memberLimits: { memberId: string; type: string; basedOn: string; cost: string; startDate: string }[]
}

type LimitRow = [memberId: string, type: string, basedOn: string, cost: string, startDate: string]
type Request = [
  type: string,
  basedOn: string,
  scope: string,
  total: string,
  memberIds: string[],
  clientIds: string[],
  memberLimits: LimitRow[],
]

/**
 * The idle time limits for the budget, members, client and member limits
 * being edited - all saved together with the idle time. Null until the first
 * answer arrives (or if it can't be loaded); the backend applies the limits
 * when tracking regardless.
 */
export function useIdleTimeLimit(input: IdleTimeLimitInput, enabled: boolean): IdleTimeLimits | null {
  const request: Request = [
    input.budgetType.trim(),
    input.budgetBasedOn,
    input.budgetScope,
    input.budgetTotal.trim(),
    [...new Set(input.memberIds)].sort(),
    [...new Set(input.clientIds)].sort(),
    input.memberLimits
      .map((limit): LimitRow => [limit.memberId, limit.type, limit.basedOn, String(limit.cost ?? "").trim(), limit.startDate ?? ""])
      .sort((a, b) => a[0].localeCompare(b[0])),
  ]
  const key = JSON.stringify(request)
  const [limits, setLimits] = useState<IdleTimeLimits | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const [type, basedOn, scope, total, memberIds, clientIds, memberLimits] = JSON.parse(key) as Request
    // Wait for typing to settle rather than asking on every keystroke.
    const timer = window.setTimeout(() => {
      fetchIdleTimeLimit({
        budget: type ? { type, basedOn, scope, total: Number(total) || 0 } : null,
        memberIds,
        clientIds,
        memberLimits: memberLimits.map(([memberId, limitType, limitBasedOn, cost, startDate]) => ({
          memberId,
          type: limitType,
          basedOn: limitBasedOn,
          cost: Number(cost) || 0,
          startDate,
        })),
      })
        .then((next) => {
          if (!cancelled) setLimits(next)
        })
        .catch(() => {
          if (!cancelled) setLimits(null)
        })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [key, enabled])

  return limits
}

function hours(value: number | null): string {
  return formatMinutesAsDuration((value ?? 0) * 60)
}

/** The idle time field's hint: what idle time does, and why the project's limit is what it is. */
export function describeIdleTimeLimit(limit: IdleTimeLimits | null): string {
  const base = "How long without activity before time is marked idle and the timer stops."
  if (!limit) return `${base} At least 1 minute, and never more than half the project's budget.`
  const max = formatMinutesAsDuration(limit.maxSeconds / 60)
  switch (limit.basis) {
    case "hours_budget":
      return `${base} Up to ${max}: half of the ${hours(limit.budgetHours)}${limit.perPerson ? " per person" : ""} budget.`
    case "rate_estimate":
      return `${base} Up to ${max}: half of the roughly ${hours(limit.budgetHours)} the budget buys at the highest ${
        limit.rateBasis === "pay" ? "member pay" : "client bill"
      } rate.`
    case "no_rate":
      return `${base} Up to ${max}, since there's no ${
        limit.rateBasis === "pay" ? "member pay rate" : "client bill rate"
      } yet to turn the budget into hours.`
    default:
      return `${base} Up to ${max} while the project has no budget.`
  }
}

/** Why one member's idle time is held where it is - completes "up to X, ...". */
export function describeMemberIdleLimit(limit: MemberIdleTimeLimit): string {
  const rate = limit.rateBasis === "bill" ? "the client's bill rate" : "their pay rate"
  switch (limit.basis) {
    case "member_limit_hours":
      return `half their ${hours(limit.memberLimitHours)} limit on this project`
    case "member_limit_rate":
      return `half of the roughly ${hours(limit.memberLimitHours)} their limit buys at ${rate}`
    case "rate_estimate":
      return `half of the roughly ${hours(limit.budgetHours)} the budget buys at ${rate}`
    case "hours_budget":
      return `half of the ${hours(limit.budgetHours)}${limit.perPerson ? " per person" : ""} budget`
    case "no_rate":
      return `there's no ${limit.rateBasis === "bill" ? "client bill rate" : "pay rate"} for them yet to turn the budget into hours`
    default:
      return "the project has no budget"
  }
}
