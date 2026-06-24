/* eslint-disable react-doctor/js-combine-iterations */
import { getMembers } from "@/features/members/api/member-api"
import { getTeamMembers, getTeams, type Team } from "@/features/teams/api/team-api"

const ADMIN_ROLES = new Set([
  "superadmin",
  "admin",
  "owner",
  "manager",
  "supermanager",
  "supermanger",
])

function normalizeRole(role: string): string {
  return role.toLowerCase().replace(/\s+/g, "")
}

/** Teams visible to the signed-in user (all teams for admins; membership-only for others). */
export async function fetchUserTeams(firebaseUid?: string, email?: string): Promise<Team[]> {
  const [teams, teamMembers, members] = await Promise.all([
    getTeams(),
    getTeamMembers(),
    getMembers(),
  ])

  const currentMember = members.find(
    (m) =>
      (firebaseUid && m.firebaseUid === firebaseUid) ||
      (email && m.email.toLowerCase() === email.toLowerCase()),
  )

  if (!currentMember) return teams

  if (ADMIN_ROLES.has(normalizeRole(currentMember.role ?? ""))) {
    return teams
  }

// eslint-disable-next-line react-doctor/js-combine-iterations
  const userTeamIds = new Set(
    teamMembers.filter((tm) => tm.member_id === currentMember.id).map((tm) => tm.team_id),
  )

  return teams.filter((t) => userTeamIds.has(t.id))
}
