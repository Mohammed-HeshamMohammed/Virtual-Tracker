/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useMemo, useRef } from "react"
import { motion } from "framer-motion"
import { Building2, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { ALL_CLIENT_COLS, CLIENT_COL_AUTO_HIDE_PRIORITY, CLIENT_COL_MIN_WIDTH } from "@/features/projects/constants"
import { PEOPLE_TABLE_ROWS_PER_PAGE } from "@/features/members/config/ui-config"
import { useAutoHiddenTableColumns, usePaginatedTable } from "@/features/members/hooks"
import {
  PaginatedTableShell,
  TableScroll,
  TablePagination,
  peopleTableCellClass,
  peopleTableRowStyle,
} from "@/shared/tables/ui"
import { AutoInvoicingBadge } from "@/features/clients/components/auto-invoicing-badge"
import { BudgetDisplay } from "@/features/clients/components/budget-display"
import { ClientRowMenu } from "@/features/clients/components/menus/client-row-menu"
import type { Client } from "@/features/clients/models/client"

export function ClientsTab({
  clients,
  projectNames,
  search,
  enabledCols,
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
  isDark = false,
  canManageClients = true,
  emptyContent,
  rowsPerPage = PEOPLE_TABLE_ROWS_PER_PAGE,
}: {
  clients: Client[]
  projectNames: Record<string, string>
  search: string
  enabledCols: Set<string>
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
  onSendInvoice?: (id: string) => void
  isDark?: boolean
  canManageClients?: boolean
  emptyContent?: React.ReactNode
  rowsPerPage?: number
}) {
  const t = isDark ? dark : light

  const filtered = useMemo(() => {
    const q = (search || "").toLowerCase()
    let result = clients.filter((c) => {
      const name = (c.name || "").toLowerCase()
      const projectText = (c.projects || [])
        .map((id) => projectNames[id] ?? id)
        .join(" ")
        .toLowerCase()
      return name.includes(q) || projectText.includes(q)
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
          case "budget":
            aVal = a.budget?.cost ?? 0
            bVal = b.budget?.cost ?? 0
            break
          case "auto_invoicing":
            aVal = a.invoicing?.autoInvoicing ? 1 : 0
            bVal = b.invoicing?.autoInvoicing ? 1 : 0
            break
          case "projects":
            aVal = a.projects.length
            bVal = b.projects.length
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
  }, [clients, search, sortCol, sortDir, projectNames])

  const tableBodyRef = useRef<HTMLDivElement>(null)
  const { currentPage, setCurrentPage, totalPages, visibleRows, fillsRemaining, rowsPerPage: pageRows } =
    usePaginatedTable(filtered, rowsPerPage, tableBodyRef)

  const fixedTableWidth = 260 + 52
  const autoHiddenCols = useAutoHiddenTableColumns(
    tableBodyRef,
    enabledCols,
    colOrder,
    CLIENT_COL_AUTO_HIDE_PRIORITY,
    CLIENT_COL_MIN_WIDTH,
    fixedTableWidth,
  )
  const visibleColKeys = useMemo(
    () => colOrder.filter((key) => enabledCols.has(key) && !autoHiddenCols.has(key)),
    [colOrder, enabledCols, autoHiddenCols],
  )

  function projectSummary(client: Client) {
    if (client.projects.length === 0) return "No projects assigned"
    const names = client.projects.map((id) => projectNames[id] ?? id)
    if (names.length <= 2) return names.join(", ")
    return `${names.slice(0, 2).join(", ")} +${client.projects.length - 2}`
  }

  function renderCell(key: string, client: Client, rowH?: number) {
    const cellClass = peopleTableCellClass("px-4", rowH)
    switch (key) {
      case "budget":
        return (
          <td key="budget" className={cellClass}>
            <BudgetDisplay budget={client.budget} />
          </td>
        )
      case "auto_invoicing":
        return (
          <td key="auto_invoicing" className={cellClass}>
            <AutoInvoicingBadge invoicing={client.invoicing} />
          </td>
        )
      case "projects":
        return (
          <td key="projects" className={cellClass}>
            <span className={cn("text-sm", t.tableCell)}>{projectSummary(client)}</span>
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
        emptyContent={emptyContent ?? "No clients found"}
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
          <TableScroll visibleRowCount={visibleRows.length} scrollRef={tableBodyRef}>
            {(rowH) => (
              <table className="w-full">
                <thead>
                  <tr className={cn("border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
                    <th className="px-4 py-3 text-left">
                      <button
                        type="button"
                        onClick={() => onSort("name")}
                        className={cn(
                          "flex items-center gap-1 text-sm font-semibold transition-colors",
                          isDark ? "text-[#dce1fb] hover:text-[#4be277]" : "text-slate-700 hover:text-blue-500",
                        )}
                      >
                        Client
                        {sortCol === "name" &&
                          (sortDir === "asc" ? (
                            <ChevronUp className={cn("h-3.5 w-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} />
                          ) : (
                            <ChevronDown className={cn("h-3.5 w-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} />
                          ))}
                      </button>
                    </th>
                    {visibleColKeys.map((key) => {
                      const config = ALL_CLIENT_COLS.find((c) => c.key === key)
                      if (!config) return null
                      return (
                        <th
                          key={key}
                          className="px-4 py-3 text-left"
                          draggable
                          onDragStart={(e) => {
                            if (e.target instanceof HTMLButtonElement) e.preventDefault()
                            else onDragStart(key)
                          }}
                          onDragOver={(e) => onDragOver(e, key)}
                          onDrop={() => onDrop(key)}
                          onDragEnd={onDragEnd}
                          style={{ cursor: draggedCol ? "grabbing" : "grab", opacity: draggedCol === key ? 0.5 : 1 }}
                        >
                          <button
                            type="button"
                            onClick={() => onSort(key)}
                            className={cn(
                              "flex items-center gap-1 text-sm font-semibold transition-colors",
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
                    {canManageClients ? (
                      <th className="w-10 px-2 py-3" aria-label="Interactive control" />
                    ) : null}
                  </tr>
                </thead>
                <tbody className={cn("divide-y", isDark ? "divide-[#3d4a3d]/30" : "divide-slate-50")}>
                  {visibleRows.map((client, i) => (
                    <motion.tr
                      key={client.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03, duration: 0.2 }}
                      style={peopleTableRowStyle(rowH)}
                      className={cn("group transition-colors", t.tableRowHover)}
                    >
                      <td className={peopleTableCellClass("px-4", rowH)}>
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                              isDark ? "bg-[#191f31]" : "bg-linear-to-br from-slate-100 to-slate-200",
                            )}
                          >
                            <Building2 className={cn("h-4 w-4", isDark ? "text-[#3d4a3d]" : "text-slate-400")} />
                          </div>
                          <div className="min-w-0">
                            <p className={cn("text-sm font-semibold", t.tableCell)}>{client.name}</p>
                            {!enabledCols.has("projects") && (
                              <p className={cn("mt-0.5 truncate text-xs", t.tableCellMuted)}>{projectSummary(client)}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      {visibleColKeys.map((key) => renderCell(key, client, rowH))}
                      {canManageClients ? (
                        <td className={peopleTableCellClass("px-2", rowH)}>
                          <ClientRowMenu
                            client={client}
                            onEdit={() => onEdit(client.id)}
                            onArchive={() => onArchive(client.id)}
                            onDelete={() => onDelete(client.id)}
                            isDark={isDark}
                          />
                        </td>
                      ) : null}
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableScroll>
        ) : null}
      </PaginatedTableShell>
    </div>
  )
}
