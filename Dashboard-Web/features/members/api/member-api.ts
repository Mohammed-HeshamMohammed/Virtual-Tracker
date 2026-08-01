/* eslint-disable react-doctor/async-await-in-loop */
import { getFirebaseAuth } from "@/infrastructure/firebase/config"
import { extractRoleFromRecord } from "@/features/auth"
import { apiPath } from "@/infrastructure/api/path"
import type { Member, Invite, MemberRole, MemberStatus, InviteListKind, MigratableAuthUser, MigrateResultRow } from "@/features/members/models/member"
import { extractApiError, apiFetch, fetchJsonWithRetry, readJsonSafe, type RequestOptions } from "@/infrastructure/api/http"
import { throwIfQuotaExceeded, isFirestoreQuotaExceededError } from "@/features/auth/services/firestore-quota"
import { MANAGE_MODAL_TABS } from "@/features/members/config/members-config"
import type { MemberManageTab } from "@/features/members/models/member"
import { writeMemberProfileCache, peekMemberProfileCache } from "@/features/members/services/member-profile-cache"
import { isEmailLikeNamePart } from "@/shared/validation/person-name"


/** Make invite URLs absolute for clipboard/share (backend may return path-only). */
export function resolveInviteUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ""
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (typeof window !== "undefined") {
    const origin = window.location.origin.replace(/\/$/, "")
    return `${origin}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`
  }
  return trimmed
}

type ApiEnvelope<T> = {
  success?: boolean
  error?: string
  code?: string
  data?: T
  member?: T
  members?: T
  invite?: T
  invites?: T
}

function pickPayload<T>(json: ApiEnvelope<T>): T | undefined {
  return json.data ?? json.member ?? json.members ?? json.invite ?? json.invites
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function formatPaymentFromRecord(input: Record<string, unknown>): string {
  if (typeof input.payment === "string" && input.payment.trim()) return input.payment
  const rate = asNumber(input.pay_rate ?? input.payRate)
  const period = asString(input.pay_period ?? input.payPeriod)
  if (rate <= 0) return ""
  if (period && period !== "None") return `$${rate} (${period})`
  return `$${rate}/hr`
}

function formatLimitsFromRecord(input: Record<string, unknown>): string {
  const weekly = input.weekly_limit ?? input.weeklyLimit
  if (weekly !== undefined && weekly !== null && weekly !== "") {
    const numeric =
      typeof weekly === "number" ? weekly : Number(String(weekly).replace(/[^\d.]/g, ""))
    if (Number.isFinite(numeric) && numeric > 0) return `${numeric} hrs/wk`
    return "No limit"
  }
  if (typeof input.limits === "string" && input.limits.trim()) return input.limits
  return "No limit"
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

function sanitizeDisplayNamePart(value: string, workEmail = ""): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (isEmailLikeNamePart(trimmed)) return ""
  if (workEmail && trimmed.toLowerCase() === workEmail.trim().toLowerCase()) return ""
  return trimmed
}

function normalizeMember(input: Partial<Member> & Record<string, unknown>): Member {
  const workEmail = asString(input.work_email) || asString(input.email) || ""
  const firstName = sanitizeDisplayNamePart(asString(input.first_name), workEmail)
  const lastName = sanitizeDisplayNamePart(asString(input.last_name), workEmail)
  const name =
    asString(input.name) ||
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    "Unknown Member"
  const email = asString(input.email) || asString(input.work_email) || ""
  const personalEmail = asString(input.personalEmail || input.personal_email)
  const phone = asString(input.phone || input.phone_number || input.phoneNumber || input.mobile || input.mobile_number)
  const phoneVerified = input.phoneVerified === true || input.phone_verified === true
  const avatarUrl =
    asString(input.avatarUrl || input.avatar_url || input.photoURL || input.photo_url) ||
    (() => {
      const raw = asString(input.avatar)
      return raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:image") ? raw : ""
    })()
  const initials =
    name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "??"
  return {
    id: asString(input.id),
    memberUid: asString(input.memberUid || input.member_uid || input.id),
    firebaseUid: asString(input.firebaseUid || input.firebase_uid),
    createdBy: asString(input.createdBy || input.created_by),
    createdByUid: asString(input.createdByUid || input.created_by_uid),
    name,
    email: email || personalEmail,
    personalEmail,
    phone,
    phoneVerified,
    avatarUrl,
    lastIp: asString(input.lastIp || input.ip_address || input.last_ip),
    avatar: avatarUrl ? initials : asString(input.avatar) || initials,
    avatarColor: asString(input.avatarColor || input.avatar_color) || "#3b82f6",
    status: (asString(input.status, "active") as MemberStatus),
    role: extractRoleFromRecord(input) as MemberRole,
    role_name: extractRoleFromRecord(input),
    projects: asNumber(input.projects, 0),
    payment: formatPaymentFromRecord(input),
    limits: formatLimitsFromRecord(input),
    trackingStatus: (asString(input.trackingStatus || input.tracking_status, "offline") as Member["trackingStatus"]),
    dateAdded: asString(input.dateAdded || input.date_added) || "",
    teams: Array.isArray(input.teams)
      ? input.teams.length
      : asNumber(input.teams ?? input.team_count ?? input.teamCount, 0),
    teamNames: asStringArray(input.team_names ?? input.teamNames).length
      ? asStringArray(input.team_names ?? input.teamNames)
      : Array.isArray(input.teams)
        ? asStringArray(input.teams)
        : [],
    projectIds: asStringArray(input.project_ids ?? input.projectIds),
    weeklyLimit: asString(input.weeklyLimit || input.weekly_limit) || "",
    privileges:
      input.privileges && typeof input.privileges === "object"
        ? {
            manage_employee_teams:
              (input.privileges as Record<string, unknown>).manage_employee_teams === true,
          }
        : undefined,
  }
}

function mapInviteStatus(raw: string): Invite["status"] {
  const s = raw.toLowerCase()
  if (s === "completed" || s === "accepted") return "Joined"
  if (s === "pending_auth") return "Pending sign-in"
  if (s === "pending_signup" || s === "pending") return "Awaiting signup"
  if (s === "expired") return "Expired"
  return "Pending"
}

function projectCountFromCsv(projectIdsCsv: string): number {
  if (!projectIdsCsv || typeof projectIdsCsv !== "string") return 0
// eslint-disable-next-line react-doctor/js-flatmap-filter
  return projectIdsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length
}

function normalizeInvite(input: Partial<Invite> & Record<string, unknown>): Invite {
  const id = asString(input.id)
  const listKind: InviteListKind = id.startsWith("pa_") ? "pending_account" : "invite"
  const inviteKindRaw = asString(input.invite_kind || input.inviteKind, "email")
  const inviteKind =
    inviteKindRaw === "open_link" ? "open_link" : inviteKindRaw === "preprovision" ? "preprovision" : "email"
  const role =
    (asString(input.role_name || input.roleName, "") as MemberRole) ||
    (asString(input.role, "User") as MemberRole)
  const pay =
    typeof input.pay_rate === "number"
      ? input.pay_rate
      : typeof input.payRate === "number"
        ? input.payRate
        : undefined
  const csv = asString(input.project_ids_csv)
  const projectCount =
    asNumber(input.project_count ?? input.projectCount, NaN) ||
    asNumber(input.projects, projectCountFromCsv(csv))
  const expiresAt = asString(input.expires_at || input.expiresAt) || undefined
  let status = mapInviteStatus(asString(input.status, "pending"))
  if (status === "Awaiting signup" && expiresAt) {
    const expMs = Date.parse(expiresAt)
    if (Number.isFinite(expMs) && expMs <= Date.now()) status = "Expired"
  }
  const emailRaw = asString(input.email)
  return {
    id,
    email: inviteKind === "open_link" && !emailRaw ? "Share link" : emailRaw,
    role: role || (asString(input.role, "User") as MemberRole),
    teams: asString(input.teams) || "",
    projects: projectCount,
    payment: asString(input.payment) || (typeof pay === "number" ? `$${pay}/hr` : "$0/hr"),
    weeklyLimit: asString(input.weeklyLimit || input.weekly_limit) || "",
    status,
    listKind,
    inviteKind,
    expiresAt,
    createdByUid: asString(input.created_by_uid || input.createdByUid) || undefined,
  }
}

// API Functions
/** GET /api/members/current — provisions row if missing. */
export async function fetchCurrentMember(): Promise<Member | null> {
  if (!getFirebaseAuth().currentUser) return null
  try {
    const res = await apiFetch(apiPath("/api/members/current"), { cache: "no-store" })
    const json = await readJsonSafe<ApiEnvelope<Member>>(res)
    if (!res.ok) {
      throwIfQuotaExceeded(res.status, json?.error, json?.code)
      return null
    }
    if (!json?.success) return null
    const payload = pickPayload(json)
    if (!payload || typeof payload !== "object") return null
    return normalizeMember(payload as unknown as Record<string, unknown>)
  } catch (err) {
    if (isFirestoreQuotaExceededError(err)) throw err
    return null
  }
}

export type MembersPageResult = {
  members: Member[]
  nextCursor: string | null
  hasMore: boolean
}

type MembersApiEnvelope = ApiEnvelope<Member[]> & {
  nextCursor?: string | null
  hasMore?: boolean
}

const MEMBERS_PAGE_SIZE = 200
const MEMBERS_MAX_PAGES = 25

export async function getMembers(
  options: RequestOptions & {
    fields?: string[]
    limit?: number
    cursor?: string
    singlePage?: boolean
    roles?: string[]
    projectIds?: string[]
  } = {},
): Promise<Member[]> {
  if (options.singlePage || options.cursor || options.limit) {
    const page = await getMembersPage(options)
    return page.members
  }

  const all: Member[] = []
  let cursor: string | undefined
  for (let pageIndex = 0; pageIndex < MEMBERS_MAX_PAGES; pageIndex += 1) {
    const page = await getMembersPage({
      ...options,
      limit: MEMBERS_PAGE_SIZE,
      cursor,
    })
    all.push(...page.members)
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return all
}

/** Paginated members list (`GET /api/members?limit=&cursor=`). */
export async function getMembersPage(
  options: RequestOptions & {
    fields?: string[]
    limit?: number
    cursor?: string
    roles?: string[]
    projectIds?: string[]
  } = {},
): Promise<MembersPageResult> {
  const params = new URLSearchParams()
  if (options.fields?.length) params.set("fields", options.fields.join(","))
  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    params.set("limit", String(Math.max(1, Math.min(200, Math.trunc(options.limit)))))
  }
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.roles?.length) params.set("roles", options.roles.join(","))
  if (options.projectIds?.length) params.set("project_ids", options.projectIds.join(","))
  const query = params.toString() ? `?${params.toString()}` : ""
  let res: Response
  let json: MembersApiEnvelope | null
  try {
    ;({ res, json } = await fetchJsonWithRetry<MembersApiEnvelope>(
      apiPath(`/api/members${query}`),
      {},
      { ...options, retries: 1 },
    ))
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Could not reach the API. Check your network connection or try again shortly.",
      )
    }
    throw error
  }
  if (!res.ok) {
    throwIfQuotaExceeded(res.status, json?.error, json?.code)
    if (res.status === 0 || res.status >= 500) {
      throw new Error(
        json?.error ||
          "Could not reach the API. Check your network connection or try again shortly.",
      )
    }
    throw extractApiError(res.status, "Failed to fetch members", json)
  }
  if (!json) throw new Error("Failed to parse members response")
  if (!json.success) throw new Error(json.error || "Failed to fetch members")
  const members = (pickPayload(json) ?? []).map((member) =>
    normalizeMember(member as unknown as Record<string, unknown>),
  )
  return {
    members,
    nextCursor: typeof json.nextCursor === "string" ? json.nextCursor : null,
    hasMore: json.hasMore === true,
  }
}

async function getMember(id: string): Promise<Member> {
  const res = await apiFetch(apiPath(`/api/members/${id}`))
  if (!res.ok) throw new Error(`Failed to fetch member: ${res.status}`)
  const json = (await res.json()) as ApiEnvelope<Member>
  if (!json.success) throw new Error(json.error || "Failed to fetch member")
  return normalizeMember((pickPayload(json) ?? {}) as Record<string, unknown>)
}

/** Loads signed-in member; falls back to `GET /api/members/:id` when verify returned an id. */
export async function fetchCurrentMemberWithFallback(memberId?: string): Promise<Member | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const member = await fetchCurrentMember()
    if (member) return member
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  if (memberId) {
    try {
      return await getMember(memberId)
    } catch {
      return null
    }
  }
  return null
}

export interface CreateMemberInput {
  name: string
  email: string
  role?: MemberRole
  status?: MemberStatus
  payRate?: number
  weeklyLimit?: string
}

async function createMember(data: CreateMemberInput, createdBy?: string): Promise<Member> {
  const [firstName = "", ...rest] = data.name.trim().split(/\s+/)
  const lastName = rest.join(" ")
  const payload = {
    name: data.name,
    first_name: firstName,
    last_name: lastName,
    work_email: data.email,
    email: data.email,
    role: data.role || "User",
    status: data.status || "active",
    payRate: data.payRate,
    weeklyLimit: data.weeklyLimit,
    createdBy,
  }
  
  const res = await apiFetch(apiPath("/api/members"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Failed to create member: ${res.status}`)
  const json = (await res.json()) as ApiEnvelope<Member>
  if (!json.success) throw new Error(json.error || "Failed to create member")
  return normalizeMember((pickPayload(json) ?? {}) as Record<string, unknown>)
}

export interface UpdateMemberInput {
  name?: string
  email?: string
  role?: MemberRole
  status?: MemberStatus
  payRate?: number
  weeklyLimit?: string
  trackingStatus?: string
  lastIp?: string
}

export async function updateMember(id: string, data: UpdateMemberInput, updatedBy?: string): Promise<Member> {
  const res = await apiFetch(apiPath(`/api/members/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, updatedBy }),
  })
  if (!res.ok) throw new Error(`Failed to update member: ${res.status}`)
  const json = (await res.json()) as ApiEnvelope<Member>
  if (!json.success) throw new Error(json.error || "Failed to update member")
  return normalizeMember((pickPayload(json) ?? {}) as Record<string, unknown>)
}

export async function deleteMember(id: string): Promise<void> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<{ deleted?: boolean }>>(
    apiPath(`/api/members/${id}`),
    { method: "DELETE" },
    { retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to delete member", json)
}

export type BatchMemberUpdatePayload = {
  payBill?: { payRate?: string; payPeriod?: string }
  workLimits?: { weeklyLimit?: string; dailyLimit?: string }
}

export async function batchRemoveMembersFromTree(ids: string[]): Promise<{ removed: number }> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<{ removed: number }>>(
    apiPath("/api/members/batch-remove-from-tree"),
    {
      method: "POST",
      body: JSON.stringify({ ids }),
    },
    { retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to remove members from tree", json)
  if (!json?.success) throw new Error(json?.error || "Failed to remove members from tree")
  return json.data ?? { removed: ids.length }
}

export async function removeMemberFromTree(memberId: string): Promise<void> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<unknown>>(
    apiPath("/api/members/remove-from-tree"),
    {
      method: "POST",
      body: JSON.stringify({ memberId }),
    },
    { retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to remove member from tree", json)
  if (!json?.success) throw new Error(json?.error || "Failed to remove member from tree")
}

export async function batchDeleteMembers(ids: string[]): Promise<{ deleted: number }> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<{ deleted: number }>>(
    apiPath("/api/members/batch-delete"),
    {
      method: "POST",
      body: JSON.stringify({ ids }),
    },
    { retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to batch delete members", json)
  if (!json?.success) throw new Error(json?.error || "Failed to batch delete members")
  return json.data ?? { deleted: ids.length }
}

export async function batchUpdateMembers(
  ids: string[],
  patch: BatchMemberUpdatePayload,
): Promise<{ updated: number }> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<{ updated: number }>>(
    apiPath("/api/members/batch-update"),
    {
      method: "POST",
      body: JSON.stringify({ ids, ...patch }),
    },
    { retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to batch update members", json)
  if (!json?.success) throw new Error(json?.error || "Failed to batch update members")
  return json.data ?? { updated: ids.length }
}

export type MemberProfilePayload = {
  updatedBy?: string
  info?: {
    editFirst?: string
    editLast?: string
    editEmail?: string
    editPersonalEmail?: string
    editPhone?: string
    phoneVerificationToken?: string
    employeeId?: string
    lastIp?: string
  }
  employment?: Record<string, unknown>
  roles?: { role?: MemberRole }
  payBill?: { paySegment?: string; payRate?: string; payPeriod?: string }
  workLimits?: {
    weeklyLimit?: string
    dailyLimit?: string
    disableTrackingSpecificDays?: boolean
    useShiftsForLimits?: boolean
    workDays?: number[]
  }
  settings?: {
    ableToTrack?: boolean
    idleMode?: string
    idleTimeout?: string
    manualTime?: string
    requireApproval?: boolean
    manageEmployeeTeams?: boolean
  }
}

export type MemberProfileForm = MemberProfilePayload["info"] &
  MemberProfilePayload["employment"] &
  MemberProfilePayload["roles"] &
  MemberProfilePayload["payBill"] &
  MemberProfilePayload["workLimits"] &
  MemberProfilePayload["settings"] & {
    editFirst: string
    editLast: string
    editEmail: string
    editPersonalEmail: string
    editPhone: string
    phoneVerified: boolean
    phoneVerificationToken: string
    employeeId: string
    lastIp: string
    role: MemberRole
    payRate: string
    paySegment: "pay" | "bill"
    payPeriod: string
    weeklyLimit: string
    dailyLimit: string
    disableTrackingSpecificDays: boolean
    useShiftsForLimits: boolean
    workDays: number[]
    ableToTrack: boolean
    idleMode: "Prompt" | "Always" | "Never"
    idleTimeout: string
    manualTime: string
    requireApproval: boolean
    manageEmployeeTeams: boolean
    empJobTitle: string
    empDepartment: string
    empJobType: string
    empWorkAddress: string
    empMailing: boolean
    empEmploymentType: string
    empEmployedThrough: string
    empWorkplace: string
    empOfficePct: string
    empRemotePct: string
    empTaxInfo: string
    empAccountCode: string
    empTaxType: string
    empStartDate: string
    empEndDate: string
    empTermination: string
    empComments: string
  }

export async function getMemberProfile(
  id: string,
  sections?: MemberManageTab[],
): Promise<{ form: Partial<MemberProfileForm>; member: Member; sections?: MemberManageTab[] }> {
  const params = new URLSearchParams()
  if (sections?.length) params.set("sections", sections.join(","))
  const query = params.toString() ? `?${params.toString()}` : ""
  const res = await apiFetch(apiPath(`/api/members/${id}/profile${query}`))
  const json = (await res.json()) as ApiEnvelope<{
    form: Partial<MemberProfileForm>
    member: Member
    sections?: MemberManageTab[]
  }>
  if (!res.ok || !json.success) throw new Error(json.error || `Failed to load member profile: ${res.status}`)
  const data = pickPayload(json) ?? { form: {}, member: {} as Member }
  return {
    form: (data.form ?? {}) as Partial<MemberProfileForm>,
    member: normalizeMember((data.member ?? {}) as unknown as Record<string, unknown>),
    sections: Array.isArray(data.sections) ? data.sections : sections,
  }
}

export {
  peekMemberProfileCache,
  isMemberProfileCacheFresh,
  isMemberProfileSectionLoaded,
  isMemberProfileSectionFresh,
  writeMemberProfileCache,
  mergeMemberProfileCache,
  invalidateMemberProfileCache,
  fetchMemberProfileCached,
  fetchMemberProfileSectionCached,
  revalidateMemberProfileCache,
  MEMBER_PROFILE_CACHE_STALE_MS,
} from "@/features/members/services/member-profile-cache"

export async function updateMemberProfile(
  id: string,
  payload: MemberProfilePayload,
  updatedBy?: string,
): Promise<{ form: Partial<MemberProfileForm>; member: Member }> {
  const isRoleOnly =
    payload.roles?.role != null &&
    !payload.info &&
    !payload.employment &&
    !payload.payBill &&
    !payload.workLimits &&
    !payload.settings

  if (isRoleOnly && payload.roles?.role) {
    return updateMemberRole(id, payload.roles.role, updatedBy)
  }

  const res = await apiFetch(apiPath(`/api/members/${id}/profile`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, updatedBy }),
  })
  const json = (await res.json()) as ApiEnvelope<{ form: Partial<MemberProfileForm>; member: Member }>
  if (!res.ok || !json.success) throw new Error(json.error || `Failed to save member profile: ${res.status}`)
  const data = pickPayload(json) ?? { form: {}, member: {} as Member }
  const result = {
    form: (data.form ?? {}) as Partial<MemberProfileForm>,
    member: normalizeMember((data.member ?? {}) as unknown as Record<string, unknown>),
  }
  const existing = peekMemberProfileCache(id)
  writeMemberProfileCache(id, {
    ...result,
    loadedSections: existing?.loadedSections?.length ? existing.loadedSections : MANAGE_MODAL_TABS.map((tab) => tab.id),
  })
  return result
}

export async function updateMemberRole(
  id: string,
  role: string,
  updatedBy?: string,
): Promise<{ form: Partial<MemberProfileForm>; member: Member }> {
  const res = await apiFetch(apiPath(`/api/members/${id}/role`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, updatedBy }),
  })
  const json = (await res.json()) as ApiEnvelope<{ form: Partial<MemberProfileForm>; member: Member }>
  if (!res.ok || !json.success) throw new Error(json.error || `Failed to change member role: ${res.status}`)
  const data = pickPayload(json) ?? { form: {}, member: {} as Member }
  const result = {
    form: (data.form ?? {}) as Partial<MemberProfileForm>,
    member: normalizeMember((data.member ?? {}) as unknown as Record<string, unknown>),
  }
  const existing = peekMemberProfileCache(id)
  writeMemberProfileCache(id, {
    ...result,
    loadedSections: existing?.loadedSections?.length ? existing.loadedSections : ["roles"],
  })
  return result
}

export type GeneratedEmployeeIdResult = {
  employeeId: string
  metrics?: {
    nameSlug?: string
    treeSequence?: number
    depth?: number
    ancestorCount?: number
    ancestorRoleCount?: number
    siblingIndex?: number
    roleCode?: string
  }
}

export async function generateMemberEmployeeId(
  memberId: string,
  options?: { firstName?: string },
): Promise<GeneratedEmployeeIdResult> {
  const params = new URLSearchParams()
  if (options?.firstName?.trim()) params.set("firstName", options.firstName.trim())
  const query = params.toString() ? `?${params.toString()}` : ""
  const res = await apiFetch(apiPath(`/api/members/${memberId}/generate-employee-id${query}`))
  const json = (await res.json()) as ApiEnvelope<GeneratedEmployeeIdResult>
  if (!res.ok || !json.success) {
    throw new Error(json.error || `Failed to generate employee ID: ${res.status}`)
  }
  const data = pickPayload(json)
  if (!data?.employeeId) throw new Error("Failed to generate employee ID")
  return data
}

// Invites
export async function getInvites(options: RequestOptions & { fields?: string[] } = {}): Promise<Invite[]> {
  const params = new URLSearchParams()
  if (options.fields?.length) params.set("fields", options.fields.join(","))
  const query = params.toString() ? `?${params.toString()}` : ""
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<Invite[]>>(apiPath(`/api/invites${query}`), {}, { ...options, retries: 1 })
  if (!res.ok) throw extractApiError(res.status, "Failed to fetch invites", json)
  if (!json) throw new Error("Failed to parse invites response")
  if (!json.success) throw new Error(json.error || "Failed to fetch invites")
  return (pickPayload(json) ?? []).map((invite) => normalizeInvite(invite as unknown as Record<string, unknown>))
}

export interface CreateInviteInput {
  email: string
  role: MemberRole
  projects?: string[]
  payRate?: number
  weeklyLimit?: string
}

async function createInvite(data: CreateInviteInput, createdBy?: string): Promise<Invite> {
  const payload = {
    email: data.email,
    role: data.role,
    projects: data.projects || [],
    payRate: data.payRate,
    weeklyLimit: data.weeklyLimit,
    createdBy,
  }
  
  const res = await apiFetch(apiPath("/api/invites"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Failed to create invite: ${res.status}`)
  const json = (await res.json()) as ApiEnvelope<Invite>
  if (!json.success) throw new Error(json.error || "Failed to create invite")
  return normalizeInvite((pickPayload(json) ?? {}) as Record<string, unknown>)
}

export async function updateInvite(id: string, data: Partial<CreateInviteInput>, updatedBy?: string): Promise<Invite> {
  const payload: Record<string, unknown> = {}
  if (updatedBy) payload.updated_by = updatedBy
  if (data.email !== undefined) payload.email = data.email
  if (data.role !== undefined) {
    payload.role = data.role
  }
  if (data.payRate !== undefined) payload.pay_rate = data.payRate
  if (data.weeklyLimit !== undefined) payload.weekly_limit = data.weeklyLimit

  const res = await apiFetch(apiPath(`/api/invites/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Failed to update invite: ${res.status}`)
  const json = (await res.json()) as ApiEnvelope<Invite>
  if (!json.success) throw new Error(json.error || "Failed to update invite")
  return normalizeInvite((pickPayload(json) ?? {}) as Record<string, unknown>)
}

export type CreateInvitesBulkOptions = {
  /** Default `email` — each row must include an email. */
  inviteKind?: "email" | "open_link"
  /** Used to build absolute invite URLs in the API response (e.g. `window.location.origin`). */
  appOrigin?: string
  createdBy?: string
  createdByUid?: string
}

export type CreateInvitesBulkResult = {
  invites: Invite[]
  emailsSent: number
  emailsFailed: number
  emailChannel?: string
  inviteUrls: string[]
}

export async function createInvitesBulk(
  rows: Array<{ email: string; payRate?: number }>,
  role: MemberRole,
  options: CreateInvitesBulkOptions = {},
): Promise<CreateInvitesBulkResult> {
  const res = await apiFetch(apiPath("/api/invites/bulk"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rows,
      role,
      inviteKind: options.inviteKind ?? "email",
      appOrigin: options.appOrigin,
      createdBy: options.createdBy,
      createdByUid: options.createdByUid,
    }),
  })
  const json = (await res.json()) as ApiEnvelope<Invite[]> & {
    error?: string
    reason?: string
    email?: string
    emailsSent?: number
    emailsFailed?: number
    emailChannel?: string
  }
  if (!res.ok) throw new Error(json.error || `Failed to create invites in bulk: ${res.status}`)
  if (!json.success) throw new Error(json.error || "Failed to create invites in bulk")
  const rawInvites = asRecordArray(pickPayload(json))
  const invites = rawInvites.map((invite) => normalizeInvite(invite))
  const inviteUrls = rawInvites
    .map((row) => (typeof row.inviteUrl === "string" ? resolveInviteUrl(row.inviteUrl) : ""))
    .filter(Boolean)
  return {
    invites,
    emailsSent: typeof json.emailsSent === "number" ? json.emailsSent : 0,
    emailsFailed: typeof json.emailsFailed === "number" ? json.emailsFailed : 0,
    emailChannel: typeof json.emailChannel === "string" ? json.emailChannel : undefined,
    inviteUrls,
  }
}

export type OpenInviteLinkInput = {
  role: MemberRole
  payRate?: number
  appOrigin?: string
  createdBy?: string
  createdByUid?: string
}

export async function createOpenInviteLink(input: OpenInviteLinkInput): Promise<{
  inviteUrl: string
  token: string
  expiresAt: string | null
  maxUses: number
}> {
  const res = await apiFetch(apiPath("/api/invites/open-link"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: input.role,
      payRate: input.payRate,
      appOrigin: input.appOrigin,
      createdBy: input.createdBy,
      createdByUid: input.createdByUid,
    }),
  })
  const json = (await res.json()) as ApiEnvelope<unknown> & {
    inviteUrl?: string
    token?: string
    expiresAt?: string | null
    maxUses?: number
  }
  if (!res.ok) throw new Error(json.error || `Failed to create open invite: ${res.status}`)
  if (!json.success) throw new Error(json.error || "Failed to create open invite")
  const inviteUrl = typeof json.inviteUrl === "string" ? resolveInviteUrl(json.inviteUrl) : ""
  const token = typeof json.token === "string" ? json.token : ""
  if (!inviteUrl) throw new Error("Missing inviteUrl in response")
  return {
    inviteUrl,
    token,
    expiresAt: typeof json.expiresAt === "string" ? json.expiresAt : null,
    maxUses: typeof json.maxUses === "number" ? json.maxUses : 1,
  }
}

export type ValidateAddEmailResult = {
  email: string
  ok: boolean
  reason: string
  message: string
}

/** Check emails are eligible for invite/pre-provision. */
export async function validateEmailsForAddMembers(
  emails: string[],
  options: { forOpenInviteLink?: boolean } = {},
): Promise<{ allOk: boolean; results: ValidateAddEmailResult[] }> {
  const res = await apiFetch(apiPath("/api/members/validate-add"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emails, forOpenInviteLink: options.forOpenInviteLink === true }),
  })
  const json = (await res.json()) as {
    success?: boolean
    error?: string
    allOk?: boolean
    results?: ValidateAddEmailResult[]
  }
  if (!res.ok || json.success !== true) {
    throw new Error(json.error || `Email check failed: ${res.status}`)
  }
  return {
    allOk: json.allOk === true,
    results: Array.isArray(json.results) ? json.results : [],
  }
}

/** Firebase Auth users not yet linked to a `members` row — Migrate tab candidates. */
export async function fetchMigratableUsers(
  params: { pageToken?: string; email?: string; phone?: string } = {},
): Promise<{ users: MigratableAuthUser[]; nextPageToken: string | null }> {
  const q = new URLSearchParams()
  if (params.pageToken) q.set("pageToken", params.pageToken)
  if (params.email) q.set("email", params.email)
  if (params.phone) q.set("phone", params.phone)
  const qs = q.toString()
  const res = await apiFetch(apiPath(`/api/members/migratable${qs ? `?${qs}` : ""}`))
  const json = (await res.json()) as {
    success?: boolean
    error?: string
    users?: MigratableAuthUser[]
    nextPageToken?: string | null
  }
  if (!res.ok || json.success !== true) {
    throw new Error(json.error || `Failed to load migratable users: ${res.status}`)
  }
  return { users: Array.isArray(json.users) ? json.users : [], nextPageToken: json.nextPageToken ?? null }
}

/** Adopt existing Firebase Auth users (already signed in elsewhere, e.g. the mobile app) into Virtual Tracker — each with its own role. */
export async function migrateAuthUsers(migrations: { uid: string; role: MemberRole }[]): Promise<MigrateResultRow[]> {
  const res = await apiFetch(apiPath("/api/members/migrate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ migrations }),
  })
  const json = (await res.json()) as { success?: boolean; error?: string; results?: MigrateResultRow[] }
  if (!res.ok || json.success !== true) {
    throw new Error(json.error || `Migration failed: ${res.status}`)
  }
  return Array.isArray(json.results) ? json.results : []
}

export type ResolvePublicInviteResult = {
  inviteKind: string
  emailLocked: boolean
  email: string
  roleName: string
}

export async function resolvePublicInvite(token: string): Promise<ResolvePublicInviteResult> {
  const res = await apiFetch(apiPath(`/api/public/invites/${encodeURIComponent(token)}`), {}, { requireAuth: false })
  const json = (await res.json()) as { success?: boolean; error?: string; invite?: ResolvePublicInviteResult }
  if (!res.ok) throw new Error(json.error || `Invite lookup failed: ${res.status}`)
  if (!json.success || !json.invite) throw new Error(json.error || "Invalid invite")
  return json.invite
}

export async function registerViaInviteToken(
  token: string,
  body: {
    email: string
    firstName: string
    lastName: string
    phone: string
    phoneVerificationToken?: string
    password: string
    confirmPassword?: string
  },
): Promise<void> {
  const res = await apiFetch(
    apiPath(`/api/public/invites/${encodeURIComponent(token)}/register`),
    { method: "POST", body: JSON.stringify(body) },
    { requireAuth: false, json: true },
  )
  const json = (await res.json()) as { success?: boolean; error?: string }
  if (!res.ok) throw new Error(json.error || `Registration failed: ${res.status}`)
  if (!json.success) throw new Error(json.error || "Registration failed")
}

export type PreprovisionMemberInput = {
  name: string
  email: string
  phone?: string
  phoneVerificationToken?: string
  role: MemberRole
  payRate?: number
  sendWelcomeEmail: boolean
  createdByUid?: string
}

export type PreprovisionMemberResult = {
  firebaseUid: string
  emailSent: boolean
  tempPassword?: string
}

export async function preprovisionMember(input: PreprovisionMemberInput): Promise<PreprovisionMemberResult> {
  const res = await apiFetch(apiPath("/api/members/preprovision"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
      role: input.role,
      payRate: input.payRate,
      sendWelcomeEmail: input.sendWelcomeEmail,
      createdByUid: input.createdByUid,
    }),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok || json.success !== true) {
    const err = typeof json.error === "string" ? json.error : `Pre-provision failed: ${res.status}`
    throw new Error(err)
  }
  return {
    firebaseUid: typeof json.firebaseUid === "string" ? json.firebaseUid : "",
    emailSent: json.emailSent === true,
    tempPassword: typeof json.tempPassword === "string" ? json.tempPassword : undefined,
  }
}

async function acceptInvite(id: string, acceptedBy?: string): Promise<Invite> {
  const res = await apiFetch(apiPath(`/api/invites/${id}/accept`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acceptedBy }),
  })
  if (!res.ok) throw new Error(`Failed to accept invite: ${res.status}`)
  const json = (await res.json()) as ApiEnvelope<Invite>
  if (!json.success) throw new Error(json.error || "Failed to accept invite")
  return normalizeInvite((pickPayload(json) ?? {}) as Record<string, unknown>)
}

export async function deleteInvite(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/invites/${id}`), { method: "DELETE" })
  if (!res.ok) throw new Error(`Failed to delete invite: ${res.status}`)
}

export type ResendInviteResult = {
  emailSent: boolean
  inviteUrl: string
  channel?: string
  emailError?: string
  emailDeliveryConfigured?: boolean
}

export async function resendInviteEmail(id: string, appOrigin?: string): Promise<ResendInviteResult> {
  const res = await apiFetch(apiPath(`/api/invites/${id}/resend`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appOrigin: appOrigin ?? (typeof window !== "undefined" ? window.location.origin : undefined) }),
  })
  const json = (await res.json()) as ApiEnvelope<Invite> & {
    error?: string
    emailSent?: boolean
    inviteUrl?: string
    channel?: string
    emailError?: string
    emailDeliveryConfigured?: boolean
  }
  if (!res.ok || !json.success) throw new Error(json.error || `Failed to resend invite: ${res.status}`)
  return {
    emailSent: json.emailSent === true,
    inviteUrl: typeof json.inviteUrl === "string" ? json.inviteUrl : "",
    channel: typeof json.channel === "string" ? json.channel : undefined,
    emailError: typeof json.emailError === "string" ? json.emailError : undefined,
    emailDeliveryConfigured: json.emailDeliveryConfigured === true,
  }
}

export async function getInviteLink(id: string, appOrigin?: string): Promise<string> {
  const res = await apiFetch(apiPath(`/api/invites/${id}/link`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appOrigin: appOrigin ?? (typeof window !== "undefined" ? window.location.origin : undefined) }),
  })
  const json = (await res.json()) as { success?: boolean; error?: string; inviteUrl?: string }
  if (!res.ok || !json.success) throw new Error(json.error || `Failed to get invite link: ${res.status}`)
  if (typeof json.inviteUrl !== "string" || !json.inviteUrl) throw new Error("Invite link unavailable.")
  return json.inviteUrl
}

export async function renewInvite(id: string): Promise<Invite> {
  const res = await apiFetch(apiPath(`/api/invites/${id}/renew`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
  const json = (await res.json()) as ApiEnvelope<Invite> & { error?: string }
  if (!res.ok || !json.success) throw new Error(json.error || `Failed to renew invite: ${res.status}`)
  return normalizeInvite((pickPayload(json) ?? {}) as Record<string, unknown>)
}
