import type { MemberManageTab } from "@/features/members/models/member"

export const MAX_INVITES_PER_SUBMIT = 3
export const MEMBER_IMPORT_EXPORT_ENABLED = false
export const MEMBER_IMPORT_EXPORT_COMING_SOON_MESSAGE = "Coming soon."
export const MEMBER_COMPACT_MODAL_Z = "z-[600]"
export const PORTAL_DROPDOWN_BACKDROP_Z = "z-[601]"
export const PORTAL_DROPDOWN_MENU_Z = "z-[610]"

export const MODAL_INPUT =
  "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-400 dark:focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-emerald-500"
export const MODAL_LABEL = "mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500"
export const MODAL_INPUT_GROUP =
  "flex w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus-within:border-blue-400 dark:focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-blue-400 dark:focus-within:ring-emerald-500"
export const MODAL_INPUT_GROUP_FIELD =
  "min-w-0 flex-1 border-0 bg-transparent px-2.5 py-2 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
export const MODAL_INPUT_GROUP_SUFFIX =
  "flex shrink-0 select-none items-center border-l border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 px-3 text-xs text-slate-500 dark:text-slate-400"

export const ALL_MEMBER_COLS = [
  { key: "status", label: "Status" },
  { key: "role", label: "Role" },
  { key: "projects", label: "Projects" },
  { key: "payment", label: "Payment" },
  { key: "limits", label: "Limits" },
  { key: "date_added", label: "Date added" },
  { key: "teams", label: "Teams" },
  { key: "phone", label: "Phone" },
] as const

export const DEFAULT_MEMBER_COL_ORDER = ALL_MEMBER_COLS.map((col) => col.key)

export const DEFAULT_ENABLED_MEMBER_COLS = DEFAULT_MEMBER_COL_ORDER.filter(
  (key) =>
    key !== "phone" &&
    key !== "payment" &&
    key !== "limits" &&
    key !== "teams",
)

export const MANAGE_MODAL_TABS: { id: MemberManageTab; label: string }[] = [
  { id: "info", label: "INFO" },
  { id: "employment", label: "EMPLOYMENT" },
  { id: "roles", label: "ROLES" },
  { id: "payBill", label: "PAY / BILL" },
  { id: "workLimits", label: "WORK TIME & LIMITS" },
  { id: "settings", label: "SETTINGS" },
]

export const PAY_PERIODS = ["None", "Weekly", "Twice per month", "Bi-weekly", "Monthly"]

export const STATIC_EMPLOYMENT_TYPES = [
  "Contractor - hourly",
  "Contractor - fixed rate",
  "Contractor - project based",
  "FTE - hourly (full-time employee)",
  "FTE - salary (full-time employee)",
]
export const STATIC_EMPLOYED_THROUGH = ["Direct - hired by us", "Vendor", "EOR", "Subsidiary"]
export const STATIC_WORKPLACE_MODELS = ["In-office", "Remote", "Hybrid"]
export const STATIC_TERMINATION_REASONS = ["Voluntary", "Involuntary", "Contract ended"]
