"use client"

import { memo } from "react"
import { AlertTriangle, ChevronDown, ChevronRight, Plus } from "lucide-react"
import { initialsOf } from "./export-svg"
import type { TreeNodeInfo } from "./model"
import { roleColor } from "./roles"
import type { ChartTheme } from "./theme"

export type DropState = "ok" | "bad" | null

function isPhoto(url?: string): boolean {
  if (!url) return false
  const v = url.trim()
  return v.startsWith("http://") || v.startsWith("https://") || v.startsWith("data:image")
}

export type NodeCardProps = {
  node: TreeNodeInfo
  x: number
  y: number
  width: number
  height: number
  theme: ChartTheme
  avatarColor: string
  isSelf: boolean
  selected: boolean
  dimmed: boolean
  /** Part of the path or branch being traced. */
  traced: boolean
  collapsed: boolean
  /** Direct reports, and everyone below them. */
  directReports: number
  branchSize: number
  /** Few pixels on screen: draw just a coloured tile. */
  compact: boolean
  drop: DropState
  dragging: boolean
  needsManager: boolean
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, id: string) => void
  onDoubleClick: (id: string) => void
  onToggle: (id: string) => void
  onAdd?: (id: string) => void
  onHover: (id: string | null) => void
}

function NodeCardImpl(props: NodeCardProps) {
  const { node, theme, selected, dimmed, traced, collapsed, directReports, branchSize, compact, drop, dragging, needsManager } = props
  const colour = roleColor(node.role)
  const photo = isPhoto(node.avatar_url)
  const ring = drop === "ok" ? theme.accent : drop === "bad" ? theme.danger : selected ? theme.accent : traced ? theme.linkActive : theme.border
  const hasTeam = directReports > 0

  return (
    <div
      data-node-id={node.id}
      onPointerDown={(event) => props.onPointerDown(event, node.id)}
      onDoubleClick={(event) => {
        event.stopPropagation()
        props.onDoubleClick(node.id)
      }}
      onPointerEnter={() => props.onHover(node.id)}
      onPointerLeave={() => props.onHover(null)}
      className="group absolute select-none"
      style={{
        left: props.x - props.width / 2,
        top: props.y - props.height / 2,
        width: props.width,
        height: props.height,
        opacity: dimmed ? 0.3 : dragging ? 0.55 : 1,
        transition: "opacity 140ms ease",
        zIndex: dragging ? 30 : selected ? 20 : drop ? 25 : 10,
        cursor: dragging ? "grabbing" : "grab",
        touchAction: "none",
      }}
    >
      {compact ? (
        <div
          className="h-full w-full rounded-xl"
          style={{ background: colour, boxShadow: selected || drop ? `0 0 0 4px ${ring}` : undefined, opacity: 0.9 }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center gap-2.5 overflow-hidden rounded-xl border pl-3 pr-2"
          style={{
            background: theme.card,
            borderColor: ring,
            boxShadow: selected || drop ? `0 0 0 3px ${drop === "bad" ? theme.dangerSoft : theme.accentSoft}, ${theme.shadow}` : "0 1px 2px rgba(0,0,0,0.18)",
          }}
        >
          <span className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r" style={{ background: colour }} />
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={node.avatar_url} alt="" draggable={false} className="h-9 w-9 shrink-0 rounded-full object-cover" />
          ) : (
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
              style={{ background: props.avatarColor }}
            >
              {initialsOf(node.name)}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold leading-tight" style={{ color: theme.text }}>
                {node.name || "Member"}
              </span>
              {props.isSelf ? (
                <span className="shrink-0 rounded px-1 text-[9px] font-bold uppercase" style={{ background: theme.accentSoft, color: theme.accent }}>
                  You
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight" style={{ color: theme.muted }}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colour }} />
              <span className="truncate">{node.role}</span>
            </span>
          </span>
          {needsManager ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: theme.warn }} aria-label="Needs a manager" /> : null}
          {hasTeam ? (
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                props.onToggle(node.id)
              }}
              title={collapsed ? `Show ${branchSize} below` : "Hide this team"}
              className="flex h-6 shrink-0 items-center gap-0.5 rounded-md border px-1 text-[10px] font-semibold tabular-nums"
              style={{ borderColor: theme.border, color: theme.muted, background: collapsed ? theme.accentSoft : "transparent" }}
            >
              {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {collapsed ? branchSize : directReports}
            </button>
          ) : null}
        </div>
      )}

      {props.onAdd && !compact ? (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            props.onAdd?.(node.id)
          }}
          title={`Add a member under ${node.name}`}
          className="absolute -bottom-2.5 left-1/2 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: theme.accent, color: "#fff", boxShadow: theme.shadow }}
        >
          <Plus className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  )
}

export const NodeCard = memo(NodeCardImpl)
