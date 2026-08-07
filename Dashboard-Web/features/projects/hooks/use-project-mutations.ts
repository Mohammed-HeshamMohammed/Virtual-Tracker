/* eslint-disable react-doctor/async-await-in-loop */
/* eslint-disable react-doctor/prefer-module-scope-pure-function */
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
    // Exact - per_project total is just the typed value, same as the
    // server's `target` (which equals `cost` for this scope).
    return { spent: prev?.spent ?? 0, total: rawTotal, type }
  }
  if (type === "hours") {
    // Exact - hours-per-member x headcount needs no rate lookup.
    const memberCount = computeOptimisticMemberIds(payload).length || 1
    return { spent: prev?.spent ?? 0, total: rawTotal * memberCount, type }
  }
  // Cost based + per_person converts hours-per-member to cost using each
  // member's own rate, server-side - not derivable here, so leave the
  // prior total until the background refetch resolves the real one.
  return prev
}

/** Best-effort local patch applied right after a save succeeds, so the row
 * reflects the edit immediately instead of waiting on the full-context
 * refetch (budgets/members/teams/limits/overview) that used to block the
 * modal from closing. Fields this can't compute exactly client-side (team
 * badge names, per-person cost totals) are left as-is for that refetch to
 * correct moments later. */
function applyOptimisticProjectEdit(prev: Project, payload: CreateProjectFormPayload): Project {
  const memberIds = computeOptimisticMemberIds(payload)
  return {
    ...prev,
    name: payload.name,
    memberIds,
    members: memberIds.length,
    budget: computeOptimisticBudget(prev.budget, payload),
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
}

export function useProjectMutations({
  data,
  refetchProjects,
  setProjects,
  setSelected,
  user,
  memberId,
  canManageProjects,
}: UseProjectMutationsProps) {
  const deletingIdsRef = useRef(new Set<string>())

  async function archiveProject(id: string) {
    if (!canManageProjects) return
    const project = data.find((p) => p.id === id)
    if (!project) return
    const nextArchived = project.status === "active"
    try {
      await archiveProjectApi(id, nextArchived, user?.uid)
      await refetchProjects({ forceRefetch: true })
      setSelected((prev) => {
        const s = new Set(prev)
        s.delete(id)
        return s
      })
    } catch (err) {
      console.error("Failed to archive project:", err)
    }
  }

  async function batchArchive(ids: string[]) {
    if (!canManageProjects || ids.length === 0) return
    const byId = new Map(data.map((p) => [p.id, p]))
    // Each item toggles its own current status - same semantics as the
    // single-row action - so this reads as "archive" when run from the
    // Active tab and "unarchive" from the Archived tab.
    await Promise.all(
      ids.map((id) => {
        const project = byId.get(id)
        if (!project) return Promise.resolve()
        return archiveProjectApi(id, project.status === "active", user?.uid).catch((err) => {
          console.error(`Failed to archive project ${id}:`, err)
        })
      }),
    )
    await refetchProjects({ forceRefetch: true })
    setSelected((prev) => {
      const s = new Set(prev)
      for (const id of ids) s.delete(id)
      return s
    })
  }

  async function batchDelete(ids: string[]) {
    if (!canManageProjects || ids.length === 0) return
    const idSet = new Set(ids)
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
      // §6.9 - a 409 here (stale write) is deliberately left to propagate:
      // the modal's own submit handler shows the reload/keep-editing
      // banner, same as a live update arriving while the form was open.
      await updateProjectWithDetails(
        editingProjectId,
        payloads[0]!,
        actor,
        { budgetId: editingBudgetId, expectedUpdatedAt, expectedBudgetUpdatedAt },
      )
      setProjects((prev) =>
        prev.map((p) => (p.id === editingProjectId ? applyOptimisticProjectEdit(p, payloads[0]!) : p)),
      )
      // Reconciles what the optimistic patch above couldn't compute exactly
      // (team badge names, per-person cost totals, real spent) - runs after
      // save instead of blocking the modal from closing on it, which used
      // to be most of the perceived "Save changes" latency.
      void refetchProjects({ forceRefetch: true }).catch((err) => {
        console.error("Failed to refresh projects after save:", err)
      })
    } else {
      // Each name creates a fully independent project - no ordering
      // dependency between them, so a multi-name paste creates them
      // concurrently instead of one full create chain per name, serially.
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
