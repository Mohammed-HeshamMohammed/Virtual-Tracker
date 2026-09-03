import { getOrganizationFieldOptions } from "@/features/settings/api/organization-fields-api"
import type { Member } from "@/features/members/models/member"

export type MemberContactDetails = {
  email: string
  phone: string
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function pickPhone(obj: Record<string, unknown>): string {
  const keys = ["phone", "phoneNumber", "phone_number", "mobile", "mobileNumber", "mobile_number"]
  for (const key of keys) {
    const v = asString(obj[key])
    if (v) return v
  }
  return ""
}

function pickEmail(obj: Record<string, unknown>, fallback = ""): string {
  const keys = ["email", "editEmail", "work_email", "workEmail", "personal_email", "personalEmail"]
  for (const key of keys) {
    const v = asString(obj[key])
    if (v) return v
  }
  return fallback
}

function extractFromFormData(formData: unknown, member: Member): MemberContactDetails {
  if (!formData || typeof formData !== "object") {
    return { email: member.email, phone: "" }
  }
  const root = formData as Record<string, unknown>
  const info = root.info && typeof root.info === "object" ? (root.info as Record<string, unknown>) : {}
  const contact =
    root.contact && typeof root.contact === "object" ? (root.contact as Record<string, unknown>) : {}
  const settings =
    root.settings && typeof root.settings === "object" ? (root.settings as Record<string, unknown>) : {}

  const phone = pickPhone(contact) || pickPhone(info) || pickPhone(settings) || pickPhone(root)
  const email = pickEmail(contact, "") || pickEmail(info, "") || pickEmail(root, member.email)

  return { email: email || member.email, phone }
}

export async function getMemberContactFromFieldData(member: Member): Promise<MemberContactDetails> {
  const rows = (await getOrganizationFieldOptions("memberFormSnapshot")) as unknown as Array<
    Record<string, unknown> & { id: string }
  >
  const matches = rows.filter((row) => {
    const docId = asString(row.memberDocId) || asString(row.member_doc_id)
    return docId === member.id
  })
  if (matches.length === 0) {
    return { email: member.email, phone: member.phone ?? "" }
  }
  const latest = matches.reduce((a, b) => {
    const aTime = Date.parse(asString(a.created_at) || asString(a.createdAt)) || 0
    const bTime = Date.parse(asString(b.created_at) || asString(b.createdAt)) || 0
    return bTime >= aTime ? b : a
  })
  const formData = latest.formData ?? latest.form_data
  return extractFromFormData(formData, member)
}

export function memberDetailsFromRecord(member: Member): MemberContactDetails {
  return {
    email: member.email || member.personalEmail || "",
    phone: member.phone ?? "",
  }
}
