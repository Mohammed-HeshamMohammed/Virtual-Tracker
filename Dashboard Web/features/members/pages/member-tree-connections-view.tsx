"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/shared/utils/utils"
import type { MemberTreeEdge, MemberTreeNode } from "@/features/members/services/member-tree"
import {
  buildMemberTreeBranches,
  memberBranchesToTreeChartData,
} from "@/features/members/utils/build-tree"
import {
  TreeChart,
  type TreeChartDisplaySettings,
} from "@/shared/ui/tree-chart"

export type TreeChartTransform = {
  x: number
  y: number
  scale: number
}

export const DEFAULT_TREE_CHART_TRANSFORM: TreeChartTransform = {
  x: 0,
  y: 0,
  scale: 1,
}

const MIN_ZOOM = 0.35
const MAX_ZOOM = 2.5
const ZOOM_STEP = 1.15

type TreeNodeCountShape = {
  children?: TreeNodeCountShape[]
}

function countTreeNodes(node: TreeNodeCountShape): number {
  let count = 1
  for (const child of node.children ?? []) {
    count += countTreeNodes(child)
  }
  return count
}

export function MemberTreeConnectionsView({
  nodes,
  edges,
  rootMemberId,
  currentMemberId,
  isDark,
  validRootMemberIds,
  settings,
  transform,
  onTransformChange,
}: {
  nodes: MemberTreeNode[]
  edges: MemberTreeEdge[]
  rootMemberId?: string | null
  currentMemberId?: string
  isDark: boolean
  validRootMemberIds?: string[] | null
  settings: TreeChartDisplaySettings
  transform: TreeChartTransform
  onTransformChange: (next: TreeChartTransform) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const transformRef = useRef(transform)
  transformRef.current = transform
  const dragStateRef = useRef<{
    active: boolean
    startX: number
    startY: number
    originX: number
    originY: number
    originScale: number
  }>({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    originScale: 1,
  })
  const [isDragging, setIsDragging] = useState(false)

  const chartData = useMemo(() => {
    const branches = buildMemberTreeBranches(nodes, edges, rootMemberId, validRootMemberIds)
    return memberBranchesToTreeChartData(branches, currentMemberId)
  }, [nodes, edges, rootMemberId, validRootMemberIds, currentMemberId])

  const chartSize = useMemo(() => {
    if (!chartData) return { width: 960, height: 560 }
    const nodeCount = countTreeNodes(chartData)
    if (settings.layout === "polar") {
      const size = Math.max(720, nodeCount * 72)
      return { width: size, height: size }
    }
    if (settings.orientation === "horizontal") {
      return {
        width: Math.max(960, nodeCount * 56),
        height: Math.max(560, nodeCount * 80),
      }
    }
    const width = Math.max(960, nodeCount * 80)
    const height = Math.max(560, nodeCount * 56)
    return { width, height }
  }, [chartData, settings.layout, settings.orientation])

  const endDrag = useCallback(() => {
    dragStateRef.current.active = false
    setIsDragging(false)
  }, [])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return

      dragStateRef.current = {
        active: true,
        startX: event.clientX,
        startY: event.clientY,
        originX: transformRef.current.x,
        originY: transformRef.current.y,
        originScale: transformRef.current.scale,
      }
      setIsDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStateRef.current.active) return
      const dx = event.clientX - dragStateRef.current.startX
      const dy = event.clientY - dragStateRef.current.startY
      onTransformChange({
        x: dragStateRef.current.originX + dx,
        y: dragStateRef.current.originY + dy,
        scale: dragStateRef.current.originScale,
      })
    },
    [onTransformChange],
  )

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault()
      const viewport = viewportRef.current
      if (!viewport) return

      const current = transformRef.current
      const rect = viewport.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const zoomFactor = event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP
      const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale * zoomFactor))
      const scaleRatio = nextScale / current.scale

      onTransformChange({
        scale: nextScale,
        x: pointerX - (pointerX - current.x) * scaleRatio,
        y: pointerY - (pointerY - current.y) * scaleRatio,
      })
    },
    [onTransformChange],
  )

  useEffect(() => {
    const onKeyUp = () => endDrag()
    window.addEventListener("pointerup", onKeyUp)
    window.addEventListener("pointercancel", onKeyUp)
    return () => {
      window.removeEventListener("pointerup", onKeyUp)
      window.removeEventListener("pointercancel", onKeyUp)
    }
  }, [endDrag])

  if (!chartData) {
    return (
      <div className={cn("rounded-xl border p-8 text-center text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        No members to display.
      </div>
    )
  }

  return (
    <div
      ref={viewportRef}
      className={cn(
        "relative h-full min-h-[480px] w-full overflow-hidden touch-none select-none",
        isDragging ? "cursor-grabbing" : "cursor-grab",
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={handleWheel}
      onDoubleClick={(event) => event.preventDefault()}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
      >
        <TreeChart
          width={chartSize.width}
          height={chartSize.height}
          data={chartData}
          settings={settings}
          isDark={isDark}
          highlightNodeId={currentMemberId}
        />
      </div>

      <div
        className={cn(
          "pointer-events-none absolute bottom-3 right-3 rounded-lg border px-2.5 py-1 text-[10px] font-medium",
          isDark ? "border-[#3d4a3d]/40 bg-[#191f31]/90 text-[#bccbb9]" : "border-slate-200 bg-white/90 text-slate-500",
        )}
      >
        Drag anywhere to pan · Scroll to zoom · Double-click node to expand/collapse
      </div>
    </div>
  )
}

export function clampTreeChartZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

export function zoomTreeChartIn(transform: TreeChartTransform): TreeChartTransform {
  return {
    ...transform,
    scale: clampTreeChartZoom(transform.scale * ZOOM_STEP),
  }
}

export function zoomTreeChartOut(transform: TreeChartTransform): TreeChartTransform {
  return {
    ...transform,
    scale: clampTreeChartZoom(transform.scale / ZOOM_STEP),
  }
}
