/* eslint-disable react-doctor/use-lazy-motion */

"use client"

import React, { useMemo, type MouseEvent } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Calendar, Users, GripVertical, Plus } from "lucide-react"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { cn } from "@/shared/utils/utils"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import {
  type Task,
  type Member,
  type TaskStatus,
  type Priority,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  BOARD_COLUMNS,
  formatTaskDate,
} from "@/features/projects/constants"
import { AvatarBubble, PriorityDot } from "@/features/projects/ui-components"
import { TaskRowMenu } from "@/features/tasks/components/list-view"
import { Checkbox } from "@/shared/ui/checkbox"

function DraggableTaskCard({
  task,
  assignee,
  teamName,
  pCfg,
  isDark,
  isSelected,
  onSelectTask,
  onTaskPreview,
  isChecked,
  onToggleChecked,
  onDelete,
  onUpdate,
  onEdit,
  onDuplicate,
  onSubmitHours,
  onReview,
  onBlockTask,
  canMarkCompleted = false,
}: any) {
  const t = isDark ? dark : light
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task, status: task.status },
  })
  const style = transform ? { transform: CSS.Translate.toString(transform), zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.5 : 1 } : undefined

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="relative"
    >
      {task.priority === "urgent" && (
        <div className="absolute inset-0 -inset-1 rounded-xl bg-red-500/20 blur-md animate-pulse pointer-events-none -z-10" />
      )}
      {task.priority === "high" && (
        <div className="absolute inset-0 -inset-1 rounded-xl bg-amber-500/20 blur-md animate-pulse pointer-events-none -z-10" />
      )}
      <motion.div
        onClick={() => isSelected ? onSelectTask?.(null) : onSelectTask?.(task.id)}
        onDoubleClick={(e) => onTaskPreview?.(task, e)}
        className={cn(
          "group relative space-y-2.5 rounded-xl border-2 p-3 shadow-sm transition-colors cursor-pointer",
          task.priority === "urgent" ? "border-red-500" :
          task.priority === "high" ? "border-amber-500" :
          task.priority === "medium" ? "border-blue-500" :
          "border-slate-300",
          t.tableBg,
          isDark ? "hover:border-[#4be277]/50" : "hover:border-slate-400",
          isSelected &&
            (isDark ? "ring-2 ring-[#4be277]/40 border-[#4be277]" : "ring-2 ring-blue-300 border-blue-400"),
        )}
      >
        <button
          type="button"
          className="absolute left-1.5 top-1.5 flex cursor-grab items-center rounded p-0.5 active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
          aria-label="Drag task"
        >
          <GripVertical className={cn("h-3.5 w-3.5", t.tableCellMuted)} />
        </button>
        <div className="flex items-start justify-between gap-2 pl-4">
          <div className="flex items-start gap-2">
            <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={!!isChecked} onChange={() => onToggleChecked?.(task.id)} isDark={isDark} />
            </div>
            <div className="flex flex-col gap-1">
              <span
                className={cn(
                  "text-sm font-medium leading-snug",
                  task.completed ? "line-through text-slate-400" : t.tableCell,
                )}
              >
                {task.title}
              </span>
              {task.reviewState && (
                <span className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium w-fit",
                  task.reviewState === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                )}>
                  {task.reviewState === "approved" ? "Approved" : "Rejected"}
                </span>
              )}
            </div>
          </div>
          <div onPointerDown={(e) => e.stopPropagation()}>
            <TaskRowMenu
              task={task}
              onDelete={() => onDelete(task.id)}
              onStatusChange={(s) => onUpdate(task.id, { status: s, completed: s === "done" })}
              onDuplicate={() => onDuplicate(task)}
              onEdit={() => onEdit(task)}
              onRename={() => {}}
              onSubmitHours={() => onSubmitHours?.(task.id)}
              onReview={() => onReview?.(task.id)}
              onBlockTask={onBlockTask ? () => onBlockTask(task) : undefined}
              isDark={isDark}
              canMarkCompleted={canMarkCompleted}
            />
          </div>
        </div>
        {task.subtasks && (
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.round((task.subtasks.filter((s: any) => s.done).length / task.subtasks.length) * 100)}%` }} />
            </div>
            <span className="text-[10px] text-slate-400 shrink-0">{task.subtasks.filter((s: any) => s.done).length}/{task.subtasks.length}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <PriorityDot priority={task.priority} />
            <span className={cn("text-[10px] font-medium", pCfg.color)}>{pCfg.label}</span>
          </div>
          <div className="flex items-center gap-2">
            {(task.startDate || task.dueDate) && (
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <Calendar className="w-3 h-3 shrink-0" />
                {task.startDate && task.dueDate
                  ? `${formatTaskDate(task.startDate)} – ${formatTaskDate(task.dueDate)}`
                  : formatTaskDate(task.startDate || task.dueDate)}
              </span>
            )}
            {assignee ? (
              <AvatarBubble member={assignee} />
            ) : teamName ? (
              <IconTooltip text={teamName} placement="top">
                <span className={cn("text-[10px] font-medium", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                  <Users className="mr-0.5 inline h-3 w-3" />
                  {teamName}
                </span>
              </IconTooltip>
            ) : null}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function DroppableColumn({
  status,
  cfg,
  items,
  isDark,
  memberMap,
  teamNamesById,
  selectedTaskId,
  onSelectTask,
  onTaskPreview,
  selectedTaskIds,
  onToggleTaskSelected,
  onDelete,
  onUpdate,
  onEdit,
  onDuplicate,
  onAddTask,
  onSubmitHours,
  onReview,
  onBlockTask,
  canMarkCompleted = false,
}: any) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div ref={setNodeRef} className={cn("flex flex-col gap-3 min-w-[180px] rounded-xl p-2 transition-colors", isOver && (isDark ? "bg-[#2e3447]/30" : "bg-slate-50"))}>
      <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg group", cfg.bg)}>
        <span className={cfg.color}>{cfg.icon}</span>
        <span className={cn("text-xs font-semibold", cfg.color)}>{cfg.label}</span>
        {onAddTask ? (
          <button onClick={() => onAddTask(status)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/5 rounded transition-opacity" type="button">
            <Plus className="w-3.5 h-3.5 text-slate-500" />
          </button>
        ) : null}
        <span className="ml-auto text-xs font-bold text-slate-400">{items.length}</span>
      </div>
      <div className="space-y-2 min-h-[150px]">
        <AnimatePresence>
          {items.map((task: any) => {
            const assignee = task.assignedTo ? memberMap[task.assignedTo] : null
            const pCfg = PRIORITY_CONFIG[task.priority as Priority]
            const teamName = task.teamId ? teamNamesById[task.teamId] : undefined
            return (
              <DraggableTaskCard
                key={task.id}
                task={task}
                assignee={assignee}
                teamName={teamName}
                pCfg={pCfg}
                isDark={isDark}
                isSelected={selectedTaskId === task.id}
                onSelectTask={onSelectTask}
                onTaskPreview={onTaskPreview}
                isChecked={selectedTaskIds?.has(task.id) ?? false}
                onToggleChecked={onToggleTaskSelected}
                onDelete={onDelete}
                onUpdate={onUpdate}
                onEdit={onEdit}
                onDuplicate={onDuplicate}
                onSubmitHours={onSubmitHours}
                onReview={onReview}
                onBlockTask={onBlockTask}
                canMarkCompleted={canMarkCompleted}
              />
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function BoardView({
  tasks,
  members,
  teamNamesById,
  selectedTaskId,
  onSelectTask,
  onTaskPreview,
  selectedTaskIds,
  onToggleTaskSelected,
  onDelete,
  onUpdate,
  onEdit,
  onDuplicate,
  showCompleted,
  search,
  isDark,
  onAddTask,
  onSubmitHours,
  onReview,
  onBlockTask,
  canMarkCompleted = false,
}: {
  tasks: Task[]
  members: Member[]
  teamNamesById: Record<string, string>
  selectedTaskId: string | null
  onSelectTask: (id: string | null) => void
  onTaskPreview: (task: Task, event: MouseEvent) => void
  selectedTaskIds?: Set<string>
  onToggleTaskSelected?: (id: string) => void
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: Partial<Task>) => void
  onEdit: (task: Task) => void
  onDuplicate: (task: Task) => void
  showCompleted: boolean
  search: string
  isDark: boolean
  onAddTask?: (status: TaskStatus) => void
  onSubmitHours?: (taskId: string) => void
  onReview?: (taskId: string) => void
  /** Self-service "I'm blocked, waiting on X" - blocks only the current
   * user's own assignment on this task, not the whole task. */
  onBlockTask?: (task: Task) => void
  canMarkCompleted?: boolean
}) {
  const memberMap = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members])

  const columns = useMemo(() => {
    const visible = tasks.filter((t) => {
      if (!showCompleted && (t.completed || t.status === "done")) return false
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    const cols: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], in_review: [], blocked: [], done: [] }
    visible.forEach((t) => cols[t.status].push(t))
    return cols
  }, [tasks, showCompleted, search])

  const visibleColumns = useMemo(() => {
    return BOARD_COLUMNS.filter((status) => showCompleted || status !== "done")
  }, [showCompleted])

  const gridCols = useMemo(() => {
    const count = visibleColumns.length
    if (count === 5) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
    if (count === 4) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
    if (count === 3) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
    if (count === 2) return "grid-cols-1 sm:grid-cols-2"
    return "grid-cols-1"
  }, [visibleColumns])

  return (
    <div className={`scrollbar-hide grid min-h-0 flex-1 ${gridCols} gap-3 overflow-auto pb-2`}>
      {BOARD_COLUMNS.map((status) => {
        if (!showCompleted && status === "done") return null
        const cfg = STATUS_CONFIG[status]
        const items = columns[status]
        return (
          <DroppableColumn
            key={status}
            status={status}
            cfg={cfg}
            items={items}
            isDark={isDark}
            memberMap={memberMap}
            teamNamesById={teamNamesById}
            selectedTaskId={selectedTaskId}
            onSelectTask={onSelectTask}
            onTaskPreview={onTaskPreview}
            selectedTaskIds={selectedTaskIds}
            onToggleTaskSelected={onToggleTaskSelected}
            onDelete={onDelete}
            onUpdate={onUpdate}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onAddTask={onAddTask}
            onSubmitHours={onSubmitHours}
            onReview={onReview}
            onBlockTask={onBlockTask}
            canMarkCompleted={canMarkCompleted}
          />
        )
      })}
    </div>
  )
}
