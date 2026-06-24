/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps, react-doctor/no-chain-state-updates, react-doctor/no-derived-state */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import { useEffect, useMemo, useState as useComponentState, type MouseEvent } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { usePageSearch } from "@/shared/ui/layout"
import {
  getProjectTeams,
  getTaskHours,
  type ProjectTeamOption,
  type TaskHours,
} from "@/infrastructure/api"
import { getMembers } from "@/features/members/api/member-api"
import { getTeams } from "@/features/teams/api/team-api"
import { useAuth } from "@/shared/providers/app"
import { canCreateTasks, canViewParticipationMetrics, isManagementRole, normalizeMemberRole } from "@/features/auth"
import { startTaskAssignment } from "@/features/tasks/api/task-assignments-api"
import { useTheme } from "@/shared/providers/app"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { useCachedMultiList } from "@/features/members/hooks"
import { hasCachedData, readCache, readMembersListCache } from "@/shared/tables/hooks/list-cache-registry"
import { toolbarEnter, viewSwitch } from "@/features/tasks/constants/motion"
import { TasksContentSkeleton } from "@/features/tasks/components/skeletons/tasks-skeleton"
import { TaskDetailPopover, openTaskPreviewAtClick, type TaskPreviewAnchor } from "@/features/tasks/components/task-detail-popover"
import { DndContext, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"

// Custom hooks, components, modals & helpers
import {
  type Task,
  type Member,
  type TaskStatus,
  type ViewMode,
  MEMBER_COLORS,
} from "@/features/projects/constants"
import { fetchTasksList, fetchProjectsList } from "@/features/tasks/api/api-helpers"
import { ProjectPickerDialog } from "@/features/tasks/components/project-picker-dialog"
import { TasksToolbar } from "@/features/tasks/components/tasks-toolbar"
import { useTaskMutations } from "@/features/tasks/hooks/use-task-mutations"
import { ListView } from "@/features/tasks/components/list-view"
import { BoardView } from "@/features/tasks/components/board-view"
import { TasksTimelineCalendar } from "@/features/tasks/components/tasks-timeline-calendar"
import { TaskWizardModal } from "@/features/tasks/components/modals/task-wizard-modal"
import { TaskHoursModal } from "@/features/tasks/components/modals/task-hours-modal"
import { TaskReviewModal } from "@/features/tasks/components/modals/task-review-modal"

const EMPTY_PROJECT_MEMBERS: Member[] = []

export function TasksPage() {
  const { isDark } = useTheme()
  const { memberId: currentMemberId, memberRole } = useAuth()
  const normalizedRole = normalizeMemberRole(memberRole ?? "")
  const canAddTask = canCreateTasks(memberRole)
  const showParticipation = canViewParticipationMetrics(memberRole)
  const canMarkCompleted = isManagementRole(memberRole)
  const t = isDark ? dark : light

  const [view, setView] = useComponentState<ViewMode>("list")
  const [selectedProjectId, setSelectedProjectId] = useComponentState<string>("")
  const [selectedTaskId, setSelectedTaskId] = useComponentState<string | null>(null)
  const [showCompleted, setShowCompleted] = useComponentState(false)
  const { query: search, setQuery: setSearch } = usePageSearch()
  const [syncPulse, setSyncPulse] = useComponentState(false)

  // Dialog & popover states
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useComponentState(false)
  const [isTaskModalOpen, setIsTaskModalOpen] = useComponentState(false)
  const [editingTaskId, setEditingTaskId] = useComponentState<string | null>(null)
  const [newTaskStatus, setNewTaskStatus] = useComponentState<TaskStatus>("todo")

  const [taskPreview, setTaskPreview] = useComponentState<{ taskId: string; anchor: TaskPreviewAnchor } | null>(null)

  const [hoursSubmissionOpen, setHoursSubmissionOpen] = useComponentState(false)
  const [hoursSubmissionTaskId, setHoursSubmissionTaskId] = useComponentState<string | null>(null)
  const [hoursSpent, setHoursSpent] = useComponentState("")
  const [taskHoursList, setTaskHoursList] = useComponentState<TaskHours[]>([])

  const [reviewDialogOpen, setReviewDialogOpen] = useComponentState(false)
  const [reviewTaskId, setReviewTaskId] = useComponentState<string | null>(null)

  const [allTeamsById, setAllTeamsById] = useComponentState<Record<string, string>>({})
  const [allMembers, setAllMembers] = useComponentState<Member[]>([])
  const [projectTeams, setProjectTeams] = useComponentState<ProjectTeamOption[]>([])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const {
    data: { projects: rawProjectList, tasks },
    setData: setTasksListData,
    isLoading,
    refetch: refetchTaskLists,
  } = useCachedMultiList({
    namespace: "pm-tasks",
    lists: {
      projects: { fetch: fetchProjectsList },
      tasks: { fetch: fetchTasksList },
    },
    loadingKey: "tasks",
    staleMs: 60_000,
    refetchIntervalMs: 50_000,
    refetchOnVisibility: true,
    backgroundRefetchKeys: ["tasks"],
    initialData: { projects: [], tasks: [] },
  })

  const setTasks = (value: Task[] | ((prev: Task[]) => Task[])): void => {
    setTasksListData("tasks", value)
  }

  // Mutations Hook
  const {
    deleteTask,
    updateTask,
    duplicateTask,
    handleSaveTaskForm,
    submitHoursSpent,
    submitReviewDecision,
  } = useTaskMutations({
    selectedProjectId,
    selectedTaskId,
    setSelectedTaskId,
    taskPreview,
    setTaskPreview,
    setTasks,
    setShowCompleted,
    currentMemberId,
    canMarkCompleted,
  })

  // Drag end callback for @dnd-kit
  function handleDragEnd(event: any) {
    const { active, over } = event
    if (!over) return
    const taskId = active.id
    const currentStatus = active.data.current?.status
    const targetStatus = (over.data?.current?.status || over.id) as TaskStatus

    if (currentStatus !== targetStatus && ["todo", "in_progress", "blocked", ...(canMarkCompleted ? ["done"] : [])].includes(targetStatus)) {
      void updateTask(taskId as string, { status: targetStatus, completed: targetStatus === "done" }).catch((err) => {
        console.error("Failed to update task status:", err)
      })
    }
  }

  // Initial loads — prefer bootstrap cache to avoid duplicate API round-trips
  useEffect(() => {
    let cancelled = false

    const mapMembers = (rows: Array<{ id: string; name?: string; avatar?: string; avatarColor?: string }>) =>
      rows.map((m, i) => {
        const name = m.name ?? "Unknown"
        const initials =
          name
            .split(/\s+/)
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase() || "??"
        return {
          id: m.id,
          name,
          avatar: m.avatar ?? initials,
          color: m.avatarColor ?? MEMBER_COLORS[i % MEMBER_COLORS.length]!,
        }
      })

    const cachedMembers = readMembersListCache<{ id: string; name?: string; avatar?: string; avatarColor?: string }>()
    if (cachedMembers?.length) {
      setAllMembers(mapMembers(cachedMembers))
      return
    }

    getMembers()
      .then((rows) => {
        if (cancelled) return
        setAllMembers(mapMembers(rows))
      })
      .catch(() => {
        if (!cancelled) setAllMembers([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const cachedTeams = readCache<Array<{ id: string; name: string }>>("people:teams")
    if (cachedTeams?.length) {
      setAllTeamsById(Object.fromEntries(cachedTeams.map((team) => [team.id, team.name])))
      return
    }

    getTeams()
      .then((teams) => {
        if (cancelled) return
        setAllTeamsById(Object.fromEntries(teams.map((team) => [team.id, team.name])))
      })
      .catch(() => {
        if (!cancelled) setAllTeamsById({})
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectTeams([])
      return
    }
    let cancelled = false
    getProjectTeams(selectedProjectId)
      .then((teams) => {
        if (cancelled) return
        setProjectTeams(teams)
      })
      .catch(() => {
        if (!cancelled) setProjectTeams([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedProjectId])

  const projectList = useMemo(() => {
    const privilegedRoles = new Set(["owner", "superadmin", "admin"])
    if (privilegedRoles.has(normalizedRole)) return rawProjectList
    if (!currentMemberId) return rawProjectList
    return rawProjectList.filter((p: any) =>
      p.members.some((m: Member) => m.id === currentMemberId)
    )
  }, [rawProjectList, normalizedRole, currentMemberId])

  useEffect(() => {
    if (projectList.length === 0) return
    if (!projectList.some((p: any) => p.id === selectedProjectId)) {
      setSelectedProjectId(projectList[0]!.id)
    }
  }, [projectList, selectedProjectId])

  const projectsCacheReady = hasCachedData("pm-tasks:projects")
  const activeProject =
    projectList.find((p: any) => p.id === selectedProjectId) ?? projectList[0] ?? null
  const projectMembers = activeProject?.members ?? EMPTY_PROJECT_MEMBERS

  const memberLookups = useMemo(() => {
    const byId = new Map<string, Member>()
    for (const member of allMembers) byId.set(member.id, member)
    for (const member of projectMembers) byId.set(member.id, member)
    return [...byId.values()]
  }, [allMembers, projectMembers])

  const projectTasks = useMemo(
    () => tasks.filter((task: Task) => task.projectId === selectedProjectId),
    [tasks, selectedProjectId],
  )

  const selectedTask = useMemo(
    () => projectTasks.find((task: Task) => task.id === selectedTaskId) ?? null,
    [projectTasks, selectedTaskId],
  )

  const previewTask = useMemo(
    () => (taskPreview ? projectTasks.find((task) => task.id === taskPreview.taskId) ?? null : null),
    [taskPreview, projectTasks],
  )

  const memberById = useMemo(
    () => new Map(memberLookups.map((member) => [member.id, member])),
    [memberLookups],
  )

  const formTeamOptions = useMemo(() => {
    const resolveName = (teamId: string, fallback: string) => allTeamsById[teamId] ?? fallback
    const byId = new Map<string, ProjectTeamOption>()
    for (const team of projectTeams) byId.set(team.id, team)
    for (const task of projectTasks) {
      if (task.teamId && !byId.has(task.teamId)) {
        byId.set(task.teamId, {
          id: task.teamId,
          name: resolveName(task.teamId, "Linked team"),
        })
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [projectTeams, projectTasks, allTeamsById])

  const teamNamesById = useMemo(
    () => Object.fromEntries(formTeamOptions.map((team) => [team.id, team.name])),
    [formTeamOptions],
  )

  function taskCreatorName(task: Task): string {
    const id = task.createdBy.trim()
    if (!id) return "Unknown"
    return memberById.get(id)?.name ?? "Unknown"
  }

  function handleTaskPreview(task: { id: string }, event: MouseEvent) {
    openTaskPreviewAtClick(task, event, ({ taskId, anchor }) => {
      setTaskPreview({ taskId, anchor })
      setSelectedTaskId(taskId)
    })
  }

  async function handleStartTask(task: Task) {
    const result = await startTaskAssignment(task.id)
    if (!result) return
    updateTask(task.id, {
      status: result.taskStatus as TaskStatus,
      completed: result.taskStatus === "done",
      totalAssignees: result.totalAssignees ?? task.totalAssignees ?? null,
      startedAssignees: result.startedAssignees ?? task.startedAssignees ?? null,
      notStartedAssignees: result.notStartedAssignees ?? task.notStartedAssignees ?? null,
      participationPercent: result.participationPercent ?? task.participationPercent ?? null,
      allAssigneesStarted: result.allAssigneesStarted ?? task.allAssigneesStarted,
    })
    void refetchTaskLists()
  }

  useEffect(() => {
    setSelectedTaskId(null)
    setTaskPreview(null)
  }, [selectedProjectId])

  function addTask() {
    if (!canAddTask) return
    setEditingTaskId(null)
    setNewTaskStatus("todo")
    setIsProjectPickerOpen(true)
  }

  function openTaskModal(status: TaskStatus = "todo") {
    setEditingTaskId(null)
    setNewTaskStatus(status)
    if (!selectedProjectId) {
      setIsProjectPickerOpen(true)
    } else {
      setIsTaskModalOpen(true)
    }
  }

  function openEditTaskModal(task: Task) {
    setEditingTaskId(task.id)
    setIsTaskModalOpen(true)
  }

  function duplicateSelectedTask() {
    if (!selectedTask) return
    duplicateTask(selectedTask)
  }

  function handleSync() {
    setSyncPulse(true)
    void refetchTaskLists({ forceRefetch: true, keys: ["tasks"] }).finally(() => {
      setTimeout(() => setSyncPulse(false), 600)
    })
  }

  // Hours submission functions
  function openHoursSubmission(taskId: string) {
    setHoursSubmissionTaskId(taskId)
    setHoursSpent("")
    setHoursSubmissionOpen(true)
    loadTaskHours(taskId)
  }

  async function loadTaskHours(taskId: string) {
    try {
      const hours = await getTaskHours(taskId)
      setTaskHoursList(hours)
    } catch (error) {
      console.error("Failed to load task hours:", error)
    }
  }

  async function onSaveHours(hours: number) {
    if (!hoursSubmissionTaskId) return
    await submitHoursSpent(hoursSubmissionTaskId, hours, taskHoursList)
    await loadTaskHours(hoursSubmissionTaskId)
  }

  // Review functions
  function openReviewDialog(taskId: string) {
    setReviewTaskId(taskId)
    setReviewDialogOpen(true)
  }

  async function onSaveReview(decision: "approved" | "rejected") {
    if (!reviewTaskId) return
    await submitReviewDecision(reviewTaskId, decision)
  }

  const projectsReady = !isLoading && projectsCacheReady
  const showContentSkeleton =
    (isLoading || !projectsCacheReady) && rawProjectList.length === 0 && tasks.length === 0

  return (
    <motion.div className="flex h-full min-h-0 flex-col overflow-hidden">
      <motion.div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2" {...toolbarEnter}>
        {!projectsReady && !showContentSkeleton ? (
          <motion.div
            className={cn(
              "flex flex-1 flex-col items-center justify-center rounded-xl border px-6 text-center",
              isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-100 bg-white",
            )}
          >
            <p className={cn("text-sm font-medium", t.tableCell)}>No projects yet</p>
            <p className={cn("mt-1 text-xs", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
              Create a project first, then add tasks here.
            </p>
          </motion.div>
        ) : (
          <>
            <TasksToolbar
              selectedProjectId={selectedProjectId}
              setSelectedProjectId={setSelectedProjectId}
              projectList={projectList}
              search={search}
              setSearch={setSearch}
              view={view}
              setView={setView}
              showCompleted={showCompleted}
              setShowCompleted={setShowCompleted}
              selectedTask={selectedTask}
              projectTeams={projectTeams}
              memberLookups={memberLookups}
              projectMembers={projectMembers}
              isDark={isDark}
              t={t}
              updateTask={updateTask}
              openEditTaskModal={openEditTaskModal}
              duplicateSelectedTask={duplicateSelectedTask}
              canAddTask={canAddTask}
              addTask={addTask}
              syncPulse={syncPulse}
              handleSync={handleSync}
            />

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {showContentSkeleton ? (
                <TasksContentSkeleton isDark={isDark} fillHeight />
              ) : (
                <AnimatePresence mode="wait">
                  <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
                    <motion.div key={view} {...viewSwitch} className="flex min-h-0 flex-1 flex-col">
                    {view === "list" && (
                      <ListView
                        tasks={projectTasks}
                        members={projectMembers}
                        teamNamesById={teamNamesById}
                        selectedTaskId={selectedTaskId}
                        onSelectTask={setSelectedTaskId}
                        onTaskPreview={handleTaskPreview}
                        onDelete={deleteTask}
                        onUpdate={updateTask}
                        onEdit={openEditTaskModal}
                        onDuplicate={duplicateTask}
                        showCompleted={showCompleted}
                        search={search}
                        isDark={isDark}
                        onAddTask={openTaskModal}
                        onSubmitHours={openHoursSubmission}
                        onReview={openReviewDialog}
                        onStartTask={handleStartTask}
                        showParticipation={showParticipation}
                        canMarkCompleted={canMarkCompleted}
                      />
                    )}
                    {view === "board" && (
                      <BoardView
                        tasks={projectTasks}
                        members={projectMembers}
                        teamNamesById={teamNamesById}
                        selectedTaskId={selectedTaskId}
                        onSelectTask={setSelectedTaskId}
                        onTaskPreview={handleTaskPreview}
                        onDelete={deleteTask}
                        onUpdate={updateTask}
                        onEdit={openEditTaskModal}
                        onDuplicate={duplicateTask}
                        showCompleted={showCompleted}
                        search={search}
                        isDark={isDark}
                        onAddTask={openTaskModal}
                        onSubmitHours={openHoursSubmission}
                        onReview={openReviewDialog}
                        canMarkCompleted={canMarkCompleted}
                      />
                    )}
                    {view === "timeline" && (
                      <TasksTimelineCalendar
                        tasks={projectTasks}
                        members={projectMembers}
                        showCompleted={showCompleted}
                        search={search}
                        isDark={isDark}
                        onTaskPreview={handleTaskPreview}
                      />
                    )}
                    </motion.div>
                  </DndContext>
                </AnimatePresence>
              )}
            </div>
          </>
        )}
      </motion.div>

      <ProjectPickerDialog
        open={isProjectPickerOpen}
        onOpenChange={setIsProjectPickerOpen}
        isDark={isDark}
        projectList={projectList}
        selectedProjectId={selectedProjectId}
        setSelectedProjectId={setSelectedProjectId}
        onConfirm={() => setIsTaskModalOpen(true)}
      />

      {/* Task Wizard Modal */}
      {isTaskModalOpen && (
        <TaskWizardModal
          open={isTaskModalOpen}
          onClose={() => {
            setIsTaskModalOpen(false)
            setEditingTaskId(null)
          }}
          onSave={handleSaveTaskForm}
          isDark={isDark}
          task={editingTaskId ? tasks.find((t) => t.id === editingTaskId) ?? null : null}
          projectId={selectedProjectId}
          projectTeams={projectTeams}
          projectMembers={projectMembers}
          allMembers={allMembers}
          allTeamsById={allTeamsById}
          initialStatus={newTaskStatus}
        />
      )}

      {/* Hours Submission Modal */}
      {hoursSubmissionOpen && (
        <TaskHoursModal
          open={hoursSubmissionOpen}
          onClose={() => setHoursSubmissionOpen(false)}
          onSave={onSaveHours}
          isDark={isDark}
          taskHoursList={taskHoursList}
        />
      )}

      {/* Task Review Modal */}
      {reviewDialogOpen && (
        <TaskReviewModal
          open={reviewDialogOpen}
          onClose={() => setReviewDialogOpen(false)}
          onSave={onSaveReview}
          isDark={isDark}
        />
      )}

      <TaskDetailPopover
        open={!!taskPreview && !!previewTask}
        anchor={taskPreview?.anchor ?? null}
        title={previewTask?.title ?? ""}
        description={previewTask?.description ?? ""}
        startDate={previewTask?.startDate}
        dueDate={previewTask?.dueDate}
        creatorName={previewTask ? taskCreatorName(previewTask) : ""}
        isDark={isDark}
        onClose={() => setTaskPreview(null)}
      />
    </motion.div>
  )
}
