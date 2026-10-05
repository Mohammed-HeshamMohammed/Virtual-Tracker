"use client"

import { useRef } from "react"
import {
  archiveProject as archiveProjectApi,
  deleteProject as deleteProjectApi,
  updateProjectWithDetails,
  createProjectWithDetails,
  type CreateProjectFormPayload,
} from "@/infrastructure/api"
import type { ProjectListItem as Project } from "@/features/projects/models/list"
import { buildProjectRules } from "@/features/projects/utils/project-rules"

function computeOptimisticMemberIds(payload: CreateProjectFormPayload): string[] {
  return [
    ...new Set(
      [...payload.managerIds, ...payload.userIds, ...payload.viewerIds]
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ]
}

function computeOptimisticBudget(
  prev: Project["budget"],
  payload: CreateProjectFormPayload,
): Project["budget"] {
  const hasType = Boolean(payload.budgetType.trim())
  if (!hasType) return prev
  const type: "hours" | "cost" = payload.budgetType === "Hours based" ? "hours" : "cost"
  const rawTotal = Number(payload.budgetTotal)
  if (!Number.isFinite(rawTotal)) return prev

  if (payload.budgetScope !== "per_person") {
    return { spent: prev?.spent ?? 0, total: rawTotal, type }
  }
  if (type === "hours") {
    const memberCount = computeOptimisticMemberIds(payload).length || 1
    return { spent: prev?.spent ?? 0, total: rawTotal * memberCount, type }
  }
  return prev
}

function applyOptimisticProjectEdit(prev: Project, payload: CreateProjectFormPayload): Project {
  const memberIds = computeOptimisticMemberIds(payload)
  return {
    ...prev,
    name: payload.name,
    memberIds,
    members: memberIds.length,
    budget: computeOptimisticBudget(prev.budget, payload),
    rules: buildProjectRules({
      allowProjectTracking: payload.allowProjectTracking,
      restrictManagerTracking: payload.restrictManagerTracking,
      managerIds: payload.managerIds,
      trackingAllowedManagerIds: payload.trackingAllowedManagerIds,
      requireTaskToTrack: payload.requireTaskToTrack,
      restrictTaskCreation: payload.restrictTaskCreation,
      requireStopNote: payload.requireStopNote,
      clientCanManage: payload.clientCanManage,
      clientCanTrack: payload.clientCanTrack,
      // A viewer who can't see the Management tab sends no switches - keep what the row showed.
      ...(payload.rules ?? switchesFromRules(prev.rules)),
    }),
  }
}

/** The Management switches as a row's existing summary records them. */
function switchesFromRules(rules: Project["rules"]) {
  if (!rules) return {}
  const locked = new Set(rules.lockedForManagers ?? [])
  return {
    budgetEnabled: !rules.budgetOff,
    memberLimitsEnabled: !rules.memberLimitsOff,
    managersCanEditBudget: !locked.has("budget"),
    managersCanEditMemberLimits: !locked.has("member limits"),
    managersCanEditMembers: !locked.has("members"),
  }
}

interface UseProjectMutationsProps {
  data: Project[]
  refetchProjects: (options?: { forceRefetch?: boolean }) => Promise<void>
  setProjects: (value: Project[] | ((prev: Project[]) => Project[])) => void
  setSelected: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  user: any
  memberId?: string | null
  canManageProjects: boolean
  /** Shown to the user when a change could not be saved. */
  onError?: (message: string) => void
}

function errorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message.trim() : ""
  return message || fallback
}

export function useProjectMutations({
  data,
  refetchProjects,
  setProjects,
  setSelected,
  user,
  memberId,
  canManageProjects,
  onError,
}: UseProjectMutationsProps) {
  const deletingIdsRef = useRef(new Set<string>())
  const archivingIdsRef = useRef(new Set<string>())

  async function archiveProject(id: string) {
    if (!canManageProjects) return
    if (archivingIdsRef.current.has(id)) return
    const project = data.find((p) => p.id === id)
    if (!project) return
    const nextArchived = project.status === "active"
    const nextStatus: Project["status"] = nextArchived ? "archived" : "active"
    archivingIdsRef.current.add(id)
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, status: nextStatus } : p)))
    try {
      // archived_by/updated_by are member UUID columns. Firebase's account
      // uid is not that identifier and made restore fail in Postgres.
      await archiveProjectApi(id, nextArchived, memberId ?? undefined)
      await refetchProjects({ forceRefetch: true })
      setSelected((prev) => {
        const s = new Set(prev)
        s.delete(id)
        return s
      })
    } catch (err) {
      console.error("Failed to archive project:", err)
      onError?.(errorText(err, "Could not " + (nextArchived ? "archive" : "restore") + " " + project.name + "."))
      setProjects((prev) => prev.map((p) => (p.id === id ? project : p)))
      await refetchProjects({ forceRefetch: true }).catch(() => undefined)
    } finally {
      archivingIdsRef.current.delete(id)
    }
  }

  async function batchArchive(ids: string[]) {
    if (!canManageProjects || ids.length === 0) return
    const byId = new Map(data.map((p) => [p.id, p]))
    const targets = ids.flatMap((id) => {
      const project = byId.get(id)
      return project ? [{ id, project, archive: project.status === "active" }] : []
    })
    setProjects((prev) =>
      prev.map((project) => {
        const target = targets.find((item) => item.id === project.id)
        return target ? { ...project, status: target.archive ? "archived" : "active" } : project
      }),
    )
    const results = await Promise.allSettled(
      targets.map(({ id, archive }) => archiveProjectApi(id, archive, memberId ?? undefined)),
    )
    const succeeded = new Set<string>()
    results.forEach((result, index) => {
      const target = targets[index]!
      if (result.status === "fulfilled") {
        succeeded.add(target.id)
        return
      }
      console.error(`Failed to archive project ${target.id}:`, result.reason)
      onError?.(
        errorText(
          result.reason,
          `Could not ${target.archive ? "archive" : "restore"} ${target.project.name}.`,
        ),
      )
    })
    await refetchProjects({ forceRefetch: true })
    setSelected((prev) => {
      const s = new Set(prev)
      for (const id of succeeded) s.delete(id)
      return s
    })
  }

  async function batchDelete(ids: string[]) {
    if (!canManageProjects || ids.length === 0) return
    const idSet = new Set(ids)
    const nameById = new Map(data.map((p) => [p.id, p.name]))
    setProjects((prev) => prev.filter((p) => !idSet.has(p.id)))
    setSelected((prev) => {
      const s = new Set(prev)
      for (const id of ids) s.delete(id)
      return s
    })
    try {
      await Promise.all(
        ids.map((id) =>
          deleteProjectApi(id).catch((err) => {
            console.error(`Failed to delete project ${id}:`, err)
            onError?.(errorText(err, "Could not delete " + (nameById.get(id) ?? "the project") + "."))
          }),
        ),
      )
    } finally {
      await refetchProjects({ forceRefetch: true })
    }
  }

  async function deleteProject(id: string) {
    if (!canManageProjects) return
    if (deletingIdsRef.current.has(id)) return
    deletingIdsRef.current.add(id)

    setProjects((prev) => prev.filter((p) => p.id !== id))
    setSelected((prev) => {
      const s = new Set(prev)
      s.delete(id)
      return s
    })

    try {
      await deleteProjectApi(id)
      await refetchProjects({ forceRefetch: true })
    } catch (err) {
      console.error("Failed to delete project:", err)
      // The row comes back on the refetch, so say why rather than let it
      // reappear with no explanation.
      onError?.(errorText(err, "Could not delete " + (data.find((p) => p.id === id)?.name ?? "the project") + "."))
      await refetchProjects({ forceRefetch: true })
    } finally {
      deletingIdsRef.current.delete(id)
    }
  }

  async function saveProject(
    editingProjectId: string | null,
    payloads: CreateProjectFormPayload[],
    editingBudgetId?: string,
    expectedUpdatedAt?: string,
    expectedBudgetUpdatedAt?: string,
  ) {
    if (!canManageProjects) return
    const actor = {
      firebaseUid: user?.uid,
      email: user?.email ?? undefined,
      memberId: memberId ?? undefined,
    }
    if (editingProjectId) {
      await updateProjectWithDetails(
        editingProjectId,
        payloads[0]!,
        actor,
        { budgetId: editingBudgetId, expectedUpdatedAt, expectedBudgetUpdatedAt },
      )
      setProjects((prev) =>
        prev.map((p) => (p.id === editingProjectId ? applyOptimisticProjectEdit(p, payloads[0]!) : p)),
      )
      void refetchProjects({ forceRefetch: true }).catch((err) => {
        console.error("Failed to refresh projects after save:", err)
      })
    } else {
      await Promise.all(payloads.map((payload) => createProjectWithDetails(payload, actor)))
      await refetchProjects({ forceRefetch: true })
    }
  }

  return {
    archiveProject,
    deleteProject,
    saveProject,
    batchArchive,
    batchDelete,
  }
}
