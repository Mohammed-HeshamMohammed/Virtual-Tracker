/** The kinds of project, taken from the real Dashboard (Dashboard-Web's `project-types.ts`): a project's
 *  type decides whether it has tasks, whether tracking needs one, whether it is billable and what a
 *  budget looks like. A project made before types existed is a normal project. */
export type ProjectType = "normal" | "calling" | "retainer" | "fixed_price" | "internal" | "support" | "management";

export type ProjectTypeDef = {
  value: ProjectType;
  label: string;
  blurb: string;
  /** The longer explanation, as a tooltip. */
  hover: string;
  /** Whether the project has a task list at all. */
  hasTasks: boolean;
  /** Whether a task must be chosen before tracking can start (can be relaxed for the types where it is optional). */
  requiresTask: boolean;
  /** Time is the only thing a budget can be measured in. */
  forcesHours: boolean;
  billable: boolean;
  /** How a budget refills: "Never" means it is spent once. */
  resets: "Never" | "Weekly" | "Monthly";
  /** Whether the budget's refill can be changed. */
  resetsLocked: boolean;
  /** Only managers can be on it. */
  managersOnly: boolean;
};

export const PROJECT_TYPES: ProjectTypeDef[] = [
  { value: "normal", label: "Normal project", blurb: "Work is broken into tasks", hover: "Tasks are used to indicate performance.", hasTasks: true, requiresTask: true, forcesHours: false, billable: true, resets: "Never", resetsLocked: false, managersOnly: false },
  { value: "calling", label: "Calling", blurb: "No tasks: members time their own calls", hover: "No tasks needed. Each person starts their own timer on the project.", hasTasks: false, requiresTask: false, forcesHours: true, billable: true, resets: "Never", resetsLocked: false, managersOnly: false },
  { value: "retainer", label: "Retainer", blurb: "A block of time that refills every month", hover: "Tasks are optional. The budget resets monthly instead of running out once.", hasTasks: true, requiresTask: false, forcesHours: false, billable: true, resets: "Monthly", resetsLocked: false, managersOnly: false },
  { value: "fixed_price", label: "Fixed price", blurb: "One agreed amount for an agreed scope", hover: "Tasks are required and the budget never resets: spending it means the scope is spent.", hasTasks: true, requiresTask: true, forcesHours: false, billable: true, resets: "Never", resetsLocked: true, managersOnly: false },
  { value: "internal", label: "Internal", blurb: "Overhead you track but never invoice", hover: "Not billable, so it is measured in hours. There is no rate to bill against.", hasTasks: true, requiresTask: false, forcesHours: true, billable: false, resets: "Never", resetsLocked: false, managersOnly: false },
  { value: "support", label: "Support", blurb: "Reactive work with no fixed task list", hover: "Like Calling: the timer runs against the project and is measured in hours.", hasTasks: false, requiresTask: false, forcesHours: true, billable: true, resets: "Never", resetsLocked: false, managersOnly: false },
  { value: "management", label: "Management", blurb: "Oversees the work and the managers on it", hover: "Managers only. Hours are the measure and tasks are optional.", hasTasks: true, requiresTask: false, forcesHours: true, billable: true, resets: "Never", resetsLocked: false, managersOnly: true },
];

export const projectTypeDef = (type: string | undefined): ProjectTypeDef => PROJECT_TYPES.find((entry) => entry.value === type) ?? PROJECT_TYPES[0];
