"use client"

import { useMemo, useRef, type Dispatch, type ReactNode, type SetStateAction } from "react"
import { ChevronDown, ChevronUp, User } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import {
  ALL_PROJECT_COLS,
  PROJECT_COL_AUTO_HIDE_PRIORITY,
  PROJECT_COL_MIN_WIDTH,
  PROJECT_NAME_COL_MIN_WIDTH,
  getProjectsTableFixedWidth,
  getProjectsTableMinWidth,
} from "@/features/projects/constants"
import { Checkbox } from "@/shared/ui/checkbox";
import { useRangeSelect } from "@/shared/hooks/use-range-select"
import { useAutoHiddenTableColumns, usePaginatedTable } from "@/features/members/hooks"
import {
  TEAMS_TABLE_MAX_ROWS,
  TEAMS_TABLE_MIN_ROWS,
  TEAMS_TABLE_ROWS_PER_PAGE,
} from "@/features/members/config/ui-config"
import {
  PaginatedTableShell,
  TableScroll,
  TablePagination,
  peopleTableCellClass,
  peopleTableRowStyle,
} from "@/shared/tables/ui"
import {
  BudgetBar,
  formatProjectBudget,
  MemberLimit,
  TeamBadge,
  TodoProgress,
} from "@/features/projects/components/project-table-cells"
import { ProjectRowMenu } from "@/features/projects/components/menus/project-row-menu"
import { useWorkspaceCurrency } from "@/shared/utils/workspace-currency"
import type { ProjectListItem } from "@/features/projects/models/list"

export function ProjectsTab({
  projects,
  search,
  enabledCols,
  selected,
  setSelected,
  sortCol,
  sortDir,
  onSort,
  colOrder,
  draggedCol,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onEdit,
  onArchive,
  onDelete,
  onAnchor,
  onPreview,
  isDark = false,
  canManageProjects = true,
  emptyContent,
  rowsPerPage = TEAMS_TABLE_ROWS_PER_PAGE,
}: {
  projects: ProjectListItem[]
  search: string
  enabledCols: Set<string>
  selected: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  sortCol: string | null
  sortDir: "asc" | "desc"
  onSort: (col: string) => void
  colOrder: string[]
  draggedCol: string | null
  onDragStart: (col: string) => void
  onDragOver: (e: React.DragEvent, col: string) => void
  onDrop: (col: string) => void
  onDragEnd: () => void
  onEdit: (id: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  onAnchor?: (id: string) => void
  onPreview?: (id: string) => void
  isDark?: boolean
  canManageProjects?: boolean
  emptyContent?: ReactNode
  rowsPerPage?: number
}) {
  const t = isDark ? dark : light

  const filtered = useMemo(() => {
    const q = (search || "").toLowerCase()
    let result = projects.filter((p) => {
      const name = (p.name || "").toLowerCase()
      const teams = (p.teams || []).join(" ").toLowerCase()
      return name.includes(q) || teams.includes(q)
    })
    if (sortCol) {
      result = result.toSorted((a, b) => {
        let aVal: string | number = ""
        let bVal: string | number = ""
        switch (sortCol) {
          case "name":
            aVal = a.name
            bVal = b.name
            break
          case "teams":
            aVal = (a.teams || []).join(", ")
            bVal = (b.teams || []).join(", ")
            break
          case "members":
            aVal = a.members
            bVal = b.members
            break
          case "todos":
            aVal = !a.todos || a.todos.total === 0 ? -1 : a.todos.done / a.todos.total
            bVal = !b.todos || b.todos.total === 0 ? -1 : b.todos.done / b.todos.total
            break
          case "budget":
            aVal = a.budget?.spent ?? 0
            bVal = b.budget?.spent ?? 0
            break
          case "member_limits":
            aVal = a.memberLimit ?? -1
            bVal = b.memberLimit ?? -1
            break
          default:
            return 0
        }
        const left = typeof aVal === "number" ? aVal : String(aVal ?? "")
        const right = typeof bVal === "number" ? bVal : String(bVal ?? "")
        if (left < right) return sortDir === "asc" ? -1 : 1
        if (left > right) return sortDir === "asc" ? 1 : -1
        return 0
      })
    }
    return result
  }, [projects, search, sortCol, sortDir])

  const tableBodyRef = useRef<HTMLDivElement>(null)
  const tableWidthRef = useRef<HTMLDivElement>(null)
  const { currentPage, setCurrentPage, totalPages, visibleRows, fillsRemaining, rowsPerPage: pageRows } =
    usePaginatedTable(filtered, rowsPerPage, tableBodyRef, {
      maxRowsPerPage: TEAMS_TABLE_MAX_ROWS,
      minRowsPerPage: TEAMS_TABLE_MIN_ROWS,
    })

  const fixedTableWidth = getProjectsTableFixedWidth({
    showSelectColumn: canManageProjects,
    showActionsColumn: canManageProjects,
  })
  const autoHiddenCols = useAutoHiddenTableColumns(
    tableWidthRef,
    enabledCols,
    colOrder,
    PROJECT_COL_AUTO_HIDE_PRIORITY,
    PROJECT_COL_MIN_WIDTH,
    fixedTableWidth,
  )
  const visibleColKeys = useMemo(
    () => colOrder.filter((key) => enabledCols.has(key) && !autoHiddenCols.has(key)),
    [colOrder, enabledCols, autoHiddenCols],
  )
  const tableMinWidth = useMemo(
    () =>
      getProjectsTableMinWidth(visibleColKeys, {
        showSelectColumn: canManageProjects,
        showActionsColumn: canManageProjects,
      }),
    [visibleColKeys, canManageProjects],
  )

  const rowLayoutCount = visibleRows.length

  const allSelected = visibleRows.length > 0 && visibleRows.every((p) => selected.has(p.id))

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(visibleRows.map((p) => p.id)))
  }

  const currency = useWorkspaceCurrency()
  const rangeToggle = useRangeSelect()
  function toggleOne(id: string, shiftKey = false) {
    rangeToggle(id, shiftKey, visibleRows.map((p) => p.id), setSelected)
  }

  function renderCell(key: string, project: ProjectListItem, rowH?: number) {
    const cellClass = cn(peopleTableCellClass("px-4", rowH), "shrink-0")
    const colWidth = PROJECT_COL_MIN_WIDTH[key] ?? 100
    const cellStyle = { minWidth: colWidth }
    switch (key) {
      case "teams":
        return (
          <td key="teams" className={cellClass} style={cellStyle}>
            <div className="flex flex-wrap gap-1">
              {project.teams.map((team) => (
                <TeamBadge key={team} name={team} isDark={isDark} />
              ))}
            </div>
          </td>
        )
      case "members":
        return (
          <td key="members" className={cellClass} style={cellStyle}>
            <div className="flex items-center gap-1.5">
              <User className={cn("h-3.5 w-3.5", isDark ? "text-[#3d4a3d]" : "text-slate-300")} />
              <span className={cn("text-sm", t.tableCell)}>{project.members}</span>
            </div>
          </td>
        )
      case "todos":
        return (
          <td key="todos" className={cellClass} style={cellStyle}>
            {project.todos ? (
              <TodoProgress done={project.todos.done} total={project.todos.total} isDark={isDark} />
            ) : (
              <span
                className={cn("text-xs", isDark ? "text-[#3d4a3d]" : "text-slate-400")}
                title="Calling projects don't use tasks"
              >
                —
              </span>
            )}
          </td>
        )
      case "budget":
        return (
          <td key="budget" className={cellClass} style={cellStyle}>
            {project.budget ? (
              project.budget.total ? (
                <BudgetBar
                  spent={project.budget.spent}
                  total={project.budget.total}
                  type={project.budget.type}
                  isDark={isDark}
                />
              ) : (
                <span className={cn("text-xs", t.tableCellMuted)}>
                  {formatProjectBudget(project.budget.spent, project.budget.type, currency)}
                </span>
              )
            ) : (
              <span className={cn("text-xs", isDark ? "text-[#3d4a3d]" : "text-slate-300")}>—</span>
            )}
          </td>
        )
      case "remaining":
        return (
          <td key="remaining" className={cellClass} style={cellStyle}>
            {project.budget?.total ? (
              <span className={cn("text-xs", t.tableCellMuted)}>
                {formatProjectBudget(Math.max(0, project.budget.total - project.budget.spent), project.budget.type, currency)}
              </span>
            ) : (
              <span className={cn("text-xs", isDark ? "text-[#3d4a3d]" : "text-slate-300")}>—</span>
            )}
          </td>
        )
      case "spent":
        return (
          <td key="spent" className={cellClass} style={cellStyle}>
            {project.budget ? (
              <span className={cn("text-xs", t.tableCellMuted)}>
                {formatProjectBudget(project.budget.spent, project.budget.type, currency)}
              </span>
            ) : (
              <span className={cn("text-xs", isDark ? "text-[#3d4a3d]" : "text-slate-300")}>—</span>
            )}
          </td>
        )
      case "member_limits":
        return (
          <td key="member_limits" className={cellClass} style={cellStyle}>
            <MemberLimit members={project.members} limit={project.memberLimit} isDark={isDark} />
          </td>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <PaginatedTableShell
        isDark={isDark}
        fillsRemaining={fillsRemaining}
        isEmpty={filtered.length === 0}
        emptyContent={emptyContent ?? "No projects found"}
        footer={
          filtered.length > 0 ? (
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filtered.length}
              rowsPerPage={pageRows}
              onPageChange={setCurrentPage}
              isDark={isDark}
            />
          ) : undefined
        }
      >
        {filtered.length > 0 ? (
          <div ref={tableWidthRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <TableScroll visibleRowCount={rowLayoutCount} scrollRef={tableBodyRef} className="overflow-x-auto">
              {(rowH) => (
                <table className="h-full w-full" style={{ minWidth: tableMinWidth }}>
                <thead>
                  <tr className={cn("border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
                    {canManageProjects ? (
                      <th className="w-10 shrink-0 px-5 py-3">
                        <Checkbox checked={allSelected} onChange={toggleAll} isDark={isDark} />
                      </th>
                    ) : null}
                    <th
                      className="shrink-0 px-4 py-3 text-left"
                      style={{ minWidth: PROJECT_NAME_COL_MIN_WIDTH, width: PROJECT_NAME_COL_MIN_WIDTH }}
                    >
                      <button
                        type="button"
                        onClick={() => onSort("name")}
                        className={cn(
                          "flex items-center gap-1 whitespace-nowrap text-sm font-semibold transition-colors",
                          isDark ? "text-[#dce1fb] hover:text-[#4be277]" : "text-slate-700 hover:text-blue-500",
                        )}
                      >
                        Project
                        {sortCol === "name" &&
                          (sortDir === "asc" ? (
                            <ChevronUp className={cn("h-3.5 w-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} />
                          ) : (
                            <ChevronDown className={cn("h-3.5 w-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} />
                          ))}
                      </button>
                    </th>
                    {visibleColKeys.map((key) => {
                      const config = ALL_PROJECT_COLS.find((c) => c.key === key)
                      if (!config) return null
                      return (
                        <th
                          key={key}
                          className="shrink-0 px-4 py-3 text-left"
                          style={{
                            minWidth: PROJECT_COL_MIN_WIDTH[key] ?? 100,
                            cursor: draggedCol ? "grabbing" : "grab",
                            opacity: draggedCol === key ? 0.5 : 1,
                          }}
                          draggable
                          onDragStart={(e) => {
                            if (e.target instanceof HTMLButtonElement) e.preventDefault()
                            else onDragStart(key)
                          }}
                          onDragOver={(e) => onDragOver(e, key)}
                          onDrop={() => onDrop(key)}
                          onDragEnd={onDragEnd}
                        >
                          <button
                            type="button"
                            onClick={() => onSort(key)}
                            className={cn(
                              "flex items-center gap-1 whitespace-nowrap text-sm font-semibold transition-colors",
                              isDark ? "text-[#dce1fb] hover:text-[#4be277]" : "text-slate-700 hover:text-blue-500",
                            )}
                          >
                            {config.label}
                            {sortCol === key &&
                              (sortDir === "asc" ? (
                                <ChevronUp className={cn("h-3.5 w-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} />
                              ) : (
                                <ChevronDown className={cn("h-3.5 w-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} />
                              ))}
                          </button>
                        </th>
                      )
                    })}
                    {canManageProjects ? (
                      <th className="w-10 px-2 py-3" aria-label="Interactive control" />
                    ) : null}
                  </tr>
                </thead>
                <tbody className={cn("divide-y", isDark ? "divide-[#3d4a3d]/30" : "divide-slate-50")}>
                  {visibleRows.map((project) => (
                    <tr
                      key={project.id}
                      style={peopleTableRowStyle(rowH)}
                      onDoubleClick={canManageProjects ? () => onPreview?.(project.id) : undefined}
                      className={cn(
                        "group cursor-default transition-colors",
                        t.tableRowHover,
                        selected.has(project.id) && (isDark ? "bg-[#4be277]/10" : "bg-blue-50/80"),
                      )}
                    >
                      {canManageProjects ? (
                        <td className={peopleTableCellClass("px-5", rowH)}>
                          <Checkbox checked={selected.has(project.id)} onChange={(e) => toggleOne(project.id, e.shiftKey)} isDark={isDark} />
                        </td>
                      ) : null}
                      <td className={peopleTableCellClass("px-4", rowH)}>
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
                          <span className={cn("truncate text-sm font-semibold", t.tableCell)}>{project.name}</span>
                        </div>
                      </td>
                      {visibleColKeys.map((key) => renderCell(key, project, rowH))}
                      {canManageProjects ? (
                        <td className={peopleTableCellClass("px-2", rowH)}>
                          <ProjectRowMenu
                            project={project}
                            onEdit={() => onEdit(project.id)}
                            onArchive={() => onArchive(project.id)}
                            onDelete={() => onDelete(project.id)}
                            onAnchor={project.budget && onAnchor ? () => onAnchor(project.id) : undefined}
                            isDark={isDark}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableScroll>
          </div>
        ) : null}
      </PaginatedTableShell>
    </div>
  )
}
