import type { Member, MemberEntryAction, MemberManageTab } from "@/features/members/models/member"

/** True when the signed-in user is viewing their own member record. */
export function isSameMember(
  member: Member,
  currentMemberId?: string | null,
  currentUid?: string | null,
  currentEmail?: string | null,
): boolean {
  if (currentMemberId && member.id === currentMemberId) return true
  if (currentUid && (member.firebaseUid || "").trim() === currentUid.trim()) return true
  const email = (member.email || "").trim().toLowerCase()
  return Boolean(email && currentEmail && email === currentEmail.trim().toLowerCase())
}

export function weeklyLimitInputFromStored(raw: string | undefined): string {
  const v = (raw ?? "").trim()
  if (!v || /^no\s/i.test(v)) return ""
  const n = Number(v.replace(/[^\d.]/g, ""))
  return Number.isFinite(n) ? String(n) : ""
}

export function inviteWeeklyLimitPayloadFromInput(input: string): string {
  const t = input.trim()
  if (!t) return "No weekly limit"
  const n = Number(t)
  if (Number.isFinite(n) && n >= 0) return String(n)
  return t
}

export function splitMemberDisplayName(full: string): { firstName: string; lastName: string } {
  const t = full.trim()
  const i = t.indexOf(" ")
  if (i === -1) return { firstName: t, lastName: "" }
  return { firstName: t.slice(0, i), lastName: t.slice(i + 1).trim() }
}

export function parseUsdHrPayment(payment: string): string {
  const m = /^\$([\d.]+)\/hr$/.exec(payment.trim())
  return m?.[1] ?? ""
}

export function memberEntryToTab(entry: MemberEntryAction): MemberManageTab {
  if (entry === "edit-info") return "info"
  if (entry === "edit-role") return "roles"
  if (entry === "edit-payment") return "payBill"
  if (entry === "edit-limits") return "workLimits"
  return "settings"
}

/** Coerce API / row role values to a display string for forms and selects. */
export function memberRoleAsString(role: unknown, fallback = "Viewer"): string {
  if (typeof role === "string" && role.trim()) return role.trim()
  if (role && typeof role === "object") {
    const named = role as { name?: unknown; role_name?: unknown; roleName?: unknown }
    for (const candidate of [named.name, named.role_name, named.roleName]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
    }
  }
  return fallback
}
