/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useMemo, useRef, type Dispatch, type SetStateAction } from "react"
import { ChevronUp, ChevronDown, Mail } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { Invite, InvitePatchBody } from "@/features/members/models/member"
import { MEMBERS_TABLE_ROWS_PER_PAGE } from "@/features/members/config/ui-config"
import { MEMBER_ROLE_COL_MIN_WIDTH } from "@/features/members/hooks/use-auto-hidden-table-columns"
import { usePaginatedTable } from "@/features/members/hooks"
import {
  PaginatedTableShell,
  TableScroll,
  TablePagination,
  peopleTableCellClass,
  peopleTableRowStyle,
} from "@/shared/tables/ui"
import { InviteRowActionsMenu } from "@/features/members/components/menus/invite-row-actions-menu"
import { Checkbox } from "@/shared/ui/checkbox";

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

const colConfig = [
    { key: "email", label: "Member" },
    { key: "role", label: "Role" },
    { key: "projects", label: "Projects" },
    { key: "payment", label: "Payment" },
    { key: "weeklyLimit", label: "Weekly limit" },
    { key: "status", label: "Status" },
  ]

export function InvitesTab({
  invites,
  search,
  selected,
  setSelected,
  onPatchInvite,
  onRemoveInvite,
  onResendInvite,
  onCopyInviteLink,
  onRenewInvite,
  onActionMessage,
  onNavigate,
  sortCol,
  sortDir,
  onSort,
  colOrder,
  draggedCol,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDark = false,
  rowsPerPage: defaultRowsPerPage = MEMBERS_TABLE_ROWS_PER_PAGE,
  maxRowsPerPage,
}: {
  invites: Invite[]
  search: string
  selected: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  onPatchInvite: (id: string, body: InvitePatchBody) => Promise<void>
  onRemoveInvite: (id: string) => void | Promise<void>
  onResendInvite: (id: string) => Promise<{
    emailSent: boolean
    inviteUrl: string
    channel?: string
    emailError?: string
    emailDeliveryConfigured?: boolean
  }>
  onCopyInviteLink: (id: string) => Promise<string>
  onRenewInvite: (id: string) => Promise<void>
  onActionMessage?: (payload: { tone: "info" | "error"; message: string }) => void
  onNavigate?: (id: string) => void
  sortCol: string | null
  sortDir: "asc" | "desc"
  onSort: (col: string) => void
  colOrder: string[]
  draggedCol: string | null
  onDragStart: (col: string) => void
  onDragOver: (e: React.DragEvent, col: string) => void
  onDrop: (col: string) => void
  onDragEnd: () => void
  isDark?: boolean
  rowsPerPage?: number
  maxRowsPerPage?: number
}) {
  const filtered = useMemo(() => {
    const q = (search || "").toLowerCase()
    let result = invites.filter((i) => (i?.email || "").toLowerCase().includes(q))
    if (sortCol) {
      result.sort((a, b) => {
        let aVal: string | number
        let bVal: string | number
        switch (sortCol) {
          case "email":
            aVal = a.email
            bVal = b.email
            break
          case "role":
            aVal = getRoleSortRank(a.role)
            bVal = getRoleSortRank(b.role)
            break
          case "teams":
            aVal = a.teams
            bVal = b.teams
            break
          case "projects":
            aVal = a.projects
            bVal = b.projects
            break
          case "payment":
            aVal = a.payment
            bVal = b.payment
            break
          case "weeklyLimit":
            aVal = a.weeklyLimit
            bVal = b.weeklyLimit
            break
          case "status":
            aVal = a.status
            bVal = b.status
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
    return result
  }, [invites, search, sortCol, sortDir])
  const tableBodyRef = useRef<HTMLDivElement>(null)
  const { currentPage, setCurrentPage, totalPages, visibleRows, fillsRemaining, rowsPerPage } = usePaginatedTable(
    filtered,
    defaultRowsPerPage,
    tableBodyRef,
    { maxRowsPerPage },
  )

  const allSelected = visibleRows.length > 0 && visibleRows.every((i) => selected.has(i.id))

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(visibleRows.map((i) => i.id)))
  }

  function toggleOne(id: string) {
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
        emptyContent="No invites found"
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
          <TableScroll visibleRowCount={visibleRows.length} scrollRef={tableBodyRef}>
            {(rowH) => (
          <table className="w-full h-full">
            <thead>
              <tr className={cn("border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
                <th className="px-5 py-3 w-10">
                  <Checkbox checked={allSelected} onChange={toggleAll} isDark={isDark} />
                </th>
                {colOrder.map((key) => {
                  const config = colConfig.find((c) => c.key === key)
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
                        {sortCol === key && (sortDir === "asc" ? <ChevronUp className={cn("h-3.5 w-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} /> : <ChevronDown className={cn("h-3.5 w-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} />)}
                      </button>
                    </th>
                  )
                })}
                <th className="w-12 px-2" aria-label="Interactive control" />
              </tr>
            </thead>
            <tbody className={cn("divide-y", isDark ? "divide-[#3d4a3d]/40" : "divide-slate-50")}>
              {visibleRows.map((invite) => (
                  <tr
                    key={invite.id}
                    style={peopleTableRowStyle(rowH)}
                    className={cn("group transition-colors", isDark ? "hover:bg-[#191f31]/60" : "hover:bg-slate-50/80", selected.has(invite.id) && (isDark ? "bg-[#4be277]/10" : "bg-blue-50/40"))}
                  >
                    <td className={peopleTableCellClass("px-5 w-10", rowH)}>
                      <Checkbox checked={selected.has(invite.id)} onChange={() => toggleOne(invite.id)} isDark={isDark} />
                    </td>
                    {colOrder.map((key) => {
                      if (key === "email") {
                        return (
                          <td key="email" className={peopleTableCellClass("px-4", rowH)}>
                            <div className="flex items-center gap-3">
                              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", isDark ? "bg-blue-500/20" : "bg-blue-100")}>
                                <Mail className={cn("h-4 w-4", isDark ? "text-blue-400" : "text-blue-400")} />
                              </div>
                              <div>
                                <p className={cn("text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-700")}>{invite.email}</p>
                                <p className={cn("text-xs", isDark ? "text-[#bccbb9]" : "text-slate-400")}>
                                  {invite.listKind === "pending_account"
                                    ? "Pending account"
                                    : invite.inviteKind === "open_link"
                                      ? "Share link · one-time use"
                                      : "Email invite"}
                                </p>
                              </div>
                            </div>
                          </td>
                        )
                      }
                      if (key === "role") {
                        const displayRole = invite.role === "User" ? "Viewer" : invite.role
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
                      if (key === "teams") return <td key="teams" className={peopleTableCellClass(cn("px-4 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600"), rowH)}>{invite.teams}</td>
                      if (key === "projects") return <td key="projects" className={peopleTableCellClass(cn("px-4 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600"), rowH)}>{invite.projects}</td>
                      if (key === "payment") return <td key="payment" className={peopleTableCellClass(cn("px-4 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600"), rowH)}>{getDisplayPayment(invite.payment)}</td>
                      if (key === "weeklyLimit") return <td key="weeklyLimit" className={peopleTableCellClass(cn("px-4 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-600"), rowH)}>{invite.weeklyLimit}</td>
                      if (key === "status") {
                        return (
                          <td key="status" className={peopleTableCellClass("px-4", rowH)}>
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                                invite.status === "Pending" && "bg-emerald-500 text-white",
                                invite.status === "Pending sign-in" && "bg-amber-500 text-white",
                                invite.status === "Awaiting signup" && "bg-sky-500 text-white",
                                invite.status === "Expired" && "bg-slate-400 text-white",
                                invite.status !== "Pending" &&
                                  invite.status !== "Pending sign-in" &&
                                  invite.status !== "Awaiting signup" &&
                                  invite.status !== "Expired" &&
                                  "bg-slate-200 text-slate-600",
                              )}
                            >
                              {invite.status}
                            </span>
                          </td>
                        )
                      }
                      return null
                    })}
                    <td className={peopleTableCellClass("px-2", rowH)}>
                      <InviteRowActionsMenu
                        invite={invite}
                        onPatchInvite={onPatchInvite}
                        onRemoveInvite={onRemoveInvite}
                        onResendInvite={onResendInvite}
                        onCopyInviteLink={onCopyInviteLink}
                        onRenewInvite={onRenewInvite}
                        onActionMessage={onActionMessage}
                        onNavigate={onNavigate}
                        isDark={isDark}
                      />
                    </td>
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
