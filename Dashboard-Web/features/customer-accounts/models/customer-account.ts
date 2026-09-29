// PLAN-customer-accounts-and-tenancy.md §16.1: these two are grant types,
// not ordinary roles - exactly one member per tenant ever holds one, and
// only through the create flow below, never through the ordinary role
// dropdowns (see features/auth/permissions/role-hierarchy.ts's
// ENTERPRISE_ROLE_KEYS).
export type CustomerAccountRole = "Enterprise Super Manager" | "Enterprise Manager"

export interface CustomerAccountSummary {
  id: string
  email: string
  grantedRole: CustomerAccountRole
  seatLimit: number
  seatsUsed: number
  periodStart: string
  periodEnd: string
  lifecycle: "live" | "removing" | "removed"
  active: boolean
  createdAt: string
}

export interface CustomerAccountDetail extends CustomerAccountSummary {
  rootUserId: string | null
}

export interface CreateCustomerAccountInput {
  email: string
  periodEnd: string
  seats: number
  role: CustomerAccountRole
}

export interface CreateCustomerAccountResult {
  tenant: CustomerAccountSummary
  inviteUrl: string
  emailSent: boolean
}

export interface RemovalPreview {
  members: number
  pendingInvites: number
  projects: number
  tasks: number
  timeEntries: number
  screenshots: number
}

// §0.1 blocker 7 / §0.2 step 5: the audited read-only cross-tenant view -
// mirrors Dashboard-Backend's readonly-view.service.js allowlist exactly.
export type CustomerAccountViewSurface = "projects" | "employees" | "activity-summary"

export interface CustomerAccountProjectRow {
  id: string
  name: string
  status: string
  billable: boolean
  type: string
  clientId: string | null
  endDate: string | null
  createdAt: string
}

export interface CustomerAccountEmployeeRow {
  id: string
  firstName: string
  lastName: string
  displayName: string
  workEmail: string
  status: string
  createdAt: string
}

export interface CustomerAccountActivitySummary {
  activeMembers: number
  activeProjects: number
  activeSeconds7d: number
}
