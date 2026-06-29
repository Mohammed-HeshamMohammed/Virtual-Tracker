import type { Member } from "@/features/members/models/member"
import type { Client } from "@/features/clients/models/client"

/** Member access role is Client (set on Members page). */
function isClientRoleMember(member: Member): boolean {
  const role = (member.role ?? "").toLowerCase().replace(/\s+/g, "")
  return role === "client"
}

/** Client-role members who do not yet have a row in the clients table. */
export function getUnlinkedClientMembers(members: Member[], clients: Client[]): Member[] {
  const linkedMemberIds = new Set(
    clients.map((c) => c.clientMember).filter((id): id is string => Boolean(id)),
  )
  return members.filter((m) => isClientRoleMember(m) && !linkedMemberIds.has(m.id))
}
