// The single definition of what a project type MEANS. Before this, "calling"
// was hardcoded at a dozen call sites and conflated two independent things -
// "has no tasks" and "must use an Hours based budget" - which made adding a
// type a scavenger hunt for `=== "calling"` comparisons.
//
// A type is a preset over four axes:
//   hasTasks        - whether the project has a task list at all. false means
//                     the timer runs against the project itself (the desktop
//                     tracker hides its task picker entirely).
//   requiresTask    - whether a timer may only start with a task selected.
//                     Meaningless when hasTasks is false; always false there.
//   forcesHours     - whether a Cost based budget is rejected. True wherever
//                     there is no coherent rate anchor: no tasks to price, or
//                     non-billable work that has no rate at all.
//   billable        - default only; editable per project on the General tab.
//   defaultResets   - default only; editable on the Budget Limits tab.
//   membersRoleFilter - restricts who may be assigned at all. null = anyone.
//   hasSubProjects  - whether the project can group other projects beneath
//                     it, rolling their managers up into its own member list.
//
// requiresTask and billable are DEFAULTS seeded into the create form. hasTasks
// and forcesHours are INVARIANTS of the type and are enforced server-side.

/** @typedef {{ hasTasks: boolean, requiresTask: boolean, forcesHours: boolean, billable: boolean, defaultResets: string, label: string, membersRoleFilter: string | null, hasSubProjects: boolean }} ProjectTypeDef */

/** @type {Record<string, ProjectTypeDef>} */
export const PROJECT_TYPE_DEFS = {
  normal: {
    label: "Normal project",
    hasTasks: true,
    requiresTask: true,
    forcesHours: false,
    billable: true,
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  calling: {
    label: "Calling",
    hasTasks: false,
    requiresTask: false,
    forcesHours: true,
    billable: true,
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  retainer: {
    label: "Retainer",
    hasTasks: true,
    // A retainer buys a block of time, not a fixed deliverable list - tasks
    // are useful for organizing it but must not gate starting the clock.
    requiresTask: false,
    forcesHours: false,
    billable: true,
    // The whole point of a retainer: the allowance refills each month.
    defaultResets: "Monthly",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  fixed_price: {
    label: "Fixed price",
    hasTasks: true,
    requiresTask: true,
    forcesHours: false,
    billable: true,
    // The budget is the agreed contract value. Resetting it monthly would
    // silently re-grant the entire scope, so this one must not roll over.
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  internal: {
    label: "Internal",
    hasTasks: true,
    requiresTask: false,
    // Non-billable work has no rate to multiply against, so a Cost based
    // budget would compute a $0 spend forever and never stop anything.
    forcesHours: true,
    billable: false,
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  support: {
    label: "Support",
    // Reactive ticket work: same shape as calling - the timer runs against
    // the project, there is no task list to pick from.
    hasTasks: false,
    requiresTask: false,
    forcesHours: true,
    billable: true,
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  management: {
    label: "Management",
    // Oversight work: coordination time is real and worth tracking, but it
    // is not organized as a deliverable list, so a task is never required.
    hasTasks: true,
    requiresTask: false,
    // No per-task rate anchor for coordination work - hours is the only
    // coherent denomination, same reasoning as calling/support.
    forcesHours: true,
    billable: true,
    defaultResets: "Never",
    // The whole point: a management project is where managers coordinate, so
    // employees have no place on it. Enforced server-side, not just filtered
    // in the picker.
    membersRoleFilter: "manager_and_above",
    hasSubProjects: true,
  },
};

export const PROJECT_TYPES = Object.keys(PROJECT_TYPE_DEFS);

/** Falls back to the "normal" preset for an unknown type rather than throwing -
 * read paths must stay readable even if a row predates a type being removed. */
export function projectTypeDef(type) {
  return PROJECT_TYPE_DEFS[String(type || "normal").trim().toLowerCase()] ?? PROJECT_TYPE_DEFS.normal;
}

/** True for types whose timers never have a task (calling, support). */
export function isTaskLessProjectType(type) {
  return !projectTypeDef(type).hasTasks;
}

/** True for types that reject a Cost based budget. */
export function projectTypeForcesHours(type) {
  return projectTypeDef(type).forcesHours;
}

/** True for types that can group other projects (management). */
export function projectTypeHasSubProjects(type) {
  return projectTypeDef(type).hasSubProjects;
}

/** Role filter applied to who may be assigned, or null when anyone may be. */
export function projectTypeMembersRoleFilter(type) {
  return projectTypeDef(type).membersRoleFilter;
}
