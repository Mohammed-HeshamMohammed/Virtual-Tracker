"use client"

import { useCallback, useEffect, useMemo, useState as useComponentState } from "react"
import { GitBranch, LayoutList, Maximize2, Minus, Network, Plus, Share2, ShieldAlert, Users } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import { usePermissions } from "@/features/auth/hooks/use-permissions"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { type MemberTreeScope } from "@/features/members/services/member-tree"
import {
  buildMemberTreeBranches,
  countTreeMembers,
  initialsFromName,
  maxTreeDepth,
  memberAvatarColor,
  type MemberTreeBranch,
} from "@/features/members/utils/build-tree"
import { Avatar } from "@/shared/ui/avatar"
import {
  MemberTreeConnectionsView,
  DEFAULT_TREE_CHART_TRANSFORM,
  zoomTreeChartIn,
  zoomTreeChartOut,
} from "@/features/members/pages/member-tree-connections-view"
import { useMemberTreeData } from "@/features/members/hooks/use-member-tree-data"
import { MemberTreeContentSkeleton } from "@/features/members/components/skeletons/member-tree-page-skeleton"
import { TableRefreshButton, TableToolbarIconButton } from "@/shared/tables/ui"
import {
  DEFAULT_TREE_CHART_SETTINGS,
  TreeChartControls,
  type TreeChartDisplaySettings,
} from "@/shared/ui/tree-chart"

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
  return (
    <div
      className={cn(
        "inline-flex rounded-xl border p-1 shadow-inner",
        isDark ? "border-slate-800 bg-slate-900/80" : "border-slate-200/80 bg-slate-100/80",
      )}
      role="group"
      aria-label="Tree view mode"
    >
      <button
        type="button"
        onClick={() => onChange("list")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
          viewMode === "list"
            ? isDark
              ? "bg-slate-800 text-white shadow-sm ring-1 ring-slate-700"
              : "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
            : isDark
              ? "text-slate-400 hover:text-slate-200"
              : "text-slate-500 hover:text-slate-800",
        )}
      >
        <LayoutList className="h-3.5 w-3.5" />
        List
      </button>
      <button
        type="button"
        onClick={() => onChange("connections")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
          viewMode === "connections"
            ? isDark
              ? "bg-slate-800 text-white shadow-sm ring-1 ring-slate-700"
              : "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
            : isDark
              ? "text-slate-400 hover:text-slate-200"
              : "text-slate-500 hover:text-slate-800",
        )}
      >
        <Share2 className="h-3.5 w-3.5" />
        Connections
      </button>
    </div>
  )
}

function roleBadgeClass(role: string, isDark: boolean): string {
  const normalized = role.toLowerCase()
  if (normalized.includes("owner") || normalized.includes("admin")) {
    return isDark ? "bg-violet-500/20 text-violet-200" : "bg-violet-100 text-violet-700"
  }
  if (normalized.includes("manager")) {
    return isDark ? "bg-blue-500/20 text-blue-200" : "bg-blue-100 text-blue-700"
  }
  return isDark ? "bg-[#2e3447] text-[#bccbb9]" : "bg-slate-100 text-slate-600"
}

function TreeNodeCard({
  branch,
  isDark,
  currentMemberId,
}: {
  branch: MemberTreeBranch
  isDark: boolean
  currentMemberId?: string
}) {
  const [expanded, setExpanded] = useComponentState(true)
  const { node, children, depth } = branch
  const isSelf = node.id === currentMemberId
  const hasChildren = children.length > 0

  return (
    <li className="relative">
      {depth > 0 ? (
        <div
          className={cn(
            "absolute left-0 top-0 h-full w-px",
            isDark ? "bg-[#3d4a3d]/50" : "bg-slate-200",
          )}
          aria-hidden
        />
      ) : null}
      <div className={cn("relative", depth > 0 && "ml-6 pl-4")}>
        {depth > 0 ? (
          <div
            className={cn(
              "absolute left-0 top-7 h-px w-4",
              isDark ? "bg-[#3d4a3d]/50" : "bg-slate-200",
            )}
            aria-hidden
          />
        ) : null}
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
            isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-200 bg-white shadow-sm",
            isSelf && (isDark ? "ring-1 ring-[#4be277]/40" : "ring-1 ring-blue-400/50"),
          )}
        >
          <Avatar
            initials={initialsFromName(node.name)}
            color={memberAvatarColor(node.id, isSelf)}
            size="md"
            isDark={isDark}
            imageUrl={node.avatar_url}
            alt={node.name}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn("text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                {node.name}
                {isSelf ? (
                  <span className={cn("ml-2 text-xs font-medium", isDark ? "text-[#4be277]" : "text-blue-600")}>
                    (You)
                  </span>
                ) : null}
              </p>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", roleBadgeClass(node.role, isDark))}>
                {node.role}
              </span>
            </div>
            <p className={cn("mt-0.5 truncate text-xs", isDark ? "text-[#bccbb9]" : "text-slate-500")}>{node.email}</p>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className={cn(
                  "mt-2 inline-flex items-center gap-1 text-xs font-medium",
                  isDark ? "text-[#4be277] hover:text-[#6bf397]" : "text-blue-600 hover:text-blue-700",
                )}
              >
                <GitBranch className="h-3.5 w-3.5" />
                {expanded ? "Hide" : "Show"} {children.length} direct report{children.length === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>
        </div>

        {hasChildren && expanded ? (
          <ul className="mt-3 space-y-3">
            {children.map((child) => (
              <TreeNodeCard
                key={child.node.id}
                branch={child}
                isDark={isDark}
                currentMemberId={currentMemberId}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
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
  const t = isDark ? dark : light

  const [viewMode, setViewMode] = useComponentState<TreeViewMode>("list")
  const [error, setError] = useComponentState("")
  const [chartSettings, setChartSettings] = useComponentState<TreeChartDisplaySettings>(DEFAULT_TREE_CHART_SETTINGS)
  const [chartTransform, setChartTransform] = useComponentState(DEFAULT_TREE_CHART_TRANSFORM)

  const handleTreeError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : "Failed to load member tree")
  }, [])

  const organizationTree = useMemberTreeData("organization", handleTreeError)
  const teamTree = useMemberTreeData("team", handleTreeError)

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
  const orphanIds = treeGraph.orphan_member_ids ?? []

  useEffect(() => {
    if (nodes.length > 0) setError("")
  }, [viewScope, nodes.length])

  useEffect(() => {
    setChartTransform(DEFAULT_TREE_CHART_TRANSFORM)
  }, [viewScope, nodes.length, chartSettings.layout, chartSettings.orientation, chartSettings.linkType, chartSettings.stepPercent])

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
  }, [isRefreshing, refetch])

  const tree = useMemo(
    () =>
      buildMemberTreeBranches(
        nodes,
        edges,
        null,
        viewScope === "organization" ? validRootIds : null,
      ),
    [nodes, edges, viewScope, validRootIds],
  )
  const orphanNodes = useMemo(
    () => nodes.filter((n) => orphanIds.includes(n.id)),
    [nodes, orphanIds],
  )
  const memberCount = useMemo(() => countTreeMembers(tree), [tree])
  const treeDepth = useMemo(() => maxTreeDepth(tree), [tree])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
      <div className={cn("shrink-0 rounded-xl border p-5", t.tableBorder, t.tableBg)}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Network className={cn("h-5 w-5", isDark ? "text-[#4be277]" : "text-blue-600")} />
              <h2 className={cn("text-lg font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                Members tree
              </h2>
            </div>
            <p className={cn("mt-1 max-w-2xl text-sm leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
              {viewScope === "organization"
                ? "Organization-wide hierarchy showing who added whom across the workspace."
                : "Your branch from the org root through members you manage — upline roles are visible but not editable."}
            </p>
          </div>

          {canToggleScope ? (
            <div className={cn("inline-flex rounded-lg border p-0.5", isDark ? "border-[#3d4a3d]/40 bg-[#191f31]" : "border-slate-200 bg-slate-100")}>
              <button
                type="button"
                onClick={() => onScopeChange("organization")}
                className={cn(
                  "rounded-md px-3 py-2 text-xs font-semibold transition-all",
                  viewScope === "organization"
                    ? isDark
                      ? "bg-[#151b2d] text-[#dce1fb] shadow-sm"
                      : "bg-white text-slate-900 shadow-sm"
                    : isDark
                      ? "text-[#bccbb9] hover:text-[#dce1fb]"
                      : "text-slate-500 hover:text-slate-700",
                )}
              >
                Organization
              </button>
              <button
                type="button"
                onClick={() => onScopeChange("team")}
                className={cn(
                  "rounded-md px-3 py-2 text-xs font-semibold transition-all",
                  viewScope === "team"
                    ? isDark
                      ? "bg-[#151b2d] text-[#dce1fb] shadow-sm"
                      : "bg-white text-slate-900 shadow-sm"
                    : isDark
                      ? "text-[#bccbb9] hover:text-[#dce1fb]"
                      : "text-slate-500 hover:text-slate-700",
                )}
              >
                My team
              </button>
            </div>
          ) : isManagerScopedRole ? (
            <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", isDark ? "bg-[#2e3447] text-[#bccbb9]" : "bg-slate-100 text-slate-600")}>
              My team view
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {!isLoading && !error ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium", isDark ? "bg-[#191f31] text-[#bccbb9]" : "bg-slate-50 text-slate-600")}>
                <Users className="h-3.5 w-3.5" />
                {memberCount} member{memberCount === 1 ? "" : "s"}
              </div>
              <div className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium", isDark ? "bg-[#191f31] text-[#bccbb9]" : "bg-slate-50 text-slate-600")}>
                <GitBranch className="h-3.5 w-3.5" />
                {treeDepth} level{treeDepth === 1 ? "" : "s"} deep
              </div>
              {viewMode === "connections" ? (
                <TreeChartControls
                  settings={chartSettings}
                  onChange={updateChartSettings}
                  isDark={isDark}
                />
              ) : null}
            </div>
          ) : (
            <div className={cn("text-xs", isDark ? "text-[#8a9588]" : "text-slate-400")}>
              {isLoading && nodes.length === 0 ? "Loading hierarchy…" : "Unable to load stats"}
            </div>
          )}
          <div className="flex items-center gap-2">
            {viewMode === "connections" ? (
              <>
                <TableToolbarIconButton
                  onClick={() => setChartTransform((current) => zoomTreeChartOut(current))}
                  isDark={isDark}
                  title="Zoom out"
                >
                  <Minus className="h-4 w-4" />
                </TableToolbarIconButton>
                <TableToolbarIconButton
                  onClick={() => setChartTransform((current) => zoomTreeChartIn(current))}
                  isDark={isDark}
                  title="Zoom in"
                >
                  <Plus className="h-4 w-4" />
                </TableToolbarIconButton>
                <TableToolbarIconButton
                  onClick={() => setChartTransform(DEFAULT_TREE_CHART_TRANSFORM)}
                  isDark={isDark}
                  title="Reset view"
                >
                  <Maximize2 className="h-4 w-4" />
                </TableToolbarIconButton>
              </>
            ) : null}
            <TableRefreshButton
              onClick={() => void handleRefresh()}
              isRefreshing={isRefreshing || (isLoading && nodes.length > 0)}
              isDark={isDark}
            />
            <TreeViewModeToggle viewMode={viewMode} onChange={setViewMode} isDark={isDark} />
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mt-4 flex min-h-0 flex-1 flex-col",
          viewMode === "connections" ? "overflow-hidden" : "overflow-y-auto scrollbar-hide",
        )}
      >
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
          <div
            className={cn(
              "rounded-xl border",
              viewMode === "connections" ? "flex h-full min-h-0 flex-col overflow-hidden" : "p-5",
              t.tableBorder,
              t.tableBg,
            )}
          >
            {viewMode === "connections" ? (
              <MemberTreeConnectionsView
                nodes={nodes}
                edges={edges}
                rootMemberId={null}
                currentMemberId={memberId}
                isDark={isDark}
                validRootMemberIds={viewScope === "organization" ? validRootIds : null}
                settings={chartSettings}
                transform={chartTransform}
                onTransformChange={setChartTransform}
              />
            ) : tree.length ? (
              <div className="space-y-6">
                <ul className="space-y-3">
                  {tree.map((root) => (
                    <TreeNodeCard key={root.node.id} branch={root} isDark={isDark} currentMemberId={memberId} />
                  ))}
                </ul>
                {orphanNodes.length > 0 ? (
                  <div className={cn("rounded-lg border p-4", isDark ? "border-amber-500/30 bg-amber-500/10" : "border-amber-200 bg-amber-50")}>
                    <div className={cn("mb-3 flex items-center gap-2 text-sm font-semibold", isDark ? "text-amber-200" : "text-amber-900")}>
                      <ShieldAlert className="h-4 w-4" />
                      Hierarchy assignment required ({orphanNodes.length})
                    </div>
                    <p className={cn("mb-3 text-xs", isDark ? "text-amber-100/80" : "text-amber-800")}>
                      These members have organizational roles but no valid parent. Refresh the page to auto-assign under the Owner, or use Admin repair tools.
                    </p>
                    <ul className="space-y-2">
                      {orphanNodes.map((node) => (
                        <li
                          key={node.id}
                          className={cn(
                            "flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
                            isDark ? "border-amber-500/20 bg-[#151b2d]" : "border-amber-100 bg-white",
                          )}
                        >
                          <span className={isDark ? "text-[#dce1fb]" : "text-slate-900"}>{node.name}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", roleBadgeClass(node.role, isDark))}>
                            {node.role}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="p-5">
                <MemberTreeConnectionsView
                  nodes={nodes}
                  edges={edges}
                  rootMemberId={null}
                  currentMemberId={memberId}
                  isDark={isDark}
                  validRootMemberIds={viewScope === "organization" ? validRootIds : null}
                  settings={chartSettings}
                  transform={chartTransform}
                  onTransformChange={setChartTransform}
                />
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
