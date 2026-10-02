"use client"

import { useCallback, useEffect, useMemo, useState as useComponentState } from "react"
import { GitBranch, LayoutList, Share2, ShieldAlert, Users } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import { usePermissions } from "@/features/auth/hooks/use-permissions"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { moveMemberInTree, type MemberTreeNode, type MemberTreeScope } from "@/features/members/services/member-tree"
import { AddMemberAtNodeModal } from "@/features/members/components/modals/add-member-at-node-modal"
import { buildMemberTreeBranches, countTreeMembers, maxTreeDepth } from "@/features/members/utils/build-tree"
import { MemberTreeConnectionsView } from "@/features/members/tree-connections/connections-view"
import { MemberTreeListView } from "@/features/members/tree-connections/list-view"
import { useMemberTreeData } from "@/features/members/hooks/use-member-tree-data"
import { MemberTreeContentSkeleton } from "@/features/members/components/skeletons/member-tree-page-skeleton"
import { TableRefreshButton } from "@/shared/tables/ui"
import { DEFAULT_TREE_CHART_SETTINGS, type TreeChartDisplaySettings } from "@/shared/ui/tree-chart"

type TreeViewMode = "list" | "connections"

function TreeViewModeToggle({
  viewMode,
  onChange,
  isDark,
}: {
  viewMode: TreeViewMode
  onChange: (mode: TreeViewMode) => void
  isDark: boolean
}) {
  const button = (mode: TreeViewMode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      aria-pressed={viewMode === mode}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
        viewMode === mode
          ? isDark
            ? "bg-slate-800 text-white shadow-sm ring-1 ring-slate-700"
            : "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
          : isDark
            ? "text-slate-400 hover:text-slate-200"
            : "text-slate-500 hover:text-slate-800",
      )}
    >
      {icon}
      {label}
    </button>
  )
  return (
    <div
      className={cn(
        "inline-flex rounded-xl border p-1 shadow-inner",
        isDark ? "border-slate-800 bg-slate-900/80" : "border-slate-200/80 bg-slate-100/80",
      )}
      role="group"
      aria-label="Tree view mode"
    >
      {button("list", "List", <LayoutList className="h-3.5 w-3.5" />)}
      {button("connections", "Connections", <Share2 className="h-3.5 w-3.5" />)}
    </div>
  )
}

export function MemberTreePage() {
  const { isDark } = useTheme()
  const { canSeeAllMembers, isManagerScopedRole } = usePermissions()

  const canToggleScope = canSeeAllMembers
  const defaultScope: MemberTreeScope = canSeeAllMembers ? "organization" : "team"
  const [viewScope, setViewScope] = useComponentState<MemberTreeScope>(defaultScope)

  return (
    <MemberTreeScopeView
      viewScope={viewScope}
      isDark={isDark}
      canToggleScope={canToggleScope}
      isManagerScopedRole={isManagerScopedRole}
      onScopeChange={setViewScope}
    />
  )
}

function MemberTreeScopeView({
  viewScope,
  isDark,
  canToggleScope,
  isManagerScopedRole,
  onScopeChange,
}: {
  viewScope: MemberTreeScope
  isDark: boolean
  canToggleScope: boolean
  isManagerScopedRole: boolean
  onScopeChange: (scope: MemberTreeScope) => void
}) {
  const { memberId } = useAuth()
  const { canManageMembers, isOwner, isSuperAdmin } = usePermissions()
  // Who reports to whom decides who can see whom, so only Owner and Super Admin change it, and
  // only from the organization view (the team view shows upline members they cannot edit).
  const canReassign = viewScope === "organization" && (isOwner || isSuperAdmin)
  const t = isDark ? dark : light
  // "Add member here" (item 16): which node the invite modal is open for.
  const [addUnder, setAddUnder] = useComponentState<MemberTreeNode | null>(null)

  const [viewMode, setViewMode] = useComponentState<TreeViewMode>("list")
  // The List's "show in chart": switch views and ask the chart to land on that member.
  const [focusRequest, setFocusRequest] = useComponentState<{ id: string; nonce: number } | null>(null)
  const showInChart = useCallback((id: string) => {
    setViewMode("connections")
    setFocusRequest({ id, nonce: Date.now() })
  }, [])

  // One error per scope. They used to share a single error, so a failure
  // loading one scope (for a manager: the organization tree, which is a
  // guaranteed 403) showed up while looking at the other, and could land
  // after the visible scope had already loaded and cleared it.
  const [scopeErrors, setScopeErrors] = useComponentState<Record<MemberTreeScope, string>>({
    organization: "",
    team: "",
  })
  const error = scopeErrors[viewScope] ?? ""
  const setError = useCallback(
    (message: string) => setScopeErrors((prev) => ({ ...prev, [viewScope]: message })),
    [viewScope],
  )
  const [chartSettings, setChartSettings] = useComponentState<TreeChartDisplaySettings>(DEFAULT_TREE_CHART_SETTINGS)

  const handleOrgError = useCallback((err: unknown) => {
    setScopeErrors((prev) => ({ ...prev, organization: err instanceof Error ? err.message : "Failed to load member tree" }))
  }, [])
  const handleTeamError = useCallback((err: unknown) => {
    setScopeErrors((prev) => ({ ...prev, team: err instanceof Error ? err.message : "Failed to load member tree" }))
  }, [])

  // canToggleScope is exactly "may load the organization scope" (Owner/
  // Super Admin/Admin - the same roles the backend's requireOrgTreeRole
  // allows), so nobody else fires a request that can only be refused.
  const organizationTree = useMemberTreeData("organization", handleOrgError, { allowed: canToggleScope })
  const teamTree = useMemberTreeData("team", handleTeamError)

  const activeTree = viewScope === "organization" ? organizationTree : teamTree
  const {
    data: treeGraph,
    isLoading,
    refetch,
  } = activeTree

  const [isRefreshing, setIsRefreshing] = useComponentState(false)

  const nodes = treeGraph.nodes
  const edges = treeGraph.edges
  const validRootIds = treeGraph.valid_root_member_ids ?? []

  useEffect(() => {
    if (nodes.length > 0) setError("")
  }, [viewScope, nodes.length, setError])

  const updateChartSettings = useCallback((patch: Partial<TreeChartDisplaySettings>) => {
    setChartSettings((current) => ({ ...current, ...patch }))
  }, [])

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    setError("")
    try {
      await refetch({ forceRefetch: true, showLoading: false })
      setError("")
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing, refetch, setError])

  const handleReassign = useCallback(
    async (movedId: string, newParentId: string) => {
      await moveMemberInTree(movedId, newParentId)
      // The server has changed the hierarchy: reload both views of it so neither shows the old one.
      await Promise.allSettled([
        organizationTree.refetch({ forceRefetch: true, showLoading: false }),
        teamTree.refetch({ forceRefetch: true, showLoading: false }),
      ])
    },
    [organizationTree, teamTree],
  )

  const tree = useMemo(
    () => buildMemberTreeBranches(nodes, edges, null, viewScope === "organization" ? validRootIds : null),
    [nodes, edges, viewScope, validRootIds],
  )
  const memberCount = useMemo(() => countTreeMembers(tree), [tree])
  const treeDepth = useMemo(() => maxTreeDepth(tree), [tree])

  const chip = cn("inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium", isDark ? "bg-[#191f31] text-[#bccbb9]" : "bg-slate-50 text-slate-600")
  const ready = !isLoading && !error

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
        {/* One bar: refresh and the view switch on the left, the numbers in the middle, the scope on the right. */}
        <div className={cn("shrink-0 rounded-xl border px-3 py-2.5", t.tableBorder, t.tableBg)}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 lg:grid lg:grid-cols-[1fr_auto_1fr]">
            <div className="flex items-center gap-2 lg:justify-self-start">
              <TableRefreshButton
                onClick={() => void handleRefresh()}
                isRefreshing={isRefreshing || (isLoading && nodes.length > 0)}
                isDark={isDark}
              />
              <TreeViewModeToggle
                viewMode={viewMode}
                onChange={(mode) => {
                  setViewMode(mode)
                  if (mode === "list") setFocusRequest(null)
                }}
                isDark={isDark}
              />
            </div>

            <div className="order-last flex w-full flex-wrap items-center justify-center gap-3 lg:order-none lg:w-auto">
              {ready ? (
                <>
                  <div className={chip}>
                    <Users className="h-3.5 w-3.5" />
                    {memberCount} member{memberCount === 1 ? "" : "s"}
                  </div>
                  <div className={chip}>
                    <GitBranch className="h-3.5 w-3.5" />
                    {treeDepth} level{treeDepth === 1 ? "" : "s"} deep
                  </div>
                </>
              ) : (
                <div className={cn("text-xs", isDark ? "text-[#8a9588]" : "text-slate-400")}>
                  {isLoading && nodes.length === 0 ? "Loading hierarchy…" : "Unable to load stats"}
                </div>
              )}
            </div>

            <div className="lg:justify-self-end">
              {canToggleScope ? (
                <div className={cn("inline-flex rounded-lg border p-0.5", isDark ? "border-[#3d4a3d]/40 bg-[#191f31]" : "border-slate-200 bg-slate-100")}>
                  {(["organization", "team"] as const).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => onScopeChange(scope)}
                      aria-pressed={viewScope === scope}
                      title={scope === "organization" ? "Everyone in the workspace" : "Your branch from the org root through members you manage"}
                      className={cn(
                        "rounded-md px-3 py-2 text-xs font-semibold transition-all",
                        viewScope === scope
                          ? isDark
                            ? "bg-[#151b2d] text-[#dce1fb] shadow-sm"
                            : "bg-white text-slate-900 shadow-sm"
                          : isDark
                            ? "text-[#bccbb9] hover:text-[#dce1fb]"
                            : "text-slate-500 hover:text-slate-700",
                      )}
                    >
                      {scope === "organization" ? "Organization" : "My team"}
                    </button>
                  ))}
                </div>
              ) : isManagerScopedRole ? (
                <span
                  title="Your branch from the org root through members you manage - upline roles are visible but not editable"
                  className={cn("rounded-full px-3 py-1 text-xs font-semibold", isDark ? "bg-[#2e3447] text-[#bccbb9]" : "bg-slate-100 text-slate-600")}
                >
                  My team view
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
          {isLoading && nodes.length === 0 ? (
            <MemberTreeContentSkeleton isDark={isDark} />
          ) : error && nodes.length === 0 ? (
            <div className={cn("rounded-xl border p-5 text-sm", isDark ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-red-200 bg-red-50 text-red-700")}>
              <div className="flex items-center gap-2 font-medium">
                <ShieldAlert className="h-4 w-4" />
                Could not load tree
              </div>
              <p className="mt-1">{error}</p>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                className={cn(
                  "mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold",
                  isDark ? "bg-[#191f31] text-[#dce1fb] hover:bg-[#232a3f]" : "bg-white text-slate-700 shadow-sm hover:bg-slate-50",
                )}
              >
                Try again
              </button>
            </div>
          ) : !tree.length && !nodes.length ? (
            <div className={cn("rounded-xl border p-8 text-center text-sm", t.tableBorder, t.tableBg, isDark ? "text-[#bccbb9]" : "text-slate-500")}>
              No members found for this view.
            </div>
          ) : (
            <div className={cn("flex h-full min-h-0 flex-col overflow-hidden rounded-xl border", t.tableBorder, t.tableBg)}>
              {viewMode === "connections" ? (
                <MemberTreeConnectionsView
                  nodes={nodes}
                  edges={edges}
                  validRootMemberIds={viewScope === "organization" ? validRootIds : null}
                  scope={viewScope}
                  viewerId={memberId}
                  isDark={isDark}
                  settings={chartSettings}
                  onSettingsChange={updateChartSettings}
                  canReassign={canReassign}
                  onAddHere={canManageMembers ? setAddUnder : undefined}
                  onReassign={canReassign ? handleReassign : undefined}
                  focusRequest={focusRequest}
                />
              ) : (
                <MemberTreeListView
                  nodes={nodes}
                  edges={edges}
                  validRootMemberIds={viewScope === "organization" ? validRootIds : null}
                  scope={viewScope}
                  viewerId={memberId}
                  isDark={isDark}
                  canReassign={canReassign}
                  onAddHere={canManageMembers ? setAddUnder : undefined}
                  onReassign={canReassign ? handleReassign : undefined}
                  onShowInChart={showInChart}
                />
              )}
            </div>
          )}
        </div>
      </div>
      {addUnder ? <AddMemberAtNodeModal parent={addUnder} onClose={() => setAddUnder(null)} /> : null}
    </div>
  )
}
