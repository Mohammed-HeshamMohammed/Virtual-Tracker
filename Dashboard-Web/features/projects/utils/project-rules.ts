/**
 * The Management tab of the project modal, as the Projects table shows it.
 *
 * The modal saves these switches; nothing on the Projects page used to read them back, so a
 * project locked to two named managers looked identical to an open one. Everything here is
 * pure so the same summary drives the table cell, its sort, and the optimistic row after a save.
 */

export type ProjectRules = {
  /** "Allow managers to record time on this project". */
  trackingAllowed: boolean
  /** "Only specific managers can clock in". */
  restrictManagers: boolean
  managerCount: number
  /** Managers ticked in the allow-list (only meaningful while restrictManagers is on). */
  allowedManagerCount: number
  requireTask: boolean
  /** "Only managers can create tasks". */
  managersOnlyTasks: boolean
  stopNote: boolean
  clientManages: boolean
  clientClocksIn: boolean
}

export type RuleChip = {
  key: string
  label: string
  /** warn: someone is locked out of something; info: a rule is on; muted: the default. */
  tone: "warn" | "info" | "muted"
  detail: string
}

export function buildProjectRules(input: {
  allowProjectTracking: boolean
  restrictManagerTracking: boolean
  managerIds: readonly string[]
  trackingAllowedManagerIds: readonly string[]
  requireTaskToTrack: boolean
  restrictTaskCreation: boolean
  requireStopNote: boolean
  clientCanManage: boolean
  clientCanTrack: boolean
}): ProjectRules {
  const managers = new Set(input.managerIds)
  const allowed = new Set(input.trackingAllowedManagerIds.filter((id) => managers.has(id)))
  return {
    trackingAllowed: input.allowProjectTracking,
    restrictManagers: input.restrictManagerTracking,
    managerCount: managers.size,
    allowedManagerCount: allowed.size,
    requireTask: input.requireTaskToTrack,
    managersOnlyTasks: input.restrictTaskCreation,
    stopNote: input.requireStopNote,
    clientManages: input.clientCanManage,
    clientClocksIn: input.clientCanTrack,
  }
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** Chips in the order they matter: who is locked out first, then the tracking rules. */
export function describeProjectRules(rules: ProjectRules, options: { hasTasks: boolean }): RuleChip[] {
  const chips: RuleChip[] = []

  if (!rules.trackingAllowed) {
    chips.push({
      key: "clock-in",
      label: "Managers can't clock in",
      tone: "warn",
      detail: "Managers manage this project but can't record time on it.",
    })
  } else if (rules.restrictManagers) {
    if (rules.allowedManagerCount === 0) {
      chips.push({
        key: "clock-in",
        label: "No manager can clock in",
        tone: "warn",
        detail: "Clocking in is limited to chosen managers, and none are chosen.",
      })
    } else {
      chips.push({
        key: "clock-in",
        label: `${rules.allowedManagerCount} of ${rules.managerCount} ${plural(rules.managerCount, "manager", "managers")} can clock in`,
        tone: "info",
        detail: "Only the managers chosen in the Management tab can record time; the rest still manage the project.",
      })
    }
  } else if (rules.managerCount > 0) {
    chips.push({
      key: "clock-in",
      label: "All managers can clock in",
      tone: "muted",
      detail: "Every manager on this project can record time on it.",
    })
  }

  if (options.hasTasks) {
    chips.push(
      rules.requireTask
        ? { key: "task", label: "Task required", tone: "info", detail: "Members must pick a task before the timer starts." }
        : { key: "task", label: "No task needed", tone: "muted", detail: "Members can run the timer against the project itself." },
    )
    if (rules.managersOnlyTasks) {
      chips.push({
        key: "task-create",
        label: "Managers create tasks",
        tone: "info",
        detail: "Only managers can add tasks to this project.",
      })
    }
  }

  if (rules.stopNote) {
    chips.push({
      key: "stop-note",
      label: "Stop note",
      tone: "info",
      detail: "Members are asked what they worked on before the timer stops.",
    })
  }
  if (rules.clientManages) {
    chips.push({ key: "client-manage", label: "Client manages", tone: "info", detail: "The client can create and edit tasks." })
  }
  if (rules.clientClocksIn) {
    chips.push({ key: "client-clock", label: "Client clocks in", tone: "info", detail: "The client can run a timer on this project." })
  }

  return chips
}

/** Sort weight: projects with more locked-out or switched-on rules sort higher. */
export function projectRulesWeight(rules: ProjectRules | undefined, hasTasks: boolean): number {
  if (!rules) return -1
  return describeProjectRules(rules, { hasTasks }).reduce(
    (sum, chip) => sum + (chip.tone === "warn" ? 10 : chip.tone === "info" ? 1 : 0),
    0,
  )
}
