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
      await refetchProjects()
      setSelected((prev) => {
        const s = new Set(prev)
        s.delete(id)
        return s
      })
    } catch (err) {
      console.error("Failed to archive project:", err)
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
        { budgetId: editingBudgetId },
      )
    } else {
      for (const payload of payloads) {
        await createProjectWithDetails(payload, actor)
      }
    }
    await refetchProjects()
  }

  return {
    archiveProject,
    deleteProject,
    saveProject,
  }
}
