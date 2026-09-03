import { ReactNode } from "react"
import { createElement as h } from "react"


export const MEMBERS = [
  { id: 1, name: "Bella Jeffery",  initials: "BJ", color: "bg-sky-400" },
  { id: 2, name: "Joe Abraham",    initials: "JA", color: "bg-violet-500" },
  { id: 3, name: "Mahmoud Emad",   initials: "ME", color: "bg-sky-400" },
  { id: 4, name: "Mazen Salah",    initials: "MS", color: "bg-sky-400" },
]


export const LINE_ITEMS_OPTIONS = [
  "By user, project, and date",
  "By project and date",
  "By user and project",
  "By user, to-do, and date",
  "By to-do and date",
  "By user and to-do",
  "By user and date",
  "By user",
  "By project",
  "By to-do",
  "By date",
]

export const FREQUENCY_OPTIONS = ["Monthly", "Bi-weekly", "Weekly"]

export const BILLING_TABS = [
  { k: "info",          l: "Billing Information"   },
  { k: "invoices",      l: "Subscription Invoices" },
  { k: "settings",      l: "Subscription Settings" },
  { k: "clientinvoice", l: "Client Invoice"        },
] as const

export type BillingTab = "info" | "invoices" | "settings" | "clientinvoice"

export const ADD_ONS = [
  {
    name: "More screenshots",
    badge: "MORE SCREENSHOTS",
    price: "$3",
    per: "/ seat / month",
    active: false,
    free: false,
    colSpan: "lg:col-span-3",
    headline: "Main features",
    headlineUnderPrice: true,
    features: [
      "Allow up to 10 screenshots every 10 minutes for team members",
      "Includes all secondary monitors in use",
    ],
    cta: "Add add-on",
  },
  {
    name: "Insights",
    badge: "INSIGHTS",
    price: "$3",
    per: "/ seat / month",
    active: false,
    free: false,
    colSpan: "lg:col-span-5",
    headline: "Hubstaff's workforce analytics solution:",
    priceInHeader: true,
    featuresColumns: 2,
    features: [
      "Unusual activity detection",
      "Unproductive apps & URLs",
      "Team leaderboard",
      "Smart notifications",
      "Focus & meeting time",
      "Core, non-core and unproductive work",
    ],
    cta: "Add add-on",
  },
  {
    name: "Locations",
    badge: "LOCATIONS",
    price: "$4",
    per: "/ seat / month",
    active: false,
    free: false,
    colSpan: "lg:col-span-4",
    headline: "Main features",
    features: [
      "Location tracking on mobile",
      "Job sites with geofences",
      "Work orders",
      "Jobs",
    ],
    cta: "Add add-on",
  },
  {
    name: "Tasks",
    badge: "TASKS",
    price: null,
    per: null,
    active: true,
    free: true,
    colSpan: "lg:col-span-4",
    headline: "Main features",
    featuresColumns: 2,
    features: ["Kanban", "Timeline", "Comments", "Start/Due Dates", "Attachments"],
    cta: "Remove add-on",
    ctaOutline: true,
  },
  {
    name: "Silent app",
    badge: "SILENT APP",
    price: "$3",
    per: "/ seat / month",
    active: false,
    free: false,
    colSpan: "lg:col-span-5",
    headline: "Main features",
    features: [
      "Track time and activity in the background on company-owned devices.",
      "Auto start/stop time tracking policies.",
    ],
    cta: "Try it for free",
    extra: "Learn more",
  },
  {
    name: "Data retention",
    badge: "DATA RETENTION",
    price: "$2",
    per: "/ seat / month",
    active: false,
    free: false,
    colSpan: "lg:col-span-3",
    headline: "Main features",
    features: [
      "This add-on extends data retention within Hubstaff from 3 to 6 years.",
    ],
    extra: "View the list of included data",
    cta: "Add add-on",
  },
] as const

export type AddOn = {
  name: string
  badge: string
  price: string | null
  per: string | null
  active: boolean
  free: boolean
  colSpan: string
  headline: string
  headlineUnderPrice?: boolean
  priceInHeader?: boolean
  featuresColumns?: number
  features: readonly string[]
  cta: string
  ctaOutline?: boolean
  extra?: string
}

export const BANKS = [
  { name: "Chase",             color: "#117ACA", letter: "C" },
  { name: "Mercury",           color: "#6B7280", letter: "M" },
  { name: "USAA Bank",         color: "#003087", letter: "U" },
  { name: "Bank of America",   color: "#E31837", letter: "B" },
  { name: "Navy Federal Cre.", color: "#002868", letter: "N" },
  { name: "E*TRADE",           color: "#6F2DA8", letter: "E" },
  { name: "Netspend",          color: "#F97316", letter: "N" },
  { name: "Wells Fargo",       color: "#CC0000", letter: "W" },
  { name: "Capital One",       color: "#D22730", letter: "C" },
  { name: "Santander Bank",    color: "#EA1A1A", letter: "S" },
  { name: "US Bank",           color: "#CC0000", letter: "U" },
  { name: "PNC Bank",          color: "#F58220", letter: "P" },
]

export const SAVED_CARDS = [
  { id: "1", type: "Card", last4: "9956", brand: "Visa",       expiry: "08/26", default: true  },
  { id: "2", type: "Card", last4: "4242", brand: "Mastercard", expiry: "12/27", default: false },
  { id: "3", type: "Card", last4: "1234", brand: "Amex",       expiry: "03/25", default: false },
]

export const SUB_INVOICES = [
  { id: "s1",  amount: "$48.00",  currency: "USD", status: "Upcoming", number: "98194A40-0018", transaction: "",             description: "Team — Monthly", due: "Apr 9, 2026",  created: "Apr 9, 2026"  },
  { id: "s2",  amount: "$108.00", currency: "USD", status: "Paid",     number: "98194A40-0017", transaction: "Mar 16, 2026", description: "Team — Monthly", due: "Mar 9, 2026",  created: "Mar 9, 2026"  },
  { id: "s3",  amount: "$180.00", currency: "USD", status: "Paid",     number: "98194A40-0016", transaction: "Feb 9, 2026",  description: "Team — Monthly", due: "Feb 9, 2026",  created: "Feb 9, 2026"  },
  { id: "s4",  amount: "$180.00", currency: "USD", status: "Paid",     number: "98194A40-0015", transaction: "Jan 9, 2026",  description: "Team — Monthly", due: "Jan 9, 2026",  created: "Jan 9, 2026"  },
  { id: "s5",  amount: "$180.00", currency: "USD", status: "Paid",     number: "98194A40-0014", transaction: "Dec 9, 2025", description: "Team — Monthly", due: "Dec 9, 2025",  created: "Dec 9, 2025"  },
  { id: "s6",  amount: "$180.00", currency: "USD", status: "Paid",     number: "98194A40-0013", transaction: "Nov 9, 2025", description: "Team — Monthly", due: "Nov 9, 2025",  created: "Nov 9, 2025"  },
  { id: "s7",  amount: "$180.00", currency: "USD", status: "Paid",     number: "98194A40-0012", transaction: "Oct 9, 2025", description: "Team — Monthly", due: "Oct 9, 2025",  created: "Oct 9, 2025"  },
  { id: "s8",  amount: "$180.00", currency: "USD", status: "Paid",     number: "98194A40-0011", transaction: "Sep 9, 2025", description: "Team — Monthly", due: "Sep 9, 2025",  created: "Sep 9, 2025"  },
  { id: "s9",  amount: "$180.00", currency: "USD", status: "Paid",     number: "98194A40-0010", transaction: "Aug 9, 2025", description: "Team — Monthly", due: "Aug 9, 2025",  created: "Aug 9, 2025"  },
  { id: "s10", amount: "$180.00", currency: "USD", status: "Paid",     number: "98194A40-0009", transaction: "Jul 9, 2025",  description: "Team — Monthly", due: "Jul 9, 2025",  created: "Jul 9, 2025"  },
  { id: "s11", amount: "$36.00",  currency: "USD", status: "Paid",     number: "98194A40-0008", transaction: "Jun 10, 2025", description: "Team — Monthly", due: "Jun 9, 2025",  created: "Jun 9, 2025"  },
]

export const BILLING_INVOICES_PAGE_SIZE = 10

export const COUNTRIES = [
  "United States of America",
  "United Kingdom of Great Britain and Northern Ireland",
  "Canada",
  "Afghanistan",
  "Albania",
  "Algeria",
  "Egypt",
  "France",
  "Germany",
  "Australia",
  "Brazil",
  "India",
  "Japan",
]

export const TAX_IDS = [
  "United States (US EIN)",
  "United Kingdom (GB VAT)",
  "Canada (CA BN)",
  "Andorra (AD NRT)",
  "Argentina (AR CUIT)",
  "Australia (AU ABN)",
  "Brazil (BR CNPJ)",
]

export const FREE_FEATURES = [
  "Time tracking",
  "Timesheets",
  "Activity levels",
  "Clients & Invoices",
  "Limited screenshots",
  "Limited reports",
  "Limited payments",
  "Limited support SLA",
]

export const CYCLE_OPTIONS: { k: "monthly" | "quarterly" | "yearly"; label: string; badge?: string }[] = [
  { k: "monthly",   label: "Monthly" },
  { k: "quarterly", label: "Quarterly", badge: "Save 15%" },
  { k: "yearly",    label: "Yearly",    badge: "Save 30%" },
]

export interface Plan {
  name: string
  monthlyPrice: number
  quarterlyPrice: number
  yearlyPrice: number
  note: string
  includesLabel: string
  highlight: string[]
  addons: string[]
  support: string[]
  cta: string
  borderColor: string
  isPopular: boolean
}

export interface Addon {
  id: number
  name: string
  icon: ReactNode
  smallIcon: ReactNode
  pricePerSeat: number
  features: string[]
  tooltip: string
}

export const PLANS: Plan[] = [
  {
    name: "Starter",
    monthlyPrice: 7,
    quarterlyPrice: 6,
    yearlyPrice: 5,
    note: "2 seat minimum",
    includesLabel: "Includes:",
    highlight: [
      "Time tracking",
      "Timesheets",
      "Activity levels",
      "Limited screenshots",
      "Limited app & URL tracking",
      "Limited reports",
      "Limited payments",
      "Clients & Invoices",
    ],
    addons: [],
    support: ["Two-day email support SLA"],
    cta: "Choose Starter plan",
    borderColor: "border-slate-200",
    isPopular: false,
  },
  {
    name: "Grow",
    monthlyPrice: 9,
    quarterlyPrice: 7.65,
    yearlyPrice: 6.3,
    note: "2 seat minimum",
    includesLabel: "All Starter features, plus:",
    highlight: [
      "Reports",
      "1 integration",
      "Idle timeout",
      "Project budgets",
      "Payments & invoicing",
    ],
    addons: ["Tasks"],
    support: ["One-day email support SLA"],
    cta: "Choose Grow plan",
    borderColor: "border-slate-200",
    isPopular: false,
  },
  {
    name: "Team",
    monthlyPrice: 12,
    quarterlyPrice: 10.2,
    yearlyPrice: 8.4,
    note: "2 seat minimum",
    includesLabel: "All Grow features, plus:",
    highlight: [
      "Unlimited screenshots",
      "Unlimited app & URL tracking",
      "Unlimited integrations",
      "Scheduling & attendance",
      "Custom reports",
    ],
    addons: ["Insights", "Tasks"],
    support: ["Same-day email support SLA"],
    cta: "Choose Team plan",
    borderColor: "border-blue-400",
    isPopular: true,
  },
  {
    name: "Enterprise",
    monthlyPrice: 25,
    quarterlyPrice: 21.25,
    yearlyPrice: 17.5,
    note: "Billed annually",
    includesLabel: "All Team features, plus:",
    highlight: [
      "HIPAA compliance",
      "SOC-2 Type II compliance",
      "Single sign-on",
      "Enterprise deployment",
      "Dedicated support",
      "SLA guarantees",
    ],
    addons: ["Locations", "Insights", "Tasks", "Silent app"],
    support: ["Concierge setup", "Assigned account rep", "Two-hour email support SLA"],
    cta: "Let's talk",
    borderColor: "border-slate-200",
    isPopular: false,
  },
]

const svg = (size: "sm" | "lg", children: ReactNode) =>
  h("svg", { viewBox: "0 0 32 32", className: size === "sm" ? "w-4 h-4 shrink-0" : "w-8 h-8", fill: "none" }, children)

const insightsPaths = [
  h("path",   { key: "p",  d: "M8 24l6-8 4 4 6-10", stroke: "#3b82f6", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round" }),
  h("circle", { key: "c1", cx: "8",  cy: "24", r: "2", fill: "#3b82f6" }),
  h("circle", { key: "c2", cx: "14", cy: "16", r: "2", fill: "#3b82f6" }),
  h("circle", { key: "c3", cx: "18", cy: "20", r: "2", fill: "#3b82f6" }),
  h("circle", { key: "c4", cx: "24", cy: "10", r: "2", fill: "#3b82f6" }),
]

const silentPaths = [
  h("rect",   { key: "r", x: "6", y: "10", width: "20", height: "14", rx: "3", stroke: "#3b82f6", strokeWidth: "2" }),
  h("path",   { key: "p", d: "M11 10V8a5 5 0 0110 0v2", stroke: "#3b82f6", strokeWidth: "2", strokeLinecap: "round" }),
  h("circle", { key: "c", cx: "16", cy: "17", r: "2", fill: "#3b82f6" }),
]

const tasksPaths = [
  h("path",   { key: "p",  d: "M8 10h16M8 16h10M8 22h12", stroke: "#10b981", strokeWidth: "2.5", strokeLinecap: "round" }),
  h("circle", { key: "c",  cx: "24", cy: "22", r: "4", fill: "#10b981" }),
  h("path",   { key: "p2", d: "M22 22l1.5 1.5L26 20", stroke: "white", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }),
]

const locationsPaths = [
  h("path",   { key: "p", d: "M16 4C11.6 4 8 7.6 8 12c0 6 8 16 8 16s8-10 8-16c0-4.4-3.6-8-8-8z", stroke: "#3b82f6", strokeWidth: "2" }),
  h("circle", { key: "c", cx: "16", cy: "12", r: "3", stroke: "#3b82f6", strokeWidth: "2" }),
]

const screenshotPaths = [
  h("rect",   { key: "r", x: "4", y: "8", width: "24", height: "18", rx: "3", stroke: "#3b82f6", strokeWidth: "2" }),
  h("circle", { key: "c", cx: "16", cy: "17", r: "4", stroke: "#3b82f6", strokeWidth: "2" }),
  h("path",   { key: "p", d: "M12 8l2-3h4l2 3", stroke: "#3b82f6", strokeWidth: "2", strokeLinejoin: "round" }),
]

const retentionPaths = [
  h("ellipse", { key: "e",  cx: "16", cy: "10", rx: "10", ry: "4", stroke: "#3b82f6", strokeWidth: "2" }),
  h("path",    { key: "p1", d: "M6 10v12c0 2.2 4.5 4 10 4s10-1.8 10-4V10", stroke: "#3b82f6", strokeWidth: "2" }),
  h("path",    { key: "p2", d: "M6 16c0 2.2 4.5 4 10 4s10-1.8 10-4", stroke: "#3b82f6", strokeWidth: "2" }),
]

export const ADDONS: Addon[] = [
  {
    id: 1,
    name: "Insights",
    icon: svg("lg", insightsPaths),
    smallIcon: svg("sm", insightsPaths),
    pricePerSeat: 2.5,
    tooltip: "Level up your team's productivity by using the included Hubstaff Insights add-on. You can view and compare activity, create automated notifications about your team's behavior and work patterns, and even know if any unusual activity is going on during work hours.\n\nThe Team plan includes a 3-month trial for orgs new to Insights.",
    features: [
      "Unusual activity detection",
      "Unproductive apps & URLs",
      "Team leaderboard",
      "Smart notifications",
      "Focus & meeting time",
      "Core, non-core and unproductive work",
    ],
  },
  {
    id: 2,
    name: "Silent app",
    icon: svg("lg", silentPaths),
    smallIcon: svg("sm", silentPaths),
    pricePerSeat: 2.5,
    tooltip: "Track time and activity in the background on company-owned devices. Auto start/stop time tracking policies.",
    features: [
      "Track time and activity in the background on company-owned devices",
      "Auto start/stop time tracking policies",
    ],
  },
  {
    id: 3,
    name: "Tasks",
    icon: svg("lg", tasksPaths),
    smallIcon: svg("sm", tasksPaths),
    pricePerSeat: 2.5,
    tooltip: "Finish big jobs faster, enhance team collaboration, and get things done more quickly with our included task management tool, Hubstaff Tasks. With Kanban boards, automated check-ins, and customizable templates, meeting deadlines and keeping work organized is easier than ever.",
    features: [
      "Kanban view",
      "Timeline view",
      "Task comments",
      "Start / Due dates",
      "Labels and attachments",
    ],
  },
  {
    id: 4,
    name: "More screenshots",
    icon: svg("lg", screenshotPaths),
    smallIcon: svg("sm", screenshotPaths),
    pricePerSeat: 2.5,
    tooltip: "Allow up to 10 screenshots every 10 minutes for team members, including all secondary monitors in use.",
    features: [
      "Allow up to 10 screenshots every 10 minutes for team members",
      "Includes all secondary monitors in use",
    ],
  },
  {
    id: 5,
    name: "Data retention",
    icon: svg("lg", retentionPaths),
    smallIcon: svg("sm", retentionPaths),
    pricePerSeat: 1.67,
    tooltip: "Extend your data retention to 6 years across time & activity data, calendar & limits, and finances.",
    features: [
      "Data retention extended to 6 years",
      "Time & activity data",
      "Calendar & limits",
      "Finances",
    ],
  },
  {
    id: 6,
    name: "Locations",
    icon: svg("lg", locationsPaths),
    smallIcon: svg("sm", locationsPaths),
    pricePerSeat: 3.33,
    tooltip: "Field-based teams everywhere will save time and money with our included Locations features. With GPS time and location tracking, work orders, and geofencing features, crews can spend more time at job sites and less time on paperwork.",
    features: [
      "Location tracking on mobile",
      "Job sites with geofences",
      "Work orders",
      "Jobs",
    ],
  },
]


export const ALERT_OPTIONS = ["Both", "Management", "User", "No one"] as const
export type AlertOption = typeof ALERT_OPTIONS[number]

export const GRACE_OPTIONS = ["5 min", "10 min", "15 min", "20 min", "30 min"] as const
export type GraceOption = typeof GRACE_OPTIONS[number]

export type ScheduleKey = "calendartype" | "shiftalerts" | "graceperiod"

export const SCHEDULE_SUBNAV: { k: ScheduleKey; l: string }[] = [
  { k: "calendartype", l: "Calendar type"  },
  { k: "shiftalerts",  l: "Shift alerts"   },
  { k: "graceperiod",  l: "Grace period"   },
] as const


export const MEMBERS_TABS = [
  { k: "custom" as const,       l: "Custom Fields"    },
  { k: "worklimits" as const,   l: "Work Time Limits" },
  { k: "payments" as const,     l: "Payments"         },
]

export type MembersTabKey = "custom" | "worklimits" | "payments"

export const CUSTOM_FIELDS_SUBNAV = [
  { k: "profile" as const, l: "Profile fields"      },
  { k: "email" as const,   l: "Email notifications" },
]

export type CustomFieldsTabKey = "profile" | "email"

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
export const DEFAULT_ACTIVE_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
export const DEFAULT_EXPECTED_HRS = "40"


export const INDUSTRIES = ["Technology", "Design", "Marketing", "Finance", "Healthcare"]

export const CURRENCIES = [
  "USD - United States Dollar",
  "EUR - Euro",
  "GBP - British Pound",
]

export const WEEK_STARTS = ["Monday", "Sunday"]

export const TIME_ZONES = [
  "(GMT-10:00) America/Adak",
  "(GMT-09:00) America/Anchorage",
  "(GMT-09:00) America/Juneau",
  "(GMT-09:00) America/Metlakatla",
  "(GMT-09:00) America/Nome",
  "(GMT-09:00) America/Sitka",
  "(GMT-09:00) America/Yakutat",
  "(GMT-08:00) America/Los_Angeles",
  "(GMT-08:00) America/Metlakatla",
  "(GMT-08:00) America/Santa_Isabel",
  "(GMT-07:00) America/Boise",
  "(GMT-07:00) America/Cambridge_Bay",
  "(GMT-07:00) America/Chihuahua",
  "(GMT-07:00) America/Creston",
  "(GMT-07:00) America/Dawson_Creek",
  "(GMT-07:00) America/Denver",
  "(GMT-07:00) America/Edmonton",
  "(GMT-07:00) America/Hermosillo",
  "(GMT-07:00) America/Inuvik",
  "(GMT-07:00) America/Mazatlan",
  "(GMT-07:00) America/Ojinaga",
  "(GMT-07:00) America/Phoenix",
  "(GMT-07:00) America/Shiprock",
  "(GMT-07:00) America/Yellowknife",
  "(GMT-06:00) America/Chicago",
  "(GMT-06:00) America/Indiana/Knox",
  "(GMT-06:00) America/Indiana/Tell_City",
  "(GMT-06:00) America/Matamoros",
  "(GMT-06:00) America/Menominee",
  "(GMT-06:00) America/North_Dakota/Beulah",
  "(GMT-06:00) America/North_Dakota/Center",
  "(GMT-06:00) America/North_Dakota/New_Salem",
  "(GMT-06:00) America/Rainy_River",
  "(GMT-06:00) America/Rankin_Inlet",
  "(GMT-06:00) America/Resolute",
  "(GMT-06:00) America/Winnipeg",
  "(GMT-05:00) America/Detroit",
  "(GMT-05:00) America/Fort_Wayne",
  "(GMT-05:00) America/Grand_Turk",
  "(GMT-05:00) America/Indiana/Indianapolis",
  "(GMT-05:00) America/Indiana/Marengo",
  "(GMT-05:00) America/Indiana/Petersburg",
  "(GMT-05:00) America/Indiana/Vevay",
  "(GMT-05:00) America/Indiana/Vincennes",
  "(GMT-05:00) America/Indiana/Winamac",
  "(GMT-05:00) America/Iqaluit",
  "(GMT-05:00) America/Kentucky/Louisville",
  "(GMT-05:00) America/Kentucky/Monticello",
  "(GMT-05:00) America/Nassau",
  "(GMT-05:00) America/New_York",
  "(GMT-05:00) America/Nipigon",
  "(GMT-05:00) America/Pangnirtung",
  "(GMT-05:00) America/Port-au-Prince",
  "(GMT-05:00) America/Thunder_Bay",
  "(GMT-05:00) America/Toronto",
  "(GMT+02:00) Africa/Cairo",
  "(GMT+03:00) Africa/Cairo (Summer)",
]

export const ROLE_TYPES = [
  { k: "admin",   l: "Admin",     info: "Full access to all features and settings" },
  { k: "manager", l: "Manager",   info: "Can manage team members and projects" },
  { k: "member",  l: "Member",    info: "Standard access to track time and activity" },
  { k: "custom",  l: "Custom role", info: null },
] as const

export const ROLE_MATRIX = [
  { group: "ORGANIZATION", groupInfo: undefined, label: "Change org level permissions (view and edit permissions tab)", values: [false, null, null, null] },
  { group: "MEMBERS",      groupInfo: undefined, label: "Invite members or create member accounts",                    values: [true, null, null, null] },
  { group: "ACTIVITY",     groupInfo: "Activity tracking info", label: "View screenshots/activity for other members", values: [true, "default", true, null] },
] as const

export const CUSTOM_PERMISSIONS = [
  "Invite team members", "Create teams", "Create projects", "Pay invoices", 
  "Manage billing", "View insights", "Approve time off request", "Send payments/payroll"
] as const

export const ORGANIZATION_TABS = [
  { k: "company" as const,     l: "Company Information" },
  { k: "security" as const,    l: "Security & Log In"   },
  { k: "projects" as const,    l: "Projects & To-Dos"   },
  { k: "permissions" as const, l: "Permissions"          },
]

export type OrganizationTabKey = "company" | "security" | "projects" | "permissions"

export const ROLE_COLS = ROLE_TYPES

export const TEAM_PERMS: { label: string; checked: boolean; notifyToggle: boolean; sub?: { label: string; toggle: boolean } }[] = [
  { label: "Approve timesheets",                          checked: true,  notifyToggle: false },
  { label: "Approve time off requests",                   checked: true,  notifyToggle: false },
  { label: "Approve & deny manual time requests",         checked: true,  notifyToggle: true  },
  { label: "Add & edit time off requests",                checked: true,  notifyToggle: false },
  { label: "View & edit schedules",                       checked: true,  notifyToggle: false },
  { label: "View screenshots & activity levels",          checked: true,  notifyToggle: false },
  { label: "View & edit payments",                         checked: false, notifyToggle: false },
  { label: "Manage financials",                           checked: false, notifyToggle: false },
]

export const ORGANIZATION_PERMISSIONS_PAGE_SIZE = 5

export const PERMISSIONS_SUBNAV = [
  { k: "role" as const, l: "Role permissions" },
  { k: "team" as const, l: "Team permissions" },
]

export type PermissionsTabKey = "role" | "team"

export const PROJECTS = [
  "Amina with Amplified", "Bana Properties", "Bella Jeffrey with Phil Special Campaign",
  "Dina with TRACI", "Haneen & Amina with Amplified", "Production Project / Josh",
  "Production with Malak", "Rowan With Andreas", "Sarah with Brandon",
  "Sarah with Jerrod", "Thoraya with Yesenia",
]

export const ROLE_OPTS = ["None", "Viewer", "User", "Manager"]
export type RoleOption = "None" | "Viewer" | "User" | "Manager"

export const BINARY_OPTS = ["Everyone", "Management Only"]
export type BinaryOption = "Everyone" | "Management Only"

export const PROJECTS_TODOS_SUBNAV = [
  { k: "role" as const,     l: "Default project role"  },
  { k: "complete" as const, l: "Complete to-dos"        },
  { k: "manage" as const,   l: "Manage to-dos"          },
]

export type ProjectsTodosTabKey = "role" | "complete" | "manage"

export const ORGANIZATION_PROJECTS_TODOS_PAGE_SIZE = 5

export const SECURITY_LOGIN_NAV = [
  { k: "sso" as const, l: "Single Sign-on & SCIM", premium: true },
  { k: "2fa" as const, l: "Two-factor authentication", premium: false },
]

export type SecurityNavKey = "sso" | "2fa"


export const POLICY_MAIN_TABS = [
  { k: "timeoff" as const, l: "Time off" },
  { k: "breaks" as const, l: "Work breaks" },
  { k: "overtime" as const, l: "Overtime" },
] as const

export type PolicyMainTabKey = (typeof POLICY_MAIN_TABS)[number]["k"]

export const TIME_OFF_SIDEBAR = [
  { k: "policies" as const, l: "Time off policies" },
  { k: "holidays" as const, l: "Holidays" },
  { k: "balances" as const, l: "Time off balances" },
] as const

export type TimeOffSidebarKey = (typeof TIME_OFF_SIDEBAR)[number]["k"]

export const ASSIGN_MEMBER_METHODS = [
  "List of members",
  "Home country and Employment type",
  "Import CSV",
] as const

export type AssignMemberMethod = (typeof ASSIGN_MEMBER_METHODS)[number]

export const EMPLOYMENT_TYPE_OPTIONS = [
  "Contractor - hourly",
  "Contractor - fixed rate",
  "Contractor - project based",
  "FTE - hourly (full-time employee)",
  "FTE - salary (full-time employee)",
  "PTE - hourly (part-time employee)",
  "PTE - salary (part-time employee)",
] as const

export const SAMPLE_COUNTRY_OPTIONS = [
  "Afghanistan",
  "Albania",
  "Algeria",
  "American Samoa",
  "Andorra",
  "Argentina",
  "Australia",
  "Brazil",
  "Canada",
  "Egypt",
  "France",
  "Germany",
  "Japan",
  "United Kingdom",
  "United States",
] as const

export const HOLIDAY_TEMPLATE_OPTIONS = [
  "Custom",
  "Christian",
  "Christmas Eve (Dec 24th)",
  "Christmas Day (Dec 25th)",
  "New Year's Day",
  "Martin Luther King Jr. Day",
  "Memorial Day",
  "Independence Day",
  "Labor Day",
  "Thanksgiving Day",
] as const

export const HOLIDAY_TEMPLATE_DEFAULT_NAMES: Record<string, string> = {
  "Christmas Eve (Dec 24th)": "Christmas Eve",
  "Christmas Day (Dec 25th)": "Christmas Day",
  "New Year's Day": "New Year's Day",
  Christian: "Christian holiday",
}

export const HOLIDAY_ASSIGN_METHOD_OPTIONS = [
  {
    value: "List of members",
    title: "List of members",
    description: "List of all members belonging to the organization",
  },
  {
    value: "Home country and Employment type",
    title: "Home country and Employment type",
    description: "Group by location and/or employment type",
  },
  {
    value: "Import CSV",
    title: "Import CSV",
    description: "Upload CSV file",
  },
] as const

const HOLIDAY_PRESET_OPTIONS = HOLIDAY_TEMPLATE_OPTIONS

export const WORK_BREAK_SIDEBAR = [
  { k: "policies" as const, l: "Work break policies" },
  { k: "notifications" as const, l: "Work break notifications" },
] as const

export type WorkBreakSidebarKey = (typeof WORK_BREAK_SIDEBAR)[number]["k"]

export const OVERTIME_SIDEBAR = [
  { k: "policies" as const, l: "Overtime policies" },
  { k: "notifications" as const, l: "Overtime notifications" },
] as const

export type OvertimeSidebarKey = (typeof OVERTIME_SIDEBAR)[number]["k"]

export const WORK_BREAK_PAID_TYPES = ["Paid", "Unpaid"] as const

export const WORK_BREAK_RESTRICTIONS = [
  "No restrictions",
  "Once per work session",
  "Allow within every few hours",
  "Allow after every few hours",
] as const

export const WORK_BREAK_NOTIFICATION_MEMBERS = [
  { id: "1", name: "Bella Jeffery", hue: "bg-blue-500" },
  { id: "2", name: "Joe Abraham", hue: "bg-blue-600" },
  { id: "3", name: "Mahmoud Emad", hue: "bg-violet-500" },
  { id: "4", name: "mazen salah", hue: "bg-blue-500" },
] as const

export const OVERTIME_WEEKLY_THRESHOLD_TOOLTIP =
  "Overtime will begin after working this many hours per week in organization's time zone"

export const OVERTIME_NOTIFICATIONS_SECTION_TOOLTIP =
  "Individuals who do not wish to receive these can unsubscribe at the bottom of the email"

export const OVERTIME_POLICY_MEMBER_OPTIONS = [
  "All members",
  ...WORK_BREAK_NOTIFICATION_MEMBERS.map(m => m.name),
] as const
