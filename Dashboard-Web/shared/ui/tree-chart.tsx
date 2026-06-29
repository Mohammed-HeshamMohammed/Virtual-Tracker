"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Group } from "@visx/group"
import { hierarchy, Tree } from "@visx/hierarchy"
import type { HierarchyPointLink, HierarchyPointNode } from "d3-hierarchy"
import { pointRadial } from "d3-shape"
import {
  LinkRadial,
  LinkVertical,
  LinkHorizontal,
  LinkHorizontalStep,
  LinkVerticalStep,
  LinkRadialStep,
  LinkHorizontalLine,
  LinkVerticalLine,
  LinkRadialLine,
  LinkHorizontalCurve,
  LinkVerticalCurve,
  LinkRadialCurve,
} from "@visx/shape"
import { cn } from "@/shared/utils/utils"
import { SimpleSelect } from "@/shared/ui/simple-select"

export type TreeChartLayout = "cartesian" | "polar"
export type TreeChartOrientation = "vertical" | "horizontal"
export type TreeChartLinkType = "diagonal" | "step" | "curve" | "line"

export type TreeChartDisplaySettings = {
  layout: TreeChartLayout
  orientation: TreeChartOrientation
  linkType: TreeChartLinkType
  stepPercent: number
}

export const DEFAULT_TREE_CHART_SETTINGS: TreeChartDisplaySettings = {
  layout: "cartesian",
  orientation: "vertical",
  linkType: "curve",
  stepPercent: 0.5,
}

export type TreeChartNode = {
  id: string
  name: string
  initials?: string
  avatarColor?: string
  imageUrl?: string
  isCollapsed?: boolean
  children?: TreeChartNode[]
}

type TreeChartTheme = {
  canvasBg: string
  nodeFill: string
  rootNodeFill: string
  nodeBorderColor: string
  highlightFill: string
  highlightStroke: string
  textColor: string
  linkColor: string
}

function getTreeChartTheme(isDark: boolean): TreeChartTheme {
  if (isDark) {
    return {
      canvasBg: "#151b2d",
      nodeFill: "#191f31",
      rootNodeFill: "#4be277",
      nodeBorderColor: "#3d4a3d",
      highlightFill: "#1d4ed8",
      highlightStroke: "#4be277",
      textColor: "#dce1fb",
      linkColor: "#6b8afd",
    }
  }

  return {
    canvasBg: "#ffffff",
    nodeFill: "#f8fafc",
    rootNodeFill: "#2563eb",
    nodeBorderColor: "#cbd5e1",
    highlightFill: "#dbeafe",
    highlightStroke: "#2563eb",
    textColor: "#0f172a",
    linkColor: "#64748b",
  }
}

const LAYOUT_OPTIONS: { label: string; value: TreeChartLayout }[] = [
  { label: "Cartesian", value: "cartesian" },
  { label: "Polar", value: "polar" },
]

const ORIENTATION_OPTIONS: { label: string; value: TreeChartOrientation }[] = [
  { label: "Vertical", value: "vertical" },
  { label: "Horizontal", value: "horizontal" },
]

const LINK_TYPE_OPTIONS: { label: string; value: TreeChartLinkType }[] = [
  { label: "Diagonal", value: "diagonal" },
  { label: "Step", value: "step" },
  { label: "Curve", value: "curve" },
  { label: "Line", value: "line" },
]

function labelForValue<T extends string>(
  options: { label: string; value: T }[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? options[0]?.label ?? value
}

function valueForLabel<T extends string>(
  options: { label: string; value: T }[],
  label: string,
): T {
  return (options.find((option) => option.label === label)?.value ?? options[0]?.value) as T
}

const getLinkComponent = ({
  layout,
  linkType,
  orientation,
}: {
  layout: string
  linkType: string
  orientation: string
}) => {
  if (layout === "polar") {
    if (linkType === "step") return LinkRadialStep
    if (linkType === "line") return LinkRadialLine
    if (linkType === "curve") return LinkRadialCurve
    return LinkRadial
  }
  if (orientation === "vertical") {
    if (linkType === "step") return LinkVerticalStep
    if (linkType === "line") return LinkVerticalLine
    if (linkType === "curve") return LinkVerticalCurve
    return LinkVertical
  }
  if (linkType === "step") return LinkHorizontalStep
  if (linkType === "line") return LinkHorizontalLine
  if (linkType === "curve") return LinkHorizontalCurve
  return LinkHorizontal
}

function chartSelectWidthClass(optionCount: number): string {
  return optionCount <= 2 ? "min-w-[7.5rem]" : "min-w-[6.5rem]"
}

export function TreeChartControls({
  settings,
  onChange,
  isDark,
  className,
}: {
  settings: TreeChartDisplaySettings
  onChange: (patch: Partial<TreeChartDisplaySettings>) => void
  isDark: boolean
  className?: string
}) {
  const labelClass = cn("shrink-0 text-xs font-medium", isDark ? "text-[#bccbb9]" : "text-slate-500")

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <label className={cn("inline-flex items-center gap-2", labelClass)}>
        Layout:
        <SimpleSelect
          value={labelForValue(LAYOUT_OPTIONS, settings.layout)}
          onChange={(label) => onChange({ layout: valueForLabel(LAYOUT_OPTIONS, label) })}
          options={LAYOUT_OPTIONS.map((option) => option.label)}
          isDark={isDark}
          size="compact"
          portalToBody
          className={chartSelectWidthClass(LAYOUT_OPTIONS.length)}
        />
      </label>
      <label className={cn("inline-flex items-center gap-2", labelClass)}>
        Orientation:
        <SimpleSelect
          value={labelForValue(ORIENTATION_OPTIONS, settings.orientation)}
          onChange={(label) => onChange({ orientation: valueForLabel(ORIENTATION_OPTIONS, label) })}
          options={ORIENTATION_OPTIONS.map((option) => option.label)}
          isDark={isDark}
          size="compact"
          portalToBody
          disabled={settings.layout === "polar"}
          className={chartSelectWidthClass(ORIENTATION_OPTIONS.length)}
        />
      </label>
      <label className={cn("inline-flex items-center gap-2", labelClass)}>
        Link Type:
        <SimpleSelect
          value={labelForValue(LINK_TYPE_OPTIONS, settings.linkType)}
          onChange={(label) => onChange({ linkType: valueForLabel(LINK_TYPE_OPTIONS, label) })}
          options={LINK_TYPE_OPTIONS.map((option) => option.label)}
          isDark={isDark}
          size="compact"
          portalToBody
          className={chartSelectWidthClass(LINK_TYPE_OPTIONS.length)}
        />
      </label>
      {settings.linkType === "step" ? (
        <label className={cn("inline-flex items-center gap-2", labelClass)}>
          Step:
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={settings.stepPercent}
            onChange={(e) => onChange({ stepPercent: Number(e.target.value) })}
            className={cn(
              "h-1.5 w-24 cursor-pointer appearance-none rounded-full",
              isDark ? "bg-[#2e3447] accent-[#4be277]" : "bg-slate-200 accent-blue-600",
            )}
          />
          <span className={cn("w-8 text-right tabular-nums", isDark ? "text-[#dce1fb]" : "text-slate-700")}>
            {settings.stepPercent.toFixed(1)}
          </span>
        </label>
      ) : null}
    </div>
  )
}

function isAvatarImageSrc(value?: string): boolean {
  if (!value) return false
  const trimmed = value.trim()
  return trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:image")
}

function estimateLabelWidth(label: string): number {
  return Math.max(72, Math.min(160, label.length * 6.5 + 20))
}

function TreeMemberNode({
  node,
  top,
  left,
  onToggleCollapse,
  highlightId,
  theme,
  isCollapsed,
  isDark,
  isHovered,
  onHover,
  isRoot,
}: {
  node: HierarchyPointNode<TreeChartNode>
  top: number
  left: number
  onToggleCollapse: (id: string) => void
  highlightId?: string
  theme: TreeChartTheme
  isCollapsed: boolean
  isDark: boolean
  isHovered: boolean
  onHover: (id: string | null) => void
  isRoot: boolean
}) {
  const radius = isRoot ? 18 : 16
  const hasChildren = Boolean(node.data.children?.length)
  const isHighlighted = node.data.id === highlightId
  const isVirtualRoot = node.data.id === "__virtual_root__"
  const displayName = node.data.name.trim() || "Member"
  const initials = node.data.initials?.trim() || "?"
  const avatarColor = node.data.avatarColor ?? theme.rootNodeFill
  const clipId = `tree-avatar-clip-${node.data.id}`
  const tooltipWidth = estimateLabelWidth(displayName)
  const showPhoto = isAvatarImageSrc(node.data.imageUrl)

  return (
    <Group
      top={top}
      left={left}
      onMouseEnter={() => onHover(node.data.id)}
      onMouseLeave={() => onHover(null)}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (!hasChildren) return
        onToggleCollapse(node.data.id)
      }}
      style={{ cursor: hasChildren ? "pointer" : "grab" }}
    >
      {(isHovered || isHighlighted) && (
        <circle
          r={radius + 5}
          fill={isHovered ? (isDark ? "rgba(75, 226, 119, 0.12)" : "rgba(37, 99, 235, 0.1)") : "transparent"}
          stroke={theme.highlightStroke}
          strokeWidth={isHovered ? 2.5 : 2}
          opacity={isHovered ? 1 : 0.85}
        />
      )}

      <defs>
        <clipPath id={clipId}>
          <circle r={radius} />
        </clipPath>
      </defs>

      {showPhoto ? (
        <>
          <circle r={radius} fill={theme.nodeFill} />
          <image
            href={node.data.imageUrl!.trim()}
            x={-radius}
            y={-radius}
            width={radius * 2}
            height={radius * 2}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
          <circle
            r={radius}
            fill="none"
            stroke={isHovered || isHighlighted ? theme.highlightStroke : theme.nodeBorderColor}
            strokeWidth={isHovered || isHighlighted ? 2 : 1}
          />
        </>
      ) : (
        <>
          <circle
            r={radius}
            fill={isVirtualRoot ? theme.rootNodeFill : avatarColor}
            stroke={isHovered || isHighlighted ? theme.highlightStroke : theme.nodeBorderColor}
            strokeWidth={isHovered || isHighlighted ? 2 : 1}
            strokeDasharray={hasChildren && isCollapsed ? "3,2" : undefined}
          />
          <text
            dy=".35em"
            fontSize={isVirtualRoot ? 7 : radius * 0.52}
            fontWeight="700"
            fontFamily="system-ui, sans-serif"
            textAnchor="middle"
            fill="#ffffff"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {initials}
          </text>
        </>
      )}

      {hasChildren ? (
        <circle
          cx={radius - 1}
          cy={-radius + 1}
          r={4}
          fill={isCollapsed ? theme.highlightStroke : isDark ? "#151b2d" : "#ffffff"}
          stroke={theme.highlightStroke}
          strokeWidth={1.25}
        />
      ) : null}

      {isHovered ? (
        <Group top={-(radius + 30)}>
          <rect
            x={-tooltipWidth / 2}
            y={-11}
            width={tooltipWidth}
            height={22}
            rx={6}
            fill="#171c1f"
          />
          <text
            dy=".35em"
            fontSize={10}
            fontWeight="600"
            fontFamily="system-ui, sans-serif"
            textAnchor="middle"
            fill="#ffffff"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {displayName}
          </text>
        </Group>
      ) : null}
    </Group>
  )
}

const defaultMargin = { top: 30, left: 30, right: 30, bottom: 70 }

export type TreeChartProps = {
  width: number
  height: number
  data: TreeChartNode
  settings: TreeChartDisplaySettings
  isDark?: boolean
  margin?: { top: number; right: number; bottom: number; left: number }
  highlightNodeId?: string
}

export function TreeChart({
  width: totalWidth,
  height: totalHeight,
  data,
  settings,
  isDark = false,
  margin = defaultMargin,
  highlightNodeId,
}: TreeChartProps) {
  const { layout, orientation, linkType, stepPercent } = settings
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const theme = getTreeChartTheme(isDark)

  useEffect(() => {
    setCollapsedIds(new Set())
    setHoveredNodeId(null)
  }, [data])

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const innerWidth = totalWidth - margin.left - margin.right
  const innerHeight = totalHeight - margin.top - margin.bottom

  let origin: { x: number; y: number }
  let sizeWidth: number
  let sizeHeight: number

  if (layout === "polar") {
    origin = {
      x: innerWidth / 2,
      y: innerHeight / 2,
    }
    sizeWidth = 2 * Math.PI
    sizeHeight = Math.min(innerWidth, innerHeight) / 2
  } else {
    origin = { x: 0, y: 0 }
    if (orientation === "vertical") {
      sizeWidth = innerWidth
      sizeHeight = innerHeight
    } else {
      sizeWidth = innerHeight
      sizeHeight = innerWidth
    }
  }

  const LinkComponent = getLinkComponent({ layout, linkType, orientation }) as React.ComponentType<{
    data: HierarchyPointLink<TreeChartNode>
    percent?: number
    stroke: string
    strokeWidth: string | number
    fill: string
  }>

  const rootNode = useMemo(
    () => hierarchy<TreeChartNode>(data, (d) => (collapsedIds.has(d.id) ? null : d.children)),
    [data, collapsedIds],
  )

  if (totalWidth < 10) return null

  const treeKey = `${layout}-${orientation}-${linkType}-${stepPercent}`

  return (
    <svg width={totalWidth} height={totalHeight} className="block max-w-none">
      <rect width={totalWidth} height={totalHeight} rx={14} fill={theme.canvasBg} />
      <Group top={margin.top} left={margin.left}>
        <Tree
          key={treeKey}
          root={rootNode}
          size={[sizeWidth, sizeHeight]}
          separation={(a, b) => (a.parent === b.parent ? 1 : 0.5) / 0.5}
        >
          {(tree) => (
            <Group top={origin.y} left={origin.x}>
              {tree.links().map((link, i) => (
                <LinkComponent
                  key={`${treeKey}-link-${i}`}
                  data={link}
                  percent={linkType === "step" ? stepPercent : undefined}
                  stroke={theme.linkColor}
                  strokeWidth="1.5"
                  fill="none"
                />
              ))}

              {tree.descendants().map((node, key) => {
                let top: number
                let left: number
                if (layout === "polar") {
                  const [radialX, radialY] = pointRadial(node.x, node.y)
                  top = radialY
                  left = radialX
                } else if (orientation === "vertical") {
                  top = node.y
                  left = node.x
                } else {
                  top = node.x
                  left = node.y
                }

                const isCollapsed = collapsedIds.has(node.data.id)

                return (
                  <TreeMemberNode
                    key={`${treeKey}-node-${node.data.id}`}
                    node={node}
                    top={top}
                    left={left}
                    onToggleCollapse={toggleCollapsed}
                    highlightId={highlightNodeId}
                    theme={theme}
                    isCollapsed={isCollapsed}
                    isDark={isDark}
                    isHovered={hoveredNodeId === node.data.id}
                    onHover={setHoveredNodeId}
                    isRoot={node.depth === 0}
                  />
                )
              })}
            </Group>
          )}
        </Tree>
      </Group>
    </svg>
  )
}
