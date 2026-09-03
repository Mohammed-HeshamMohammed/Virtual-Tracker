

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
    requiresTask: false,
    forcesHours: false,
    billable: true,
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
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  internal: {
    label: "Internal",
    hasTasks: true,
    requiresTask: false,
    forcesHours: true,
    billable: false,
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  support: {
    label: "Support",
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
    hasTasks: true,
    requiresTask: false,
    forcesHours: true,
    billable: true,
    defaultResets: "Never",
    membersRoleFilter: "manager_and_above",
    hasSubProjects: true,
  },
};

export const PROJECT_TYPES = Object.keys(PROJECT_TYPE_DEFS);

export function projectTypeDef(type) {
  return PROJECT_TYPE_DEFS[String(type || "normal").trim().toLowerCase()] ?? PROJECT_TYPE_DEFS.normal;
}

export function isTaskLessProjectType(type) {
  return !projectTypeDef(type).hasTasks;
}

export function projectTypeForcesHours(type) {
  return projectTypeDef(type).forcesHours;
}

export function projectTypeHasSubProjects(type) {
  return projectTypeDef(type).hasSubProjects;
}

export function projectTypeMembersRoleFilter(type) {
  return projectTypeDef(type).membersRoleFilter;
}
