/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { motion } from "framer-motion"
import { Search, List, LayoutGrid, Calendar, Pencil, Copy, Plus } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { SearchableSelectField } from "@/shared/ui/forms/searchable-select-field"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { TaskAssignButton } from "@/features/tasks/components/task-assign-button"
import { SyncAutorenewIcon } from "@/features/tasks/components/sync-autorenew-icon"
import type { Task, ViewMode, Member } from "@/features/projects/constants"
import type { ProjectTeamOption } from "@/infrastructure/api"

interface TasksToolbarProps {
  selectedProjectId: string
  setSelectedProjectId: (id: string) => void
  projectList: any[]
  search: string
  setSearch: (s: string) => void
  view: ViewMode
  setView: (v: ViewMode) => void
  showCompleted: boolean
  setShowCompleted: (s: boolean) => void
  selectedTask: Task | null
  projectTeams: ProjectTeamOption[]
  memberLookups: Member[]
  projectMembers: Member[]
  isDark: boolean
  t: {
    searchWrap: string
    searchIcon: string
    searchInput: string
    tabActive: string
    tabInactive: string
    btnSecondary: string
    btnPrimary: string
  }
  updateTask: (taskId: string, fields: any) => void
  openEditTaskModal: (task: Task) => void
  duplicateSelectedTask: () => void
  canAddTask: boolean
  addTask: () => void
  syncPulse: boolean
  handleSync: () => void
}
const VIEW_TABS: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
    { mode: "list", icon: <List className="h-4 w-4" />, label: "List" },
    { mode: "board", icon: <LayoutGrid className="h-4 w-4" />, label: "Board" },
    { mode: "timeline", icon: <Calendar className="h-4 w-4" />, label: "Calendar" },
  ]

export function TasksToolbar({
  selectedProjectId,
  setSelectedProjectId,
  projectList,
  search,
  setSearch,
  view,
  setView,
  showCompleted,
  setShowCompleted,
  selectedTask,
  projectTeams,
  memberLookups,
  projectMembers,
  isDark,
  t,
  updateTask,
  openEditTaskModal,
  duplicateSelectedTask,
  canAddTask,
  addTask,
  syncPulse,
  handleSync,
}: TasksToolbarProps) {
  return (
    <motion.div layout className="mb-4 flex shrink-0 items-center justify-between gap-4">
      <motion.div className="flex min-w-0 flex-wrap items-center gap-3">
        <SearchableSelectField
          value={selectedProjectId}
          onChange={(v) => {
            if (v) {
              setSelectedProjectId(v)
            }
          }}
          placeholder="Project"
          className="w-37 shrink-0 sm:w-45"
          menuMinWidth={288}
          visibleOptionRows={5}
          truncateOptions={false}
          isDark={isDark}
          options={projectList.map((p: any) => ({
            value: p.id,
            label: p.name,
            meta: <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />,
          }))}
        />
        <div className={cn("relative w-44 shrink-0 rounded-lg border sm:w-52", t.searchWrap)}>
          <Search className={cn("absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2", t.searchIcon)} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className={cn("w-full bg-transparent py-1.5 pl-8 pr-3 text-sm focus:outline-none", t.searchInput)} aria-label="Interactive control"
          />
        </div>
      </motion.div>

      <motion.div layout className="flex items-center gap-2">
        <motion.div
          layout
          className={cn("inline-flex shrink-0 gap-1 rounded-xl p-1", isDark ? "bg-[#191f31]" : "bg-slate-100")}
        >
          {VIEW_TABS.map(({ mode, icon, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              aria-label={label}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all",
                view === mode ? t.tabActive : t.tabInactive,
              )}
            >
              {icon}
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </motion.div>
        <button
          type="button"
          role="switch"
          aria-checked={showCompleted}
          onClick={() => setShowCompleted(!showCompleted)}
          className={cn(
            "shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none",
            showCompleted
              ? isDark
                ? "bg-[#4be277] text-[#0c1324]"
                : "bg-emerald-500 text-white"
              : isDark
                ? "bg-[#0c1324]/90 text-[#5c6578]"
                : "bg-slate-100 text-slate-400",
          )}
        >
          Completed
        </button>
      </motion.div>

      <motion.div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <TaskAssignButton
          selectedTask={selectedTask}
          projectTeams={projectTeams}
          memberLookups={memberLookups}
          directProjectMembers={projectMembers}
          isDark={isDark}
          onAssign={async ({ teamId, assignedTo, assigneeIds }) => {
            if (!selectedTask) return
            await updateTask(selectedTask.id, { teamId, assignedTo, assigneeIds } as Partial<Task>)
          }}
        />
        <IconTooltip text="Edit task" placement="bottom">
          <button
            type="button"
            disabled={!selectedTask}
            onClick={() => selectedTask && openEditTaskModal(selectedTask)}
            aria-label="Edit task"
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              t.btnSecondary,
            )}
          >
            <Pencil className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Edit</span>
          </button>
        </IconTooltip>
        <IconTooltip
          text={selectedTask ? "Duplicate selected task" : "Select a task first"}
          placement="bottom"
        >
          <button
            type="button"
            disabled={!selectedTask}
            onClick={() => selectedTask && duplicateSelectedTask()}
            aria-label="Duplicate task"
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              t.btnSecondary,
            )}
          >
            <Copy className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Duplicate</span>
          </button>
        </IconTooltip>
        {canAddTask && (
          <button
            type="button"
            onClick={addTask}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
              t.btnPrimary,
            )}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Add task</span>
          </button>
        )}
        <div
          className={cn(
            "inline-flex shrink-0 rounded-xl p-1",
            isDark ? "bg-[#191f31]" : "bg-slate-100",
          )}
        >
          <IconTooltip
            text={syncPulse ? "Syncing now" : "Sync tasks"}
            isDark={isDark}
          >
            <button
              type="button"
              onClick={handleSync}
              aria-label="Sync tasks"
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium",
                isDark ? "text-[#bccbb9]" : "text-slate-700",
              )}
            >
              <motion.span
                animate={syncPulse ? { rotate: 360 } : {}}
                transition={{ duration: 0.6 }}
                className="inline-flex"
              >
                <SyncAutorenewIcon />
              </motion.span>
              <span className="hidden lg:inline">Sync</span>
            </button>
          </IconTooltip>
        </div>
      </motion.div>
    </motion.div>
  )
}
