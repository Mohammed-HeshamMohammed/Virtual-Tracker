/**
 * Who on a project can actually clock in, given the Management tab's rules.
 *
 * Budget and member-limit figures are about tracked time, so they must count
 * the people who can track - not everyone listed on the project:
 *  - viewers never track;
 *  - users always can;
 *  - managers can only while "Allow managers to record time" is on and, when
 *    "Only specific managers can clock in" is on, only the ones ticked.
 *
 * Mirrors `Dashboard-Backend/src/modules/projects/project-trackers.js`, which
 * applies the same rule to the saved budget target.
 */

export type TrackerRules = {
  managers: readonly string[]
  users: readonly string[]
  viewers?: readonly string[]
  allowProjectTracking: boolean
  restrictManagerTracking: boolean
  trackingAllowedManagerIds: readonly string[]
}

/** Managers who may clock in under the current rules. */
export function trackingManagerIds(rules: TrackerRules): string[] {
  if (!rules.allowProjectTracking) return []
  if (!rules.restrictManagerTracking) return [...new Set(rules.managers)]
  const allowed = new Set(rules.trackingAllowedManagerIds)
  return [...new Set(rules.managers)].filter((id) => allowed.has(id))
}

/** Everyone who can clock in: the project's users plus its permitted managers. */
export function projectTrackerIds(rules: TrackerRules): string[] {
  return [...new Set([...rules.users, ...trackingManagerIds(rules)])]
}

/** People on the project (managers, users, viewers) who cannot clock in. */
export function nonTrackerIds(rules: TrackerRules): string[] {
  const trackers = new Set(projectTrackerIds(rules))
  return [...new Set([...rules.managers, ...rules.users, ...(rules.viewers ?? [])])].filter((id) => !trackers.has(id))
}
