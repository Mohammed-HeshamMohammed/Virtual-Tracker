"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowRightLeft, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Minus, Network, Plus, Search, UserPlus, X } from "lucide-react"
import type { MemberTreeEdge, MemberTreeNode, MemberTreeScope } from "@/features/members/services/member-tree"
import { initialsOf } from "./export-svg"
import { flattenForList, isFiltering } from "./list-rows"
import { allParents, buildTreeModel, collapsedBeyond, descendantsOf, edgesAfterMove, maxDepth, type TreeEdgeInfo } from "./model"
import { ConfirmMove, IconButton, Legend, ManagerPicker, ToastBar } from "./panels"
import { roleColor, roleKey, roleRank } from "./roles"
import { chartTheme } from "./theme"
import { useReassignFlow } from "./use-reassign"
import { useToast } from "./use-toast"

export type MemberTreeListViewProps = {
  nodes: MemberTreeNode[]
  edges: MemberTreeEdge[]
  validRootMemberIds?: string[] | null
  scope: MemberTreeScope
  viewerId?: string
  isDark: boolean
  canReassign: boolean
  onAddHere?: (node: MemberTreeNode) => void
  onReassign?: (memberId: string, newParentId: string) => Promise<void>
  /** Opens the Connections view on this member. */
  onShowInChart?: (memberId: string) => void
}

const INDENT = 26

function memberColour(id: string, isSelf: boolean): string {
  if (isSelf) return "#2563eb"
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  const palette = ["#6366f1", "#0891b2", "#059669", "#d97706", "#db2777", "#64748b"]
  return palette[Math.abs(hash) % palette.length]
}

export function MemberTreeListView(props: MemberTreeListViewProps) {
  const { nodes, edges, validRootMemberIds, viewerId, isDark } = props
  const theme = useMemo(() => chartTheme(isDark), [isDark])

  const [moves, setMoves] = useState<Map<string, string>>(() => new Map())
  useEffect(() => setMoves(new Map()), [edges])
  const effectiveEdges = useMemo(() => {
    let current: TreeEdgeInfo[] = edges
    for (const [id, parentId] of moves) current = edgesAfterMove(current, id, parentId)
    return current
  }, [edges, moves])
  const model = useMemo(() => buildTreeModel({ nodes, edges: effectiveEdges, validRootIds: validRootMemberIds }), [nodes, effectiveEdges, validRootMemberIds])

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState("")
  const [role, setRole] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pickingFor, setPickingFor] = useState<string | null>(null)

  const filter = useMemo(() => ({ query, role }), [query, role])
  const filtering = isFiltering(filter)
  const rows = useMemo(() => flattenForList(model, collapsed, filter), [model, collapsed, filter])
  const depth = maxDepth(model)
  const reassignAllowed = props.canReassign && Boolean(props.onReassign)

  const roles = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of model.nodeById.values()) counts.set(node.role, (counts.get(node.role) ?? 0) + 1)
    return [...counts].map(([r, count]) => ({ role: r, count })).sort((a, b) => roleRank(b.role) - roleRank(a.role))
  }, [model])

  const branchSizes = useMemo(() => {
    const sizes = new Map<string, number>()
    const walk = (id: string): number => {
      let total = 0
      for (const child of model.childrenOf.get(id) ?? []) total += 1 + walk(child)
      sizes.set(id, total)
      return total
    }
    model.roots.forEach(walk)
    return sizes
  }, [model])

  const { toast, show: showToast } = useToast()
  const reassign = useReassignFlow({
    model,
    onReassign: props.onReassign,
    notify: showToast,
    onMoved: (memberId, newParentId) => {
      setMoves((prev) => new Map(prev).set(memberId, newParentId))
      setSelectedId(memberId)
    },
  })

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const [levels, setLevels] = useState<number | null>(null)
  const showLevels = (n: number) => {
    const clamped = Math.max(1, Math.min(depth, n))
    setLevels(clamped >= depth ? null : clamped)
    setCollapsed(clamped >= depth ? new Set() : collapsedBeyond(model, clamped))
  }
  const shownLevels = levels ?? depth

  const selected = selectedId ? model.nodeById.get(selectedId) : null
  const traced = useMemo(() => {
    if (!selectedId || !model.nodeById.has(selectedId)) return null
    const set = new Set<string>()
    let cursor: string | null | undefined = model.parentOf.get(selectedId)
    while (cursor) {
      set.add(cursor)
      cursor = model.parentOf.get(cursor)
    }
    descendantsOf(model, selectedId).forEach((id) => set.add(id))
    return set
  }, [model, selectedId])

  if (model.nodeById.size === 0) {
    return (
      <div className="grid min-h-[240px] place-items-center text-sm" style={{ color: theme.muted }}>
        No members found for this view.
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col" style={{ background: theme.canvas }}>
      {/* find / filter / fold */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 p-3" style={{ borderBottom: `1px solid ${theme.panelBorder}` }}>
        <div className="flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-lg border px-2.5 sm:max-w-sm" style={{ borderColor: theme.panelBorder, color: theme.muted, background: theme.card }}>
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a member by name, email or role…"
            className="w-full bg-transparent text-xs outline-none"
            style={{ color: theme.text }}
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <Legend theme={theme} roles={roles} active={role} onToggle={setRole} plain />
        <div className="ml-auto flex items-center gap-1">
          <IconButton theme={theme} title="Hide every team" disabled={filtering} onClick={() => { setLevels(null); setCollapsed(allParents(model)) }}>
            <ChevronsDownUp className="h-4 w-4" />
          </IconButton>
          <IconButton theme={theme} title="Show every team" disabled={filtering} onClick={() => { setLevels(null); setCollapsed(new Set()) }}>
            <ChevronsUpDown className="h-4 w-4" />
          </IconButton>
          <IconButton theme={theme} title="Show one level fewer" disabled={filtering || shownLevels <= 1} onClick={() => showLevels(shownLevels - 1)}>
            <Minus className="h-3.5 w-3.5" />
          </IconButton>
          <span className="w-16 text-center text-[11px] font-semibold tabular-nums" style={{ color: theme.muted }}>
            {shownLevels}/{depth} levels
          </span>
          <IconButton theme={theme} title="Show one level more" disabled={filtering || shownLevels >= depth} onClick={() => showLevels(shownLevels + 1)}>
            <Plus className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {filtering ? (
        <p className="shrink-0 px-4 pt-2 text-[11px]" style={{ color: theme.muted }}>
          {rows.filter((r) => r.match).length === 0
            ? "No one matches. "
            : `${rows.filter((r) => r.match).length} match${rows.filter((r) => r.match).length === 1 ? "" : "es"}, shown with the managers above them. `}
          <button type="button" className="font-semibold underline" style={{ color: theme.accent }} onClick={() => { setQuery(""); setRole(null) }}>
            Clear filters
          </button>
        </p>
      ) : null}

      {/* the people */}
      <div className="page-custom-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const node = model.nodeById.get(row.id)!
            const isSelf = row.id === viewerId
            const isSelected = row.id === selectedId
            const dim = filtering ? !row.match : traced ? !traced.has(row.id) && !isSelected : false
            const manager = model.parentOf.get(row.id)
            const reports = model.childrenOf.get(row.id)?.length ?? 0
            const colour = roleColor(node.role)
            const photo = node.avatar_url && /^(https?:|data:image)/.test(node.avatar_url.trim())
            return (
              <li key={row.id} style={{ paddingLeft: row.depth * INDENT }} className="relative">
                {row.depth > 0 ? <span className="absolute bottom-0 top-0 w-px" style={{ left: row.depth * INDENT - 12, background: theme.border }} aria-hidden /> : null}
                <div
                  className="group flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors"
                  onClick={() => setSelectedId(isSelected ? null : row.id)}
                  style={{
                    background: isSelected ? theme.accentSoft : theme.card,
                    borderColor: isSelected ? theme.accent : theme.border,
                    opacity: dim ? 0.4 : 1,
                    cursor: "pointer",
                  }}
                >
                  {row.hasTeam && !filtering ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setLevels(null)
                        toggle(row.id)
                      }}
                      aria-label={row.open ? "Hide team" : "Show team"}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md"
                      style={{ color: theme.muted, background: row.open ? "transparent" : theme.accentSoft }}
                    >
                      {row.open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  ) : (
                    <span className="h-6 w-6 shrink-0" />
                  )}
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={node.avatar_url} alt="" draggable={false} className="h-9 w-9 shrink-0 rounded-full object-cover" style={{ boxShadow: `0 0 0 2px ${colour}` }} />
                  ) : (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: memberColour(row.id, isSelf), boxShadow: `0 0 0 2px ${colour}` }}>
                      {initialsOf(node.name)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold" style={{ color: theme.text }}>
                        {node.name || "Member"}
                      </span>
                      {isSelf ? (
                        <span className="rounded px-1 text-[9px] font-bold uppercase" style={{ background: theme.accentSoft, color: theme.accent }}>
                          You
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: `${colour}22`, color: colour }}>
                        {node.role}
                      </span>
                      {node.hierarchy_status === "hierarchy_assignment_required" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: theme.warn }}>
                          <AlertTriangle className="h-3 w-3" /> needs a manager
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 truncate text-xs" style={{ color: theme.muted }}>
                      {node.email || "Email hidden"}
                      {manager ? <> · reports to <strong style={{ color: theme.text }}>{model.nodeById.get(manager)?.name}</strong></> : null}
                    </p>
                  </div>
                  {reports > 0 ? (
                    <span className="hidden shrink-0 text-right text-[11px] leading-tight sm:block" style={{ color: theme.muted }}>
                      <strong className="block text-sm tabular-nums" style={{ color: theme.text }}>{reports}</strong>
                      direct{(branchSizes.get(row.id) ?? 0) > reports ? ` · ${branchSizes.get(row.id)} total` : ""}
                    </span>
                  ) : null}
                  <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                    {props.onShowInChart ? (
                      <RowAction theme={theme} title="Show in the chart" onClick={() => props.onShowInChart?.(row.id)}>
                        <Network className="h-4 w-4" />
                      </RowAction>
                    ) : null}
                    {props.onAddHere && roleKey(node.role) !== "client" ? (
                      <RowAction theme={theme} title={`Add a member under ${node.name}`} onClick={() => props.onAddHere?.(node)}>
                        <UserPlus className="h-4 w-4" />
                      </RowAction>
                    ) : null}
                    {reassignAllowed && !isSelfOwner(node.role) && roleKey(node.role) !== "client" ? (
                      <RowAction theme={theme} title="Change manager" onClick={() => setPickingFor(row.id)}>
                        <ArrowRightLeft className="h-4 w-4" />
                      </RowAction>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>

        {model.orphans.length > 0 && !filtering ? (
          <div className="mt-5 rounded-xl border p-4" style={{ borderColor: theme.warn, background: theme.canvas }}>
            <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: theme.warn }}>
              <AlertTriangle className="h-4 w-4" />
              Needs a manager ({model.orphans.length})
            </p>
            <p className="mt-1 text-xs" style={{ color: theme.muted }}>
              These members have a role that reports to someone, but no manager.{reassignAllowed ? " Choose one for each." : ""}
            </p>
            <ul className="mt-3 space-y-1.5">
              {model.orphans.map((id) => {
                const n = model.nodeById.get(id)!
                return (
                  <li key={id} className="flex items-center gap-3 rounded-lg border px-3 py-2" style={{ borderColor: theme.panelBorder, background: theme.card }}>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: theme.text }}>
                      {n.name}
                    </span>
                    <span className="text-[10px] font-bold uppercase" style={{ color: roleColor(n.role) }}>
                      {n.role}
                    </span>
                    {reassignAllowed ? (
                      <button type="button" onClick={() => setPickingFor(id)} className="h-7 rounded-lg px-2.5 text-xs font-semibold text-white" style={{ background: theme.accent }}>
                        Choose manager
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
        {selected ? <span className="sr-only">Selected {selected.name}</span> : null}
      </div>

      {pickingFor ? (
        <ManagerPicker
          theme={theme}
          model={model}
          memberId={pickingFor}
          onClose={() => setPickingFor(null)}
          onPick={(parentId) => {
            const memberId = pickingFor
            setPickingFor(null)
            reassign.request(memberId, parentId)
          }}
        />
      ) : null}
      {reassign.pending ? (
        <ConfirmMove
          theme={theme}
          model={model}
          memberId={reassign.pending.memberId}
          newParentId={reassign.pending.newParentId}
          busy={reassign.busy}
          error={reassign.error}
          onCancel={reassign.cancel}
          onConfirm={() => void reassign.confirm()}
        />
      ) : null}
      <ToastBar theme={theme} toast={toast} />
    </div>
  )
}

function isSelfOwner(role: string): boolean {
  return roleKey(role) === "owner"
}

function RowAction({ theme, title, onClick, children }: { theme: ReturnType<typeof chartTheme>; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:opacity-100"
      style={{ color: theme.muted }}
    >
      {children}
    </button>
  )
}

