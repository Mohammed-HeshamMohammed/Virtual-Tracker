"use client"

import { useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowRightLeft, Check, Focus, GitBranch, Loader2, Mail, Search, UserPlus, X } from "lucide-react"
import { initialsOf } from "./export-svg"
import type { Point } from "./layout"
import { descendantsOf, pathToRoot, type TreeModel, type TreeNodeInfo } from "./model"
import { roleColor } from "./roles"
import { canReassign, validManagersFor } from "./rules"
import { searchMembers } from "./search"
import type { ChartTheme } from "./theme"

/* ---------- small building blocks ---------- */

export function IconButton({
  theme,
  title,
  onClick,
  active,
  disabled,
  children,
}: {
  theme: ChartTheme
  title: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      className="grid h-8 w-8 place-items-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        borderColor: active ? theme.accent : theme.panelBorder,
        background: active ? theme.accentSoft : "transparent",
        color: active ? theme.accent : theme.muted,
      }}
    >
      {children}
    </button>
  )
}

export function Surface({ theme, className, style, children }: { theme: ChartTheme; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div
      className={className}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      style={{ background: theme.panel, border: `1px solid ${theme.panelBorder}`, borderRadius: 14, boxShadow: theme.shadow, backdropFilter: "blur(8px)", ...style }}
    >
      {children}
    </div>
  )
}

function Avatar({ node, colour, size = 36 }: { node: TreeNodeInfo; colour: string; size?: number }) {
  const photo = node.avatar_url && /^(https?:|data:image)/.test(node.avatar_url.trim())
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={node.avatar_url} alt="" draggable={false} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ width: size, height: size, background: colour }}>
      {initialsOf(node.name)}
    </span>
  )
}

/* ---------- search ---------- */

export function SearchBox({
  theme,
  model,
  onPick,
  inputRef,
}: {
  theme: ChartTheme
  model: TreeModel
  onPick: (id: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const hits = useMemo(() => searchMembers(model.nodeById.values(), query), [model, query])
  const [cursor, setCursor] = useState(0)

  const pick = (id: string) => {
    onPick(id)
    setOpen(false)
    setQuery("")
  }

  return (
    <div className="relative" onPointerDown={(event) => event.stopPropagation()}>
      <div className="flex h-8 items-center gap-2 rounded-lg border px-2.5" style={{ borderColor: theme.panelBorder, color: theme.muted }}>
        <Search className="h-3.5 w-3.5 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setCursor(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setCursor((c) => Math.min(hits.length - 1, c + 1))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setCursor((c) => Math.max(0, c - 1))
            } else if (event.key === "Enter" && hits[cursor]) {
              pick(hits[cursor].id)
            } else if (event.key === "Escape") {
              setQuery("")
              setOpen(false)
              ;(event.target as HTMLInputElement).blur()
            }
          }}
          placeholder="Find a member…  ( / )"
          className="w-44 bg-transparent text-xs outline-none placeholder:opacity-70"
          style={{ color: theme.text }}
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {open && query.trim() ? (
        <Surface theme={theme} className="absolute left-0 top-10 z-50 w-72 overflow-hidden p-1">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-xs" style={{ color: theme.muted }}>
              No one matches “{query.trim()}”.
            </p>
          ) : (
            hits.map((hit, index) => {
              const node = model.nodeById.get(hit.id)!
              return (
                <button
                  key={hit.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(hit.id)}
                  onMouseEnter={() => setCursor(index)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left"
                  style={{ background: index === cursor ? theme.accentSoft : "transparent" }}
                >
                  <Avatar node={node} colour={roleColor(node.role)} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold" style={{ color: theme.text }}>
                      {node.name}
                    </span>
                    <span className="block truncate text-[10px]" style={{ color: theme.muted }}>
                      {node.role} · {node.email || "no email shown"}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </Surface>
      ) : null}
    </div>
  )
}

/* ---------- details ---------- */

export function DetailsPanel({
  theme,
  model,
  memberId,
  isSelf,
  collapsed,
  reassignAllowed,
  onClose,
  onSelect,
  onFocusBranch,
  onToggleCollapse,
  onAdd,
  onChooseManager,
}: {
  theme: ChartTheme
  model: TreeModel
  memberId: string
  isSelf: boolean
  collapsed: boolean
  reassignAllowed: boolean
  onClose: () => void
  onSelect: (id: string) => void
  onFocusBranch: (id: string) => void
  onToggleCollapse: (id: string) => void
  onAdd?: (id: string) => void
  onChooseManager: (memberId: string, newParentId: string) => void
}) {
  const node = model.nodeById.get(memberId)
  const [picking, setPicking] = useState(false)
  const [filter, setFilter] = useState("")
  if (!node) return null

  const reports = model.childrenOf.get(memberId) ?? []
  const branch = descendantsOf(model, memberId).length
  const chain = pathToRoot(model, memberId).slice(1)
  const options = picking ? validManagersFor(model, memberId) : []
  const shown = options.filter((id) => {
    const q = filter.trim().toLowerCase()
    if (!q) return true
    const n = model.nodeById.get(id)!
    return n.name.toLowerCase().includes(q) || n.role.toLowerCase().includes(q)
  })
  const colour = roleColor(node.role)
  const manager = model.parentOf.get(memberId)

  return (
    <Surface theme={theme} className="flex max-h-full w-[300px] flex-col overflow-hidden">
      <div className="flex items-start gap-3 p-4" style={{ borderBottom: `1px solid ${theme.panelBorder}` }}>
        <Avatar node={node} colour={colour} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" style={{ color: theme.text }}>
            {node.name} {isSelf ? <span style={{ color: theme.accent }}>(You)</span> : null}
          </p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs" style={{ color: theme.muted }}>
            <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
            {node.role}
          </p>
          {node.email ? (
            <p className="mt-1 flex items-center gap-1 truncate text-[11px]" style={{ color: theme.muted }}>
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{node.email}</span>
            </p>
          ) : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" style={{ color: theme.muted }}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat theme={theme} label="Direct reports" value={reports.length} />
          <Stat theme={theme} label="In their branch" value={branch} />
        </div>

        {chain.length > 0 ? (
          <div>
            <SectionTitle theme={theme}>Reports up to</SectionTitle>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {chain.map((id, index) => {
                const n = model.nodeById.get(id)!
                return (
                  <span key={id} className="inline-flex items-center gap-1">
                    {index > 0 ? <span style={{ color: theme.muted }}>›</span> : null}
                    <button
                      type="button"
                      onClick={() => onSelect(id)}
                      className="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                      style={{ background: theme.accentSoft, color: theme.text }}
                    >
                      {n.name}
                    </button>
                  </span>
                )
              })}
            </div>
          </div>
        ) : null}

        {reports.length > 0 ? (
          <div>
            <SectionTitle theme={theme}>Direct reports</SectionTitle>
            <div className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
              {reports.map((id) => {
                const n = model.nodeById.get(id)!
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelect(id)}
                    className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left"
                    style={{ color: theme.text }}
                  >
                    <Avatar node={n} colour={roleColor(n.role)} size={22} />
                    <span className="min-w-0 flex-1 truncate text-xs">{n.name}</span>
                    <span className="text-[10px]" style={{ color: theme.muted }}>
                      {n.role}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {picking ? (
          <div>
            <SectionTitle theme={theme}>Move under…</SectionTitle>
            <input
              autoFocus
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search managers"
              className="mt-1.5 h-8 w-full rounded-lg border bg-transparent px-2.5 text-xs outline-none"
              style={{ borderColor: theme.panelBorder, color: theme.text }}
            />
            <div className="mt-1.5 max-h-44 space-y-0.5 overflow-y-auto">
              {shown.length === 0 ? (
                <p className="px-1 py-2 text-xs" style={{ color: theme.muted }}>
                  No one can manage this member.
                </p>
              ) : (
                shown.slice(0, 60).map((id) => {
                  const n = model.nodeById.get(id)!
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setPicking(false)
                        onChooseManager(memberId, id)
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:opacity-80"
                      style={{ color: theme.text }}
                    >
                      <Avatar node={n} colour={roleColor(n.role)} size={22} />
                      <span className="min-w-0 flex-1 truncate text-xs">{n.name}</span>
                      <span className="text-[10px]" style={{ color: theme.muted }}>
                        {n.role}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 p-3" style={{ borderTop: `1px solid ${theme.panelBorder}` }}>
        <ActionButton theme={theme} onClick={() => onFocusBranch(memberId)} disabled={reports.length === 0} icon={<Focus className="h-3.5 w-3.5" />}>
          Focus branch
        </ActionButton>
        <ActionButton theme={theme} onClick={() => onToggleCollapse(memberId)} disabled={reports.length === 0} icon={<GitBranch className="h-3.5 w-3.5" />}>
          {collapsed ? "Show team" : "Hide team"}
        </ActionButton>
        {onAdd ? (
          <ActionButton theme={theme} onClick={() => onAdd(memberId)} icon={<UserPlus className="h-3.5 w-3.5" />}>
            Add under
          </ActionButton>
        ) : null}
        {reassignAllowed && manager !== undefined ? (
          <ActionButton theme={theme} active={picking} onClick={() => setPicking((v) => !v)} icon={<ArrowRightLeft className="h-3.5 w-3.5" />}>
            Change manager
          </ActionButton>
        ) : null}
      </div>
    </Surface>
  )
}

function SectionTitle({ theme, children }: { theme: ChartTheme; children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.muted }}>
      {children}
    </p>
  )
}

function Stat({ theme, label, value }: { theme: ChartTheme; label: string; value: number }) {
  return (
    <div className="rounded-xl border px-3 py-2" style={{ borderColor: theme.panelBorder }}>
      <p className="text-lg font-semibold tabular-nums leading-tight" style={{ color: theme.text }}>
        {value}
      </p>
      <p className="text-[10px]" style={{ color: theme.muted }}>
        {label}
      </p>
    </div>
  )
}

function ActionButton({ theme, onClick, disabled, active, icon, children }: { theme: ChartTheme; onClick: () => void; disabled?: boolean; active?: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{ borderColor: active ? theme.accent : theme.panelBorder, color: active ? theme.accent : theme.text, background: active ? theme.accentSoft : "transparent" }}
    >
      {icon}
      {children}
    </button>
  )
}

/* ---------- minimap ---------- */

const MINIMAP_W = 190
const MINIMAP_H = 120

export function Minimap({
  theme,
  model,
  positions,
  bounds,
  viewport,
  transform,
  selectedId,
  nodeSize,
  onCenterOn,
}: {
  theme: ChartTheme
  model: TreeModel
  positions: ReadonlyMap<string, Point>
  bounds: { minX: number; minY: number; width: number; height: number }
  viewport: { width: number; height: number }
  transform: { x: number; y: number; scale: number }
  selectedId: string | null
  nodeSize: { width: number; height: number }
  onCenterOn: (canvasPoint: Point) => void
}) {
  const ref = useRef<SVGSVGElement>(null)
  const scale = Math.min(MINIMAP_W / Math.max(bounds.width, 1), MINIMAP_H / Math.max(bounds.height, 1))
  const offsetX = (MINIMAP_W - bounds.width * scale) / 2
  const offsetY = (MINIMAP_H - bounds.height * scale) / 2
  const view = {
    x: offsetX + (-transform.x / transform.scale - bounds.minX) * scale,
    y: offsetY + (-transform.y / transform.scale - bounds.minY) * scale,
    w: (viewport.width / transform.scale) * scale,
    h: (viewport.height / transform.scale) * scale,
  }

  const jump = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    onCenterOn({ x: (event.clientX - rect.left - offsetX) / scale + bounds.minX, y: (event.clientY - rect.top - offsetY) / scale + bounds.minY })
  }

  return (
    <Surface theme={theme} className="overflow-hidden p-0">
      <svg
        ref={ref}
        width={MINIMAP_W}
        height={MINIMAP_H}
        className="block cursor-pointer"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          jump(event)
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) jump(event)
        }}
      >
        {[...positions].map(([id, p]) => (
          <rect
            key={id}
            x={offsetX + (p.x - nodeSize.width / 2 - bounds.minX) * scale}
            y={offsetY + (p.y - nodeSize.height / 2 - bounds.minY) * scale}
            width={Math.max(2, nodeSize.width * scale)}
            height={Math.max(2, nodeSize.height * scale)}
            rx={1}
            fill={roleColor(model.nodeById.get(id)?.role)}
            opacity={id === selectedId ? 1 : 0.65}
          />
        ))}
        <rect x={view.x} y={view.y} width={view.w} height={view.h} fill={theme.accentSoft} stroke={theme.accent} strokeWidth={1.5} rx={2} />
      </svg>
    </Surface>
  )
}

/* ---------- legend ---------- */

export function Legend({
  theme,
  roles,
  active,
  onToggle,
  plain,
}: {
  theme: ChartTheme
  roles: { role: string; count: number }[]
  active: string | null
  onToggle: (role: string | null) => void
  /** Without the floating panel around it, for use in a toolbar. */
  plain?: boolean
}) {
  if (roles.length === 0) return null
  const Wrapper = plain
    ? ({ children }: { children: React.ReactNode }) => <>{children}</>
    : ({ children }: { children: React.ReactNode }) => (
        <Surface theme={theme} className="max-w-[220px] p-2">
          {children}
        </Surface>
      )
  return (
    <Wrapper>
      <div className="flex flex-wrap gap-1">
        {roles.map(({ role, count }) => {
          const on = active === role
          return (
            <button
              key={role}
              type="button"
              onClick={() => onToggle(on ? null : role)}
              title={on ? "Show everyone" : `Highlight ${role}`}
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
              style={{ borderColor: on ? roleColor(role) : theme.panelBorder, background: on ? theme.accentSoft : "transparent", color: theme.text }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: roleColor(role) }} />
              {role}
              <span style={{ color: theme.muted }}>{count}</span>
            </button>
          )
        })}
      </div>
    </Wrapper>
  )
}

/* ---------- members who need a manager ---------- */

export function OrphanTray({
  theme,
  model,
  reassignAllowed,
  onSelect,
  onStartDrag,
}: {
  theme: ChartTheme
  model: TreeModel
  reassignAllowed: boolean
  onSelect: (id: string) => void
  onStartDrag: (event: React.PointerEvent<HTMLElement>, id: string) => void
}) {
  if (model.orphans.length === 0) return null
  return (
    <Surface theme={theme} className="max-w-[260px] p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: theme.warn }}>
        <AlertTriangle className="h-3.5 w-3.5" />
        Needs a manager ({model.orphans.length})
      </p>
      <p className="mt-1 text-[10px] leading-snug" style={{ color: theme.muted }}>
        {reassignAllowed ? "Drag one onto a manager to place them, or select one and use Change manager." : "These members have no manager yet."}
      </p>
      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {model.orphans.map((id) => {
          const n = model.nodeById.get(id)!
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              onPointerDown={(event) => reassignAllowed && onStartDrag(event, id)}
              className="flex w-full items-center gap-2 rounded-lg border px-2 py-1 text-left"
              style={{ borderColor: theme.panelBorder, cursor: reassignAllowed ? "grab" : "pointer", touchAction: "none" }}
            >
              <Avatar node={n} colour={roleColor(n.role)} size={22} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: theme.text }}>
                {n.name}
              </span>
              <span className="text-[10px]" style={{ color: theme.muted }}>
                {n.role}
              </span>
            </button>
          )
        })}
      </div>
    </Surface>
  )
}

/* ---------- confirm a move ---------- */

export function ConfirmMove({
  theme,
  model,
  memberId,
  newParentId,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  theme: ChartTheme
  model: TreeModel
  memberId: string
  newParentId: string
  busy: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const member = model.nodeById.get(memberId)
  const parent = model.nodeById.get(newParentId)
  if (!member || !parent) return null
  const previous = model.parentOf.get(memberId)
  const previousName = previous ? model.nodeById.get(previous)?.name : null
  const team = descendantsOf(model, memberId).length
  const verdict = canReassign(model, memberId, newParentId)
  return (
    <div className="absolute inset-0 z-[70] grid place-items-center" style={{ background: "rgba(0,0,0,0.35)" }} onPointerDown={(event) => event.stopPropagation()}>
      <Surface theme={theme} className="w-[380px] p-5">
        <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: theme.text }}>
          <ArrowRightLeft className="h-4 w-4" style={{ color: theme.accent }} />
          Change manager
        </p>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: theme.text }}>
          Move <strong>{member.name}</strong>
          {team > 0 ? ` and their team of ${team}` : ""} {previousName ? `from ${previousName} ` : ""}to report to <strong>{parent.name}</strong>?
        </p>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: theme.muted }}>
          Who reports to whom decides who can see whom, so this changes what {member.name}
          {team > 0 ? " and their team" : ""} can access.
        </p>
        {!verdict.ok ? (
          <p className="mt-3 text-xs font-medium" style={{ color: theme.danger }}>
            {verdict.reason}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-lg px-3 py-2 text-xs font-medium" style={{ background: theme.dangerSoft, color: theme.danger }}>
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="h-8 rounded-lg border px-3 text-xs font-semibold" style={{ borderColor: theme.panelBorder, color: theme.text }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !verdict.ok}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: theme.accent }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Move
          </button>
        </div>
      </Surface>
    </div>
  )
}


/* ---------- a short message ---------- */

export function ToastBar({ theme, toast }: { theme: ChartTheme; toast: { text: string; tone: "ok" | "bad" } | null }) {
  if (!toast) return null
  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-16 left-1/2 z-[80] -translate-x-1/2 rounded-xl px-4 py-2 text-xs font-semibold"
      style={{ background: toast.tone === "ok" ? theme.accent : theme.danger, color: "#fff", boxShadow: theme.shadow }}
    >
      {toast.text}
    </div>
  )
}

/* ---------- choose a new manager (used by the List) ---------- */

export function ManagerPicker({
  theme,
  model,
  memberId,
  onPick,
  onClose,
}: {
  theme: ChartTheme
  model: TreeModel
  memberId: string
  onPick: (parentId: string) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState("")
  const member = model.nodeById.get(memberId)
  const options = useMemo(() => validManagersFor(model, memberId), [model, memberId])
  const shown = options.filter((id) => {
    const q = filter.trim().toLowerCase()
    if (!q) return true
    const n = model.nodeById.get(id)!
    return n.name.toLowerCase().includes(q) || n.role.toLowerCase().includes(q)
  })
  if (!member) return null
  return (
    <div className="absolute inset-0 z-[70] grid place-items-center" style={{ background: "rgba(0,0,0,0.35)" }} onPointerDown={onClose}>
      <Surface theme={theme} className="w-[400px] max-w-[92vw] p-5">
        <div onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold" style={{ color: theme.text }}>
              Who should <strong>{member.name}</strong> report to?
            </p>
            <button type="button" onClick={onClose} aria-label="Close" style={{ color: theme.muted }}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <input
            autoFocus
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && onClose()}
            placeholder="Search managers"
            className="mt-3 h-9 w-full rounded-lg border bg-transparent px-3 text-sm outline-none"
            style={{ borderColor: theme.panelBorder, color: theme.text }}
          />
          <div className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="px-1 py-3 text-xs" style={{ color: theme.muted }}>
                No one can manage this member.
              </p>
            ) : (
              shown.slice(0, 80).map((id) => {
                const n = model.nodeById.get(id)!
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onPick(id)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:opacity-80"
                    style={{ color: theme.text }}
                  >
                    <Avatar node={n} colour={roleColor(n.role)} size={28} />
                    <span className="min-w-0 flex-1 truncate text-sm">{n.name}</span>
                    <span className="text-[11px]" style={{ color: theme.muted }}>
                      {n.role}
                      {(model.childrenOf.get(id)?.length ?? 0) > 0 ? ` · ${model.childrenOf.get(id)!.length} reports` : ""}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </Surface>
    </div>
  )
}
