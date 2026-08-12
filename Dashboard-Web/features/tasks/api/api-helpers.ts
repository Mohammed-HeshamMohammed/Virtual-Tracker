/* eslint-disable react-doctor/js-combine-iterations */
import { getProjects, getProjectMembers, getTasks } from "@/infrastructure/api"
import { getMembers } from "@/features/members/api/member-api"
import { readCache } from "@/shared/tables/hooks/list-cache-registry"
import {
  type Task,
  type TaskStatus,
  TASK_PROJECT_COLORS,
  MEMBER_COLORS,
} from "@/features/projects/constants"

function mapApiTask(row: Record<string, unknown>): Task {
  const durationHoursPerDayRaw = row.durationHoursPerDay ?? row.duration_hours_per_day
  const durationHoursPerDay =
    durationHoursPerDayRaw === null || durationHoursPerDayRaw === undefined || durationHoursPerDayRaw === ""
      ? null
      : Number(durationHoursPerDayRaw)
  
  const durationDaysRaw = row.durationDays ?? row.duration_days
  const durationDays =
    durationDaysRaw === null || durationDaysRaw === undefined || durationDaysRaw === ""
      ? null
      : Number(durationDaysRaw)
  
  const overtimeHoursPerDayRaw = row.overtimeHoursPerDay ?? row.overtime_hours_per_day
  const overtimeHoursPerDay =
    overtimeHoursPerDayRaw === null || overtimeHoursPerDayRaw === undefined || overtimeHoursPerDayRaw === ""
      ? null
      : Number(overtimeHoursPerDayRaw)
  
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? "Untitled task"),
    description: String(row.description ?? ""),
    status: (row.status ?? "todo") as TaskStatus,
    priority: (row.priority ?? "medium") as any,
    orderIndex: Number(row.orderIndex ?? row.order_index ?? 0),
    assignedTo: (row.assignedTo as string) || (row.assigned_to as string) || null,
    assigneeIds: Array.isArray(row.assigneeIds)
      ? (row.assigneeIds as string[])
      : Array.isArray(row.assignee_ids)
        ? (row.assignee_ids as string[])
        : undefined,
    projectId: String(row.projectId ?? row.project_id ?? "p1"),
    teamId: (row.teamId as string) || (row.team_id as string) || null,
    durationHoursPerDay: Number.isFinite(durationHoursPerDay) ? durationHoursPerDay : null,
    durationDays: Number.isFinite(durationDays) ? durationDays : null,
    overtimeHoursPerDay: Number.isFinite(overtimeHoursPerDay) ? overtimeHoursPerDay : null,
    rollingHourCap: (row.rollingHourCap ?? row.rolling_hour_cap) === true,
    sharedTaskBudget: (row.sharedTaskBudget ?? row.shared_task_budget) === true,
    startDate: (row.startDate as string) || (row.start_date as string) || null,
    dueDate: (row.dueDate as string) || (row.due_date as string) || null,
    completed: (row.status ?? "todo") === "done",
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
    createdBy: String(row.createdBy ?? row.created_by ?? ""),
    updatedBy: String(row.updatedBy ?? row.updated_by ?? ""),
    reviewState: asStringOrNull(row.reviewState ?? row.review_state),
    reviewedBy: asStringOrNull(row.reviewedBy ?? row.reviewed_by),
    reviewedAt: asStringOrNull(row.reviewedAt ?? row.reviewed_at),
    totalAssignees: asNumberOrNull(row.totalAssignees ?? row.total_assignees),
    startedAssignees: asNumberOrNull(row.startedAssignees ?? row.started_assignees),
    notStartedAssignees: asNumberOrNull(row.notStartedAssignees ?? row.not_started_assignees),
    participationPercent: asNumberOrNull(row.participationPercent ?? row.participation_percent),
    allAssigneesStarted: row.allAssigneesStarted === true || row.all_assignees_started === true,
    updatedAt: asStringOrNull(row.updatedAt ?? row.updated_at) ?? undefined,
  }
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function asStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  return String(value)
}

function mapApiProject(row: Record<string, unknown>, idx: number): any {
  return {
    id: String(row.id ?? `p-${idx}`),
    name: String(row.name ?? `Project ${idx + 1}`),
    color: TASK_PROJECT_COLORS[idx % TASK_PROJECT_COLORS.length]!,
    members: ((row.members as Array<{ id: string; name: string; avatar: string; color: string }> | undefined) ?? []).map((m, i) => ({
      id: String(m.id ?? `m-${idx}-${i}`),
      name: String(m.name ?? `Member ${i + 1}`),
      avatar: String(m.avatar ?? m.name?.[0] ?? "M"),
      color: String(m.color ?? MEMBER_COLORS[i % MEMBER_COLORS.length]),
    })),
  }
}

export async function fetchTasksList(): Promise<Task[]> {
  const rows = await getTasks(undefined, {
    fields: [
      "id",
      "title",
      "description",
      "status",
      "priority",
      "order_index",
      "assigned_to",
      "assignee_ids",
      "project_id",
      "team_id",
      "duration_hours_per_day",
      "duration_days",
      "overtime_hours_per_day",
      "rolling_hour_cap",
      "shared_task_budget",
      "start_date",
      "due_date",
      "created_at",
      "created_by",
      "updated_by",
      "review_state",
      "reviewed_by",
      "reviewed_at",
      "total_assignees",
      "started_assignees",
      "not_started_assignees",
      "participation_percent",
      "all_assignees_started",
      "updated_at",
    ],
  })
  return (rows ?? []).map((r) => mapApiTask(r as unknown as Record<string, unknown>))
}

/** Build tasks-page project list from bootstrap cache (avoids duplicate API round-trips). */
export function buildProjectsListForTasks(
  projectRows: Array<{ id: string; name?: string; status?: string }>,
  memberIdsByProject: Map<string, string[]>,
  members: Array<{ id: string; name?: string; avatar?: string; avatarColor?: string }>,
): any[] {
  const memberById = new Map(members.map((m) => [m.id, m]))

  return projectRows
    .filter((row) => row.status !== "archived")
    .map((row, i) => {
      const projectId = String(row.id ?? "")
      const memberIds = memberIdsByProject.get(projectId) ?? []
      const projectMembers = memberIds.map((memberId, j) => {
        const m = memberById.get(memberId)
        const name = m?.name ?? "Unknown"
        const initials =
          name
            .split(/\s+/)
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase() || "??"
        return {
          id: memberId,
          name,
          avatar: m?.avatar ?? initials,
          color: m?.avatarColor ?? MEMBER_COLORS[j % MEMBER_COLORS.length]!,
        }
      })
      return {
        id: projectId,
        name: String(row.name ?? `Project ${i + 1}`),
        color: TASK_PROJECT_COLORS[i % TASK_PROJECT_COLORS.length]!,
        members: projectMembers,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function fetchProjectsList(): Promise<any[]> {
  const cached = readCache<any[]>("pm-tasks:projects")
  if (cached && cached.length > 0) return cached

  const [rows, links, allMembers] = await Promise.all([
    getProjects({ fields: ["id", "name", "status", "type"] }),
    getProjectMembers(undefined, { fields: ["id", "project_id", "member_id", "project_role"] }),
    getMembers({ fields: ["id", "first_name", "last_name", "name", "avatar", "avatar_url", "avatar_color"] }),
  ])
  const memberById = new Map(allMembers.map((m) => [m.id, m]))

// eslint-disable-next-line react-doctor/js-combine-iterations
  return (rows ?? [])
    .filter((row) => row.status !== "archived")
    .map((row, i) => {
      const projectId = String(row.id ?? "")
      const members = links
        .filter((link) => link.projectId === projectId)
        .map((link, j) => {
          const m = memberById.get(link.memberId)
          const name = m?.name ?? "Unknown"
          const initials =
            name
              .split(/\s+/)
              .map((p) => p[0])
              .join("")
              .slice(0, 2)
              .toUpperCase() || "??"
          return {
            id: link.memberId,
            name,
            avatar: m?.avatar ?? initials,
            color: m?.avatarColor ?? MEMBER_COLORS[j % MEMBER_COLORS.length]!,
          }
        })
      return {
        id: projectId,
        name: String(row.name ?? `Project ${i + 1}`),
        type: row.type ?? "normal",
        color: TASK_PROJECT_COLORS[i % TASK_PROJECT_COLORS.length]!,
        members,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
