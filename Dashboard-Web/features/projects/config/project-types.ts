import {
  ListChecks,
  PhoneCall,
  RefreshCw,
  FileCheck2,
  Building2,
  LifeBuoy,
  Network,
  type LucideIcon,
} from "lucide-react"

export type ProjectTypeDef = {
  value: ProjectType
  label: string
  blurb: string
  hover: string
  Icon: LucideIcon
  hasTasks: boolean
  requiresTask: boolean
  forcesHours: boolean
  billable: boolean
  defaultResets: string
  membersRoleFilter: "manager_and_above" | null
  hasSubProjects: boolean
}

export type ProjectType =
  | "normal"
  | "calling"
  | "retainer"
  | "fixed_price"
  | "internal"
  | "support"
  | "management"

export const PROJECT_TYPE_DEFS: ProjectTypeDef[] = [
  {
    value: "normal",
    label: "Normal project",
    blurb: "Work is broken into tasks",
    hover: "Tasks are used to indicate performance",
    Icon: ListChecks,
    hasTasks: true,
    requiresTask: true,
    forcesHours: false,
    billable: true,
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  {
    value: "calling",
    label: "Calling",
    blurb: "No tasks — members time their own calls",
    hover: "No tasks needed — each assigned member starts their own timer",
    Icon: PhoneCall,
    hasTasks: false,
    requiresTask: false,
    forcesHours: true,
    billable: true,
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  {
    value: "retainer",
    label: "Retainer",
    blurb: "A block of time that refills every month",
    hover: "Tasks optional — the budget resets monthly rather than running out once",
    Icon: RefreshCw,
    hasTasks: true,
    requiresTask: false,
    forcesHours: false,
    billable: true,
    defaultResets: "Monthly",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  {
    value: "fixed_price",
    label: "Fixed price",
    blurb: "One agreed value for an agreed scope",
    hover: "Tasks required, and the budget never resets — spending it means the scope is spent",
    Icon: FileCheck2,
    hasTasks: true,
    requiresTask: true,
    forcesHours: false,
    billable: true,
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  {
    value: "internal",
    label: "Internal",
    blurb: "Overhead you track but never invoice",
    hover: "Non-billable, so it is measured in hours — there is no rate to bill against",
    Icon: Building2,
    hasTasks: true,
    requiresTask: false,
    forcesHours: true,
    billable: false,
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  {
    value: "support",
    label: "Support",
    blurb: "Reactive work with no fixed task list",
    hover: "Like Calling — the timer runs against the project, measured in hours",
    Icon: LifeBuoy,
    hasTasks: false,
    requiresTask: false,
    forcesHours: true,
    billable: true,
    defaultResets: "Never",
    membersRoleFilter: null,
    hasSubProjects: false,
  },
  {
    value: "management",
    label: "Management",
    blurb: "Oversees other projects and their managers",
    hover: "Managers only — link sub-projects and their managers roll up into this one automatically",
    Icon: Network,
    hasTasks: true,
    requiresTask: false,
    forcesHours: true,
    billable: true,
    defaultResets: "Never",
    membersRoleFilter: "manager_and_above",
    hasSubProjects: true,
  },
]

const BY_VALUE = new Map(PROJECT_TYPE_DEFS.map((def) => [def.value, def]))

export function projectTypeDef(type: string | null | undefined): ProjectTypeDef {
  return BY_VALUE.get(String(type ?? "").trim().toLowerCase() as ProjectType) ?? PROJECT_TYPE_DEFS[0]!
}

export function normalizeProjectType(type: string | null | undefined): ProjectType {
  return projectTypeDef(type).value
}

export function isTaskLessProjectType(type: string | null | undefined): boolean {
  return !projectTypeDef(type).hasTasks
}

export function projectTypeHasSubProjects(type: string | null | undefined): boolean {
  return projectTypeDef(type).hasSubProjects
}
