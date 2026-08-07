/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useMemo, useRef, type Dispatch, type SetStateAction } from "react"
import { ChevronUp, ChevronDown } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { ALL_MEMBER_COLS } from "@/features/members/config/members-config"
import type { Member, MemberPatchBody, MemberEntryAction } from "@/features/members/models/member"
import { isOwnerRoleName } from "@/features/auth"
import { MEMBERS_TABLE_ROWS_PER_PAGE } from "@/features/members/config/ui-config"
import {
  usePaginatedTable,
  useAutoHiddenTableColumns,
  MEMBER_COL_AUTO_HIDE_PRIORITY,
  MEMBER_COL_MIN_WIDTH,
  getMembersTableFixedWidth,
  getMembersTableMinWidth,
  MEMBER_NAME_COL_MIN_WIDTH,
  MEMBER_ROLE_COL_MIN_WIDTH,
} from "@/features/members/hooks"
import { MembersTableColGroup } from "@/features/members/components/tables/members-table-colgroup"
import {
  PaginatedTableShell,
  TableScroll,
  TablePagination,
  peopleTableCellClass,
  peopleTableRowStyle,
} from "@/shared/tables/ui"
import { Avatar } from "@/shared/ui/avatar";
import { Skeleton } from "@/shared/ui/skeleton"
import { StatusDot } from "@/shared/ui/status-dot";
import { Checkbox } from "@/shared/ui/checkbox";
import { MemberRowMenu } from "@/features/members/components/menus/member-row-menu"

/* ── Helpers ────────────────────────────────────────────────── */

function getRoleSortRank(role: string): number {
  const r = role.trim().toLowerCase().replace(/\s+/g, "")
  if (r === "owner") return 10
  if (r === "superadmin") return 9
  if (r === "admin") return 8
  if (r === "supermanager" || r === "supermanger") return 7
  if (r === "manager" || r === "manger") return 6
  if (r === "employeesl2" || r === "employeel2") return 5
  if (r === "employeesl1" || r === "employeel1" || r === "l1") return 4
  if (r === "employeesl0" || r === "employeel0" || r === "l0" || r === "employee") return 3
  if (r === "client") return 2
  if (r === "viewer" || r === "user") return 1
  return 0
}

function getDisplayPayment(payment: string | undefined): string {
  if (!payment) return "0/hr"
  const clean = payment.trim()
  if (clean === "" || clean === "No rate set" || clean === "$0/hr" || clean === "0/hr") {
    return "0/hr"
  }
  return clean
}

function ColumnCellSkeleton({ isDark, rowH }: { isDark: boolean; rowH?: number }) {
  return (
    <td className={peopleTableCellClass("px-4", rowH)}>
      <Skeleton className={cn("h-4 w-20 max-w-full rounded", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
    </td>
  )
}

/* ── Main component ─────────────────────────────────────────── */

export function MembersTab({
  members,
  onRemoveMember,
  onRemoveFromTree,
  onPatchMember,
  onSaveProfile,
  onNavigate,
  enabledCols,
  selected,
  setSelected,
  search,
  sortCol,
  sortDir,
  onSort,
  colOrder,
  draggedCol,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  canManage = true,
  showActionsColumn,
  isRowManageable,
  enableBatchSelect = true,
  getRowAllowedEntries,
  isDark = false,
  currentUserMemberId,
  actorRole = "",
  rowsPerPage: defaultRowsPerPage = MEMBERS_TABLE_ROWS_PER_PAGE,
  maxRowsPerPage,
  autoHiddenCols: autoHiddenColsProp,
  loadingCols = new Set<string>(),
}: {
  members: Member[]
  onRemoveMember: (id: string) => void | Promise<void>
  onRemoveFromTree?: (id: string) => void | Promise<void>
  onPatchMember: (id: string, body: MemberPatchBody) => Promise<Member | undefined>
  onSaveProfile?: (
    id: string,
    payload: import("@/features/members/api/member-api").MemberProfilePayload,
    expectedUpdatedAt?: string,
  ) => Promise<Member>
  onNavigate?: (id: string) => void
  enabledCols: Set<string>
  selected: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  search: string
  sortCol: string | null
  sortDir: "asc" | "desc"
  onSort: (col: string) => void
  colOrder: string[]
  draggedCol: string | null
  onDragStart: (col: string) => void
  onDragOver: (e: React.DragEvent, col: string) => void
  onDrop: (col: string) => void
  onDragEnd: () => void
  canManage?: boolean
  showActionsColumn?: boolean
  /** When false, row is visible but read-only (e.g. upline in subtree). */
  isRowManageable?: (member: Member) => boolean
  /** When false, hides row checkboxes used for batch actions. */
  enableBatchSelect?: boolean
  getRowAllowedEntries?: (member: Member) => MemberEntryAction[]
  isDark?: boolean
  currentUserMemberId?: string
  actorRole?: string
  rowsPerPage?: number
  maxRowsPerPage?: number
  autoHiddenCols?: Set<string>
  loadingCols?: Set<string>
}) {
  const resolvedShowActionsColumn = showActionsColumn ?? canManage
  const showSelectColumn = canManage && enableBatchSelect

  function memberRoleName(member: Member): string {
    return member.role === "User" ? "Viewer" : (member.role_name || member.role || "")
  }

  function isBatchSelectable(member: Member): boolean {
    if (!showSelectColumn || isOwnerRoleName(memberRoleName(member))) return false
    return isRowManageable ? isRowManageable(member) : true
  }
  const selectColClass = cn(
    "sticky left-0 z-10 w-11 min-w-[44px] shrink-0 px-4",
    isDark ? "bg-[#151b2d] group-hover:bg-[#191f31]/60" : "bg-white group-hover:bg-slate-50/80",
  )
  const filtered = useMemo(() => {
    const q = (search || "").toLowerCase()
    let result = members.filter((m) => {
      const name = (m?.name || "").toLowerCase()
      const email = (m?.email || "").toLowerCase()
      return name.includes(q) || email.includes(q)
    })
    if (sortCol) {
      result.sort((a, b) => {
        let aVal: string | number
        let bVal: string | number
        switch (sortCol) {
          case "name":
            aVal = a.name
            bVal = b.name
            break
          case "status":
            aVal = a.trackingStatus
            bVal = b.trackingStatus
            break
          case "role":
            aVal = getRoleSortRank(a.role_name || a.role || "")
            bVal = getRoleSortRank(b.role_name || b.role || "")
            break
          case "projects":
            aVal = a.projects
            bVal = b.projects
            break
          case "payment":
            aVal = a.payment
            bVal = b.payment
            break
          case "limits":
            aVal = a.limits
            bVal = b.limits
            break
          case "date_added":
            aVal = a.dateAdded
            bVal = b.dateAdded
            break
          case "teams":
            aVal = a.teams ?? 0
            bVal = b.teams ?? 0
            break
          case "phone":
            aVal = a.phone || ""
            bVal = b.phone || ""
            break
          default:
            return 0
        }
        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDir === "asc" ? aVal - bVal : bVal - aVal
        }
        const left = String(aVal ?? "")
        const right = String(bVal ?? "")
        if (left < right) return sortDir === "asc" ? -1 : 1
        if (left > right) return sortDir === "asc" ? 1 : -1
        return 0
      })
    }

    if (currentUserMemberId) {
      const currentUserIndex = result.findIndex(m => m.id === currentUserMemberId)
      if (currentUserIndex > 0) {
        const [currentUser] = result.splice(currentUserIndex, 1)
        result.unshift(currentUser)
      }
    }

    return result
  }, [members, search, sortCol, sortDir, currentUserMemberId])

  const colConfig = ALL_MEMBER_COLS

  const tableBodyRef = useRef<HTMLDivElement>(null)

  const { currentPage, setCurrentPage, totalPages, visibleRows, fillsRemaining, rowsPerPage } = usePaginatedTable(
    filtered,
    defaultRowsPerPage,
    tableBodyRef,
    { maxRowsPerPage },
  )

  const fixedTableWidth = getMembersTableFixedWidth({
    showSelectColumn,
    showActionsColumn: resolvedShowActionsColumn,
    includeRoleColumn: enabledCols.has("role"),
  })
  const autoHiddenColsInternal = useAutoHiddenTableColumns(
    tableBodyRef,
    enabledCols,
    colOrder,
    MEMBER_COL_AUTO_HIDE_PRIORITY,
    MEMBER_COL_MIN_WIDTH,
    fixedTableWidth,
    ["role"],
    autoHiddenColsProp === undefined,
  )
  const autoHiddenCols = autoHiddenColsProp ?? autoHiddenColsInternal
  const visibleColKeys = useMemo(
    () => colOrder.filter((key) => enabledCols.has(key) && !autoHiddenCols.has(key)),
    [colOrder, enabledCols, autoHiddenCols],
  )
  const tableMinWidth = useMemo(
    () =>
      getMembersTableMinWidth(visibleColKeys, {
        showSelectColumn,
        showActionsColumn: resolvedShowActionsColumn,
      }),
    [visibleColKeys, showSelectColumn, resolvedShowActionsColumn],
  )

  const selectableVisibleRows = visibleRows.filter(isBatchSelectable)
  const allSelected = selectableVisibleRows.length > 0 && selectableVisibleRows.every((m) => selected.has(m.id))

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(selectableVisibleRows.map((m) => m.id)))
  }
  function toggleOne(id: string) {
    const member = visibleRows.find((m) => m.id === id)
    if (member && !isBatchSelectable(member)) return
    setSelected((prev) => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <PaginatedTableShell
        isDark={isDark}
        fillsRemaining={fillsRemaining}
        isEmpty={filtered.length === 0}
        emptyContent="No members found"
        footer={
          filtered.length > 0 ? (
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filtered.length}
              rowsPerPage={rowsPerPage}
              onPageChange={setCurrentPage}
              isDark={isDark}
            />
          ) : undefined
        }
      >
        {filtered.length > 0 ? (
          <TableScroll visibleRowCount={visibleRows.length} scrollRef={tableBodyRef} className="overflow-x-auto">
            {(rowH) => (
              <table
                className="h-full w-full table-fixed"
                style={{ minWidth: tableMinWidth }}
              >
                <MembersTableColGroup
                  visibleColKeys={visibleColKeys}
                  showSelectColumn={showSelectColumn}
                  showActionsColumn={resolvedShowActionsColumn}
                />
                <thead>
                  <tr className={cn("border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
                    {showSelectColumn && (
                      <th className={cn(selectColClass, "py-3", isDark ? "bg-[#151b2d]" : "bg-white")}>
                        <Checkbox checked={allSelected} onChange={toggleAll} isDark={isDark} />
                      </th>
                    )}
                    <th
                      className="shrink-0 px-4 py-3 text-left"
                      style={{ minWidth: MEMBER_NAME_COL_MIN_WIDTH, width: MEMBER_NAME_COL_MIN_WIDTH }}
                    >
                      <button onClick={() => onSort("name")} className={cn("flex items-center gap-1 text-sm font-semibold transition-colors", isDark ? "text-[#dce1fb] hover:text-[#4be277]" : "text-slate-700 hover:text-blue-500")} type="button">
                        Member
                        {sortCol === "name" && (sortDir === "asc" ? <ChevronUp className={cn("w-3.5 h-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} /> : <ChevronDown className={cn("w-3.5 h-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} />)}
                      </button>
                    </th>
                    {visibleColKeys.map(key => {
                      const config = colConfig.find(c => c.key === key)
                      if (!config) return null
                      const isRoleCol = key === "role"
                      return (
                        <th
                          key={key}
                          className={cn("px-4 py-3 text-left", isRoleCol && "shrink-0")}
                          draggable
                          onDragStart={(e) => {
                            if (e.target instanceof HTMLButtonElement) {
                              e.preventDefault()
                            } else {
                              onDragStart(key)
                            }
                          }}
                          onDragOver={(e) => onDragOver(e, key)}
                          onDrop={() => onDrop(key)}
                          onDragEnd={onDragEnd}
                          style={{
                            cursor: draggedCol ? "grabbing" : "grab",
                            opacity: draggedCol === key ? 0.5 : 1,
                            ...(isRoleCol
                              ? { minWidth: MEMBER_ROLE_COL_MIN_WIDTH, width: MEMBER_ROLE_COL_MIN_WIDTH }
                              : {}),
                          }}
                        >
                          <button onClick={() => onSort(key)} className={cn("flex items-center gap-1 text-sm font-semibold transition-colors", isDark ? "text-[#dce1fb] hover:text-[#4be277]" : "text-slate-700 hover:text-blue-500")} type="button">
                            {config.label}
                            {sortCol === key && (sortDir === "asc" ? <ChevronUp className={cn("w-3.5 h-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} /> : <ChevronDown className={cn("w-3.5 h-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} />)}
                          </button>
                        </th>
                      )
                    })}
                    {resolvedShowActionsColumn && <th className="w-12 px-2" aria-label="Interactive control" />}
                  </tr>
                </thead>
                <tbody className={cn("divide-y", isDark ? "divide-[#3d4a3d]/40" : "divide-slate-50")}>
                  {visibleRows.map((member) => (
                    <tr
                      key={member.id}
                      style={peopleTableRowStyle(rowH)}
                      className={cn(
                        "group transition-colors",
                        isDark ? "hover:bg-[#191f31]/60" : "hover:bg-slate-50/80",
                        selected.has(member.id) && (isDark ? "bg-[#4be277]/10" : "bg-blue-50/40")
                      )}>
                      {showSelectColumn && (
                        <td
                          className={peopleTableCellClass(
                            cn(
                              selectColClass,
                              selected.has(member.id) && (isDark ? "bg-[#4be277]/10" : "bg-blue-50/40"),
                            ),
                            rowH,
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isBatchSelectable(member) ? (
                            <Checkbox checked={selected.has(member.id)} onChange={() => toggleOne(member.id)} isDark={isDark} />
                          ) : (
                            <span className="inline-block h-4 w-4" aria-hidden />
                          )}
                        </td>
                      )}
                      <td
                        className={peopleTableCellClass("shrink-0 px-4", rowH)}
                        style={{ minWidth: MEMBER_NAME_COL_MIN_WIDTH, width: MEMBER_NAME_COL_MIN_WIDTH }}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar initials={member.avatar} color={member.avatarColor} imageUrl={member.avatarUrl} alt={member.name} isDark={isDark} />
                          <div className="min-w-0">
                            <p className={cn("whitespace-nowrap text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-700")}>{member.name}</p>
                            <p className={cn("whitespace-nowrap text-xs", isDark ? "text-[#bccbb9]" : "text-slate-400")}>{member.email}</p>
                          </div>
                        </div>
                      </td>
                      {visibleColKeys.map((key) => {
                        if (loadingCols.has(key)) {
                          return <ColumnCellSkeleton key={key} isDark={isDark} rowH={rowH} />
                        }
                        if (key === "status") return <td key="status" className={peopleTableCellClass("px-4", rowH)}><StatusDot status={member.trackingStatus} isDark={isDark} /></td>
                        if (key === "role") {
                          const displayRole =
                            member.role === "User"
                              ? "Viewer"
                              : (member.role_name || member.role || "")
                          return (
                            <td
                              key="role"
                              className={peopleTableCellClass(
                                cn("whitespace-nowrap px-4 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600"),
                                rowH,
                              )}
                              style={{ minWidth: MEMBER_ROLE_COL_MIN_WIDTH, width: MEMBER_ROLE_COL_MIN_WIDTH }}
                            >
                              {displayRole}
                            </td>
                          )
                        }
                        if (key === "projects") return <td key="projects" className={peopleTableCellClass(cn("truncate px-4 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600"), rowH)}>{member.projects}</td>
                        if (key === "payment") return <td key="payment" className={peopleTableCellClass(cn("truncate px-4 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600"), rowH)}>{getDisplayPayment(member.payment)}</td>
                        if (key === "limits") return <td key="limits" className={peopleTableCellClass(cn("truncate px-4 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600"), rowH)}>{member.limits}</td>
                        if (key === "date_added") return <td key="date_added" className={peopleTableCellClass(cn("px-4 text-sm whitespace-nowrap", isDark ? "text-[#bccbb9]" : "text-slate-600"), rowH)}>{member.dateAdded}</td>
                        if (key === "teams") return <td key="teams" className={peopleTableCellClass(cn("px-4 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600"), rowH)}>{member.teams ?? 0}</td>
                        if (key === "phone") return <td key="phone" className={peopleTableCellClass(cn("px-4 text-sm whitespace-nowrap", isDark ? "text-[#bccbb9]" : "text-slate-600"), rowH)}>{member.phone?.trim() || "—"}</td>
                        return null
                      })}
                      {resolvedShowActionsColumn && (
                        <td
                          className={peopleTableCellClass("px-2", rowH)}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MemberRowMenu
                            member={member}
                            onPatchMember={onPatchMember}
                            onSaveProfile={onSaveProfile}
                            onRemoveMember={onRemoveMember}
                            onRemoveFromTree={onRemoveFromTree}
                            onNavigate={onNavigate}
                            allowedEntries={getRowAllowedEntries?.(member)}
                            isDark={isDark}
                            actorRole={actorRole}
                          />
                        </td>
                      )}
                    </tr>
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

