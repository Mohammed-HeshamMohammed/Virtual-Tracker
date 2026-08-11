import { isValidUuid } from "@/shared/utils/uuid"
import { fetchCurrentMember } from "@/features/members/api/member-api"

/** Signed-in user's members.id (Postgres UUID, not Firebase uid). */
export async function resolveCurrentMemberId(): Promise<string | undefined> {
  try {
    const member = await fetchCurrentMember()
    const id = member?.id
    return isValidUuid(id) ? id : undefined
  } catch {
    return undefined
  }
}
