"use client"

import { useCallback, useMemo, useState } from "react"
import { Search, ShieldBan } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { usePageSearch } from "@/shared/ui/layout"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { Avatar } from "@/shared/ui/avatar"
import { PaginatedTableShell, TableRefreshButton, TableScroll } from "@/shared/tables/ui"
import { useCachedList } from "@/features/members/hooks"
import { changedEvent } from "@/infrastructure/api/change-events"
import { useResponsiveRowCap } from "@/shared/tables/hooks/use-responsive-row-cap"
import { MEMBERS_TABLE_ROWS_PER_PAGE, PEOPLE_TABLE_ROW_CAP_BY_BREAKPOINT } from "@/features/members/config/ui-config"
import { MemberBansSkeleton } from "@/features/members/components/skeletons/member-bans-skeleton"
import {
  fetchMemberBans,
  revokeMemberBan,
  type MemberBanRecord,
} from "@/features/members/api/member-ban-api"
import { BanMemberModal } from "@/features/members/components/modals/ban-member-modal"
import { invalidatePeopleMemberCaches } from "@/shared/tables/hooks/list-cache-registry"

export function MemberBansPage() {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  const tableRowCap = useResponsiveRowCap(PEOPLE_TABLE_ROW_CAP_BY_BREAKPOINT)
  const { query: search, setQuery: setSearch } = usePageSearch()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [showBanModal, setShowBanModal] = useState(false)

  const {
    data: bans,
    setData: setBans,
    isLoading,
    refetch: refetchBans,
  } = useCachedList<MemberBanRecord[]>({
    cacheKey: "people:member-bans",
    fetch: fetchMemberBans,
    staleMs: 300_000,
    minLoadingMs: 0,
    initialData: [],
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to load bans."),
    presencePingEvent: changedEvent("member-bans"),
    backgroundRefetch: { forceRefetch: true },
  })

  const showListSkeleton = isLoading && bans.length === 0

  const filteredBans = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return bans
    return bans.filter(
      (ban) =>
        ban.memberName.toLowerCase().includes(q) ||
        (ban.email || "").toLowerCase().includes(q) ||
        ban.reason.toLowerCase().includes(q),
    )
  }, [bans, search])

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    setError(null)
    try {
      await refetchBans({ forceRefetch: true, showLoading: false })
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing, refetchBans])

  async function handleRevoke(ban: MemberBanRecord) {
    if (revokingId) return
    setRevokingId(ban.id)
    setError(null)
    try {
      await revokeMemberBan(ban.id)
      setBans((prev) => prev.filter((row) => row.id !== ban.id))
      invalidatePeopleMemberCaches(ban.memberId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke ban.")
    } finally {
      setRevokingId(null)
    }
  }

  async function handleBanned() {
    setShowBanModal(false)
    invalidatePeopleMemberCaches()
    await refetchBans({ forceRefetch: true, showLoading: false })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
          <div className={cn("relative max-w-md flex-1 rounded-xl border", t.searchWrap)}>
            <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", t.searchIcon)} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search banned members..."
              className={cn("w-full bg-transparent py-2 pl-10 pr-4 text-sm focus:outline-none", t.searchInput)}
              aria-label="Search banned members"
            />
          </div>

          <div className="flex items-center gap-2">
            <TableRefreshButton onClick={() => void handleRefresh()} isRefreshing={isRefreshing} isDark={isDark} />
            <button
              type="button"
              onClick={() => setShowBanModal(true)}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-md shadow-rose-600/20 transition-all hover:scale-[1.02] hover:shadow-rose-600/30 active:scale-95 bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400"
            >
              <ShieldBan className="h-4 w-4" />
              Ban member
            </button>
          </div>
        </div>

        {error ? (
          <div
            className={cn(
              "mb-3 rounded-lg border px-4 py-2 text-sm",
              isDark ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-red-200 bg-red-50 text-red-700",
            )}
          >
            {error}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          {showListSkeleton ? (
            <MemberBansSkeleton
              isDark={isDark}
              rowCount={MEMBERS_TABLE_ROWS_PER_PAGE}
              maxRowsPerPage={tableRowCap}
              fillHeight
            />
          ) : (
            <PaginatedTableShell
              isDark={isDark}
              fillsRemaining
              isEmpty={filteredBans.length === 0}
              emptyContent={
                <div className="flex flex-col items-center">
                  <div className={cn("mb-2 flex h-10 w-10 items-center justify-center rounded-full", isDark ? "bg-[#191f31]" : "bg-slate-100")}>
                    <ShieldBan className={cn("h-5 w-5", isDark ? "text-[#3d4a3d]" : "text-slate-300")} />
                  </div>
                  <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                    {search ? `No bans matching "${search}"` : "No active bans."}
                  </p>
                  {!search ? (
                    <button
                      type="button"
                      onClick={() => setShowBanModal(true)}
                      className={cn("mt-2 text-sm font-medium hover:underline", isDark ? "text-[#4be277]" : "text-blue-500")}
                    >
                      + Ban member
                    </button>
                  ) : null}
                </div>
              }
            >
              {filteredBans.length > 0 ? (
                <TableScroll visibleRowCount={filteredBans.length}>
                  {() => (
                    <table className="h-full w-full min-w-[640px]">
                      <thead className={cn("border-b", t.tableBorder, t.tableBg)}>
                        <tr className={t.tableHeader}>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Member</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Reason</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider">Revoke</th>
                        </tr>
                      </thead>
                      <tbody className={cn("divide-y", t.tableBorder)}>
                        {filteredBans.map((ban) => (
                          <tr key={ban.id} className={cn("transition-colors", t.tableRowHover)}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <Avatar
                                  initials={
                                    ban.memberName
                                      .split(" ")
                                      .map((p) => p[0])
                                      .join("")
                                      .slice(0, 2)
                                      .toUpperCase() || "??"
                                  }
                                  color="#ef4444"
                                  size="sm"
                                  alt={ban.memberName}
                                  isDark={isDark}
                                />
                                <div className="min-w-0">
                                  <p className={cn("truncate font-semibold", t.tableCell)}>{ban.memberName}</p>
                                  <p className={cn("truncate text-xs", t.tableCellMuted)}>{ban.email || "No email on file"}</p>
                                </div>
                              </div>
                            </td>
                            <td className={cn("px-4 py-3 align-top", t.tableCell)}>
                              <p className="whitespace-pre-wrap wrap-break-word">{ban.reason}</p>
                              {ban.bannedAt ? (
                                <p className={cn("mt-1 text-xs", t.tableCellMuted)}>
                                  Banned {new Date(ban.bannedAt).toLocaleString()}
                                  {ban.bannedByName ? ` · by ${ban.bannedByName}` : ""}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-right align-top">
                              <button
                                type="button"
                                disabled={revokingId === ban.id}
                                onClick={() => void handleRevoke(ban)}
                                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                              >
                                {revokingId === ban.id ? "Removing…" : "Remove ban"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </TableScroll>
              ) : null}
            </PaginatedTableShell>
          )}
        </div>
      </div>

      {showBanModal ? (
        <BanMemberModal onClose={() => setShowBanModal(false)} onBanned={handleBanned} />
      ) : null}
    </div>
  )
}
