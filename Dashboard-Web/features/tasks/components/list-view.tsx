
"use client"

import React, { useState, useMemo, type MouseEvent } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Circle,
  CheckCircle2,
  GripVertical,
  Clock,
  AlertCircle,
  Ban,
  MoreHorizontal,
  Pencil,
  Trash2,
  Users,
  Check,
  Copy,
  Plus,
  ChevronRight,
  ChevronUp,
  Play,
} from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/shared/ui/dropdown-menu"
import {
  TABLE_ROW_MENU_ITEM_BASE,
  tableRowMenuContentClass,
  tableRowMenuItemClass,
} from "@/shared/ui/layout/table-row-menu-styles"
import { rowTransition } from "@/features/tasks/constants/motion"
import { TaskParticipationChip } from "@/features/tasks/components/task-participation-chip"
import { AvatarBubble, PriorityDot } from "@/features/projects/ui-components"
import { Checkbox } from "@/shared/ui/checkbox"
import {
  type Task,
  type Member,
  type TaskStatus,
  type Priority,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  formatTaskDate,
} from "@/features/projects/constants"

export function TaskRowMenu({
  task,
  onDelete,
  onStatusChange,
  onDuplicate,
  onRename,
  onEdit,
  onSubmitHours,
  onReview,
  onStartTask,
  onBlockTask,
  isDark,
  canMarkCompleted = false,
}: {
  task: Task
  onDelete: () => void
  onStatusChange: (s: TaskStatus) => void
  onDuplicate: () => void
  onRename: () => void
  onEdit: () => void
  onSubmitHours: () => void
  onReview: () => void
  onStartTask?: () => void
  onBlockTask?: () => void
  isDark: boolean
  canMarkCompleted?: boolean
}) {
  const t = isDark ? dark : light
  const [open, setOpen] = useState(false)

  function close() {
    setOpen(false)
  }

  return (
    <div className="relative">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
            }}
            className={cn(
              "rounded-lg p-1.5 opacity-0 transition-all group-hover:opacity-100 data-[state=open]:opacity-100",
              isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-100",
            )}
          >
            <MoreHorizontal className={cn("h-4 w-4", isDark ? "text-[#bccbb9]" : "text-slate-400")} />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className={tableRowMenuContentClass(isDark, "w-44")}>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
              close()
            }}
            className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(false, isDark))}
          >
            <Pencil className="w-3.5 h-3.5" /> Edit task
          </DropdownMenuItem>

          {onStartTask && task.status !== "done" ? (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onStartTask()
                close()
              }}
              className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(false, isDark))}
            >
              <Play className="w-3.5 h-3.5" /> Start task
            </DropdownMenuItem>
          ) : null}

          {onBlockTask && task.status !== "done" ? (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onBlockTask()
                close()
              }}
              className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(false, isDark))}
            >
              <Ban className="w-3.5 h-3.5" /> I&apos;m blocked
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onRename()
              close()
            }}
            className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(false, isDark))}
          >
            <Pencil className="w-3.5 h-3.5" /> Rename
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
              close()
            }}
            className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(false, isDark))}
          >
            <Copy className="w-3.5 h-3.5" /> Duplicate
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onSubmitHours()
              close()
            }}
            className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(false, isDark))}
          >
            <Clock className="w-3.5 h-3.5" /> Submit Hours
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onReview()
              close()
            }}
            className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(false, isDark))}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Review Task
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(false, isDark))}
            >
              <Clock className="w-3.5 h-3.5" />
              Change status
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className={tableRowMenuContentClass(isDark)}>
                {(Object.entries(STATUS_CONFIG) as [TaskStatus, typeof STATUS_CONFIG[TaskStatus]][])
                  .filter(([status]) => status !== "in_review")
                  .filter(([status]) => canMarkCompleted || status !== "done")
                  .map(([s, cfg]) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={(e) => { e.stopPropagation(); onStatusChange(s); close() }}
                    className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(false, isDark), cfg.color, s === task.status && "font-semibold")}
                  >
                    {cfg.icon}
                    {cfg.label}
                    {s === task.status && <Check className="w-3 h-3 ml-auto" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          <DropdownMenuSeparator className={t.tableBorder} />

          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
              close()
            }}
            className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(true, isDark))}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete task
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function DraggableListRow({
  task,
  assignee,
  extraAssigneeCount = 0,
  teamName,
  pCfg,
  index,
  isDark,
  isSelected,
  onSelectTask,
  onTaskPreview,
  isChecked,
  onToggleChecked,
  editingId,
  setEditingId,
  editTitle,
  setEditTitle,
  commitRename,
  onDelete,
  onUpdate,
  onEdit,
  onDuplicate,
  onSubmitHours,
  onReview,
  onStartTask,
  onBlockTask,
  showParticipation,
  canMarkCompleted = false,
}: any) {
  const t = isDark ? dark : light
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task, status: task.status },
  })
  const style = transform ? { transform: CSS.Translate.toString(transform), zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.5 : 1 } : undefined

  return (
    <motion.tr
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={rowTransition(index)}
      onClick={() => isSelected ? onSelectTask?.(null) : onSelectTask?.(task.id)}
      onDoubleClick={(e) => onTaskPreview?.(task, e)}
      className={cn(
        "group cursor-pointer transition-colors border-l-4",
        task.priority === "urgent" ? "border-l-red-500" :
        task.priority === "high" ? "border-l-amber-500" :
        task.priority === "medium" ? "border-l-blue-500" :
        "border-l-slate-300",
        t.tableRowHover,
        isSelected &&
          (isDark ? "bg-[#4be277]/10 ring-1 ring-inset ring-[#4be277]/35" : "bg-blue-50/90 ring-1 ring-inset ring-blue-200"),
      )}
    >
      <td className="w-8 px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={isChecked} onChange={(e) => onToggleChecked?.(task.id, e.shiftKey)} isDark={isDark} />
      </td>
      <td className="w-8 px-2 py-3" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="flex cursor-grab items-center justify-center rounded p-0.5 active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag task"
        >
          <GripVertical className={cn("h-4 w-4", t.tableCellMuted)} />
        </button>
      </td>
      {/*
        Status indicator, not a third selection control. This used to be a button
        that toggled onSelectTask - the same thing clicking anywhere on the row
        already does - which left the row carrying two controls that look like
        selection (this and the batch checkbox) but mean different things. The
        checkbox owns multi-select; the row owns the single highlighted task.
      */}
      <td className="px-5 py-3">
        <span className="flex items-center justify-center" aria-hidden="true">
          {task.completed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : isSelected ? (
            <CheckCircle2 className={cn("w-4 h-4", isDark ? "text-[#4be277]" : "text-blue-500")} />
          ) : (
            <Circle className="w-4 h-4 text-slate-300" />
          )}
        </span>
      </td>
      <td className="px-4 py-3" onPointerDown={(e) => e.stopPropagation()}>
        <div className="space-y-0.5">
          {editingId === task.id ? (
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => commitRename(task)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(task); if (e.key === "Escape") setEditingId(null) }}
              className={cn(
                "w-full rounded border px-2 py-0.5 text-sm font-medium focus:outline-none",
                isDark ? "border-[#4be277] bg-[#151b2d] text-[#dce1fb]" : "border-blue-400 bg-slate-50 text-slate-700",
              )} aria-label="Interactive control"
            />
          ) : (
            <span className={cn("text-sm font-medium", task.completed ? "line-through text-slate-400" : t.tableCell)}>
              {task.title}
            </span>
          )}
          {task.reviewState && (
            <span className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium",
              task.reviewState === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            )}>
              {task.reviewState === "approved" ? "Approved" : "Rejected"}
            </span>
          )}
          {teamName ? (
            <p className="text-[10px] text-slate-400">
              {teamName}
            </p>
          ) : null}
          {showParticipation ? (
            <TaskParticipationChip task={task} isDark={isDark} compact />
          ) : null}
          {task.subtasks && (
            <div className="flex items-center gap-1.5">
              <div className="w-12 h-1 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.round((task.subtasks.filter((s: { completed?: boolean; done?: boolean }) => s.completed || s.done).length / task.subtasks.length) * 100)}%` }} />
              </div>
              <span className="text-[10px] text-slate-400">{task.subtasks.filter((s: { completed?: boolean; done?: boolean }) => s.completed || s.done).length}/{task.subtasks.length}</span>
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        {assignee ? (
          <div className="flex items-center gap-1.5">
            <AvatarBubble member={assignee} />
            <span className="text-xs text-slate-500 truncate">
              {assignee.name.split(" ")[0]}
              {extraAssigneeCount > 0 ? ` +${extraAssigneeCount}` : ""}
            </span>
          </div>
        ) : teamName ? (
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
            <Users className="h-3 w-3 shrink-0" />
            <span className="truncate">{teamName}</span>
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>
      <td className="px-4 py-3" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <PriorityDot priority={task.priority} />
          <span className={cn("text-xs font-medium", pCfg.color)}>{pCfg.label}</span>
        </div>
      </td>
      <td className="px-4 py-3" onPointerDown={(e) => e.stopPropagation()}>
        <span className={cn("text-xs", task.startDate ? "text-slate-500" : "text-slate-300")}>
          {formatTaskDate(task.startDate)}
        </span>
      </td>
      <td className="px-4 py-3" onPointerDown={(e) => e.stopPropagation()}>
        <span className={cn("text-xs", task.dueDate ? "text-slate-500" : "text-slate-300")}>
          {formatTaskDate(task.dueDate)}
        </span>
      </td>
      <td className="px-4 py-3" onPointerDown={(e) => e.stopPropagation()}>
        <TaskRowMenu
          task={task}
          onDelete={() => onDelete(task.id)}
          onStatusChange={(s) => onUpdate(task.id, { status: s, completed: s === "done" })}
          onDuplicate={() => onDuplicate(task)}
          onEdit={() => onEdit(task)}
          onRename={() => {
            setEditingId(task.id)
            setEditTitle(task.title)
          }}
          onSubmitHours={onSubmitHours}
          onReview={onReview}
          onStartTask={onStartTask ? () => onStartTask(task) : undefined}
          onBlockTask={onBlockTask ? () => onBlockTask(task) : undefined}
          isDark={isDark}
          canMarkCompleted={canMarkCompleted}
        />
      </td>
    </motion.tr>
  )
}

function DroppableListGroup({
  status,
  cfg,
  items,
  isCollapsed,
  setCollapsed,
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
  editingId,
  setEditingId,
  editTitle,
  setEditTitle,
  commitRename,
  onAddTask,
  onSubmitHours,
  onReview,
  onStartTask,
  onBlockTask,
  showParticipation,
  canMarkCompleted = false,
}: any) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const t = isDark ? dark : light
  return (
    <div
      ref={setNodeRef}
      className={cn("overflow-hidden rounded-lg border shadow-sm transition-colors", t.tableBorder, t.tableBg, isOver && (isDark ? "bg-[#2e3447]/50" : "bg-slate-50"))}
    >
      <div
        className={cn(
          "flex w-full items-center gap-3 border-b px-5 py-3 transition-colors",
          t.tableBorder,
          t.tableHeader,
        )}
      >
        <span className={cn("flex items-center gap-1.5 text-xs font-semibold", cfg.color)}>
          {cfg.icon}{cfg.label}
        </span>
        <span className="text-xs text-slate-400 font-medium ml-1">{items.length}</span>
        <div className="ml-auto flex items-center gap-2">
          {onAddTask ? (
            <button onClick={() => onAddTask(status)} className="p-1 hover:bg-black/5 rounded transition-colors text-slate-400 hover:text-slate-600" type="button">
              <Plus className="w-4 h-4" />
            </button>
          ) : null}
          <button onClick={() => setCollapsed((prev: any) => { const s = new Set(prev); if (s.has(status)) s.delete(status); else s.add(status); return s })} type="button">
            {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-50" aria-label="Interactive control">
                  <th className="w-8 px-3 py-2" />
                  <th className="w-8 px-2 py-2" />
                  <th className="w-8 px-5 py-2" />
                  <th className="text-left text-[10px] font-semibold text-slate-300 uppercase tracking-wider px-4 py-2">Task</th>
                  <th className="text-left text-[10px] font-semibold text-slate-300 uppercase tracking-wider px-4 py-2 w-28">Assignee</th>
                  <th className="text-left text-[10px] font-semibold text-slate-300 uppercase tracking-wider px-4 py-2 w-24">Priority</th>
                  <th className="text-left text-[10px] font-semibold text-slate-300 uppercase tracking-wider px-4 py-2 w-24">Start</th>
                  <th className="text-left text-[10px] font-semibold text-slate-300 uppercase tracking-wider px-4 py-2 w-28" aria-label="Interactive control">Due date</th>
                  <th className="w-10 px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((task: any, index: number) => {
                  const assigneeIds = Array.isArray(task.assigneeIds) ? task.assigneeIds : []
                  const primaryAssigneeId = task.assignedTo ?? assigneeIds[0] ?? null
                  const assignee = primaryAssigneeId ? memberMap[primaryAssigneeId] : null
                  const extraAssigneeCount = Math.max(
                    0,
                    (task.totalAssignees ?? assigneeIds.length ?? (assignee ? 1 : 0)) - 1,
                  )
            const pCfg = PRIORITY_CONFIG[task.priority as Priority] ?? PRIORITY_CONFIG.medium
                  const teamName = task.teamId ? teamNamesById[task.teamId] : undefined
                  return (
                    <DraggableListRow
                      key={task.id}
                      task={task}
                      assignee={assignee}
                      extraAssigneeCount={extraAssigneeCount}
                      teamName={teamName}
                      pCfg={pCfg}
                      index={index}
                      isDark={isDark}
                      isSelected={selectedTaskId === task.id}
                      onSelectTask={onSelectTask}
                      onTaskPreview={onTaskPreview}
                      isChecked={selectedTaskIds?.has(task.id) ?? false}
                      onToggleChecked={(id: string, shiftKey: boolean) =>
                        onToggleTaskSelected?.(id, shiftKey, items.map((t: any) => t.id))
                      }
                      editingId={editingId}
                      setEditingId={setEditingId}
                      editTitle={editTitle}
                      setEditTitle={setEditTitle}
                      commitRename={commitRename}
                      onDelete={onDelete}
                      onUpdate={onUpdate}
                      onEdit={onEdit}
                      onDuplicate={onDuplicate}
                      onSubmitHours={onSubmitHours}
                      onReview={onReview}
                      onStartTask={onStartTask}
                      onBlockTask={onBlockTask}
                      showParticipation={showParticipation}
                      canMarkCompleted={canMarkCompleted}
                    />
                  )
                })}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ListView({
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
  onStartTask,
  onBlockTask,
  showParticipation = false,
  canMarkCompleted = false,
}: {
  tasks: Task[]
  members: Member[]
  teamNamesById: Record<string, string>
  selectedTaskId: string | null
  onSelectTask: (id: string | null) => void
  onTaskPreview: (task: Task, event: MouseEvent) => void
  selectedTaskIds?: Set<string>
  /** Shift-click extends the selection across `orderedIds`, so all three are passed. */
  onToggleTaskSelected?: (id: string, shiftKey: boolean, orderedIds: string[]) => void
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
  onStartTask?: (task: Task) => void
  onBlockTask?: (task: Task) => void
  showParticipation?: boolean
  canMarkCompleted?: boolean
}) {
  const [collapsed, setCollapsed] = useState<Set<TaskStatus>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")

  const groups = useMemo(() => {
    const visible = tasks.filter((t) => {
      if (!showCompleted && (t.completed || t.status === "done")) return false
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    const g: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], in_review: [], blocked: [], done: [] }
    visible.forEach((t) => g[t.status].push(t))
    return g
  }, [tasks, showCompleted, search])

  const memberMap = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members])

  function commitRename(task: Task) {
    onUpdate(task.id, { title: editTitle.trim() || task.title })
    setEditingId(null)
  }

  return (
    <div className="scrollbar-hide min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-4">
      {(Object.entries(groups) as [TaskStatus, Task[]][]).map(([status, items]) => {
        if (!showCompleted && status === "done") return null
        const cfg = STATUS_CONFIG[status]
        const isCollapsed = collapsed.has(status)
        return (
          <DroppableListGroup
            key={status}
            status={status}
            cfg={cfg}
            items={items}
            isCollapsed={isCollapsed}
            setCollapsed={setCollapsed}
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
            editingId={editingId}
            setEditingId={setEditingId}
            editTitle={editTitle}
            setEditTitle={setEditTitle}
            commitRename={commitRename}
            onAddTask={onAddTask}
            onSubmitHours={onSubmitHours}
            onReview={onReview}
            onStartTask={onStartTask}
            onBlockTask={onBlockTask}
            showParticipation={showParticipation}
            canMarkCompleted={canMarkCompleted}
          />
        )
      })}
    </div>
  )
}
