"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRightLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  FileImage,
  HelpCircle,
  Hand,
  LocateFixed,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react"
import type { MemberTreeEdge, MemberTreeNode, MemberTreeScope } from "@/features/members/services/member-tree"
import type { TreeChartDisplaySettings } from "@/shared/ui/tree-chart"
import { buildTreeSvg } from "./export-svg"
import { DEFAULT_LAYOUT_OPTIONS, computeLayout, type LayoutOptions, type Point } from "./layout"
import { buildLinks } from "./link-set"
import {
  allParents,
  buildTreeModel,
  collapsedBeyond,
  descendantsOf,
  edgesAfterMove,
  maxDepth,
  pathToRoot,
  type TreeEdgeInfo,
  type TreeModel,
} from "./model"
import { NodeCard, type DropState } from "./node-card"
import { loadOffsets, offsetsKey, pruneOffsets, saveOffsets, type Offsets } from "./offsets"
import { DetailsPanel, IconButton, Legend, Minimap, OrphanTray, SearchBox, Surface, ConfirmMove } from "./panels"
import { roleKey, roleRank } from "./roles"
import { canReassign } from "./rules"
import { chartTheme } from "./theme"

type Transform = { x: number; y: number; scale: number }

const MIN_ZOOM = 0.15
const MAX_ZOOM = 2.5
const ZOOM_STEP = 1.2
const COMPACT_BELOW = 0.3
/** On open, never zoom out past this: a readable top of the tree beats a whole organization of coloured tiles. */
const OPEN_MIN_ZOOM = 0.55
const DRAG_THRESHOLD = 4

const NODE_W = DEFAULT_LAYOUT_OPTIONS.nodeWidth
const NODE_H = DEFAULT_LAYOUT_OPTIONS.nodeHeight

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

function memberColour(id: string, isSelf: boolean): string {
  if (isSelf) return "#2563eb"
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  const palette = ["#6366f1", "#0891b2", "#059669", "#d97706", "#db2777", "#64748b"]
  return palette[Math.abs(hash) % palette.length]
}

export type MemberTreeConnectionsViewProps = {
  nodes: MemberTreeNode[]
  edges: MemberTreeEdge[]
  validRootMemberIds?: string[] | null
  scope: MemberTreeScope
  viewerId?: string
  isDark: boolean
  settings: TreeChartDisplaySettings
  /** Owner / Super Admin in the organization view: may change who reports to whom. */
  canReassign: boolean
  /** "Add member here"; absent when the viewer cannot add members. */
  onAddHere?: (node: MemberTreeNode) => void
  /** Carries out a reassignment; throw an Error with a readable message to refuse. */
  onReassign?: (memberId: string, newParentId: string) => Promise<void>
}

type Ghost = { id: string; x: number; y: number; targetId: string | null; ok: boolean; reason: string }
type Toast = { text: string; tone: "ok" | "bad" }

export function MemberTreeConnectionsView(props: MemberTreeConnectionsViewProps) {
  const { nodes, edges, validRootMemberIds, scope, viewerId, isDark, settings } = props
  const theme = useMemo(() => chartTheme(isDark), [isDark])

  /* ---------- the tree ---------- */

  // A reassignment shows at once; the real answer replaces it when the refetched edges arrive.
  const [moves, setMoves] = useState<Map<string, string>>(() => new Map())
  useEffect(() => setMoves(new Map()), [edges])
  const effectiveEdges = useMemo(() => {
    let current: TreeEdgeInfo[] = edges
    for (const [id, parentId] of moves) current = edgesAfterMove(current, id, parentId)
    return current
  }, [edges, moves])

  const model: TreeModel = useMemo(
    () => buildTreeModel({ nodes, edges: effectiveEdges, validRootIds: validRootMemberIds }),
    [nodes, effectiveEdges, validRootMemberIds],
  )

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [focusRootId, setFocusRootId] = useState<string | null>(null)
  const [levels, setLevels] = useState<number | null>(null)
  useEffect(() => {
    if (focusRootId && !model.nodeById.has(focusRootId)) setFocusRootId(null)
  }, [model, focusRootId])

  const layoutOptions: LayoutOptions = useMemo(
    () => ({ ...DEFAULT_LAYOUT_OPTIONS, layout: settings.layout, orientation: settings.orientation }),
    [settings.layout, settings.orientation],
  )
  const layoutInput = useMemo(
    () => ({ roots: focusRootId && model.nodeById.has(focusRootId) ? [focusRootId] : model.roots, childrenOf: model.childrenOf }),
    [model, focusRootId],
  )
  const base = useMemo(() => computeLayout(layoutInput, collapsed, layoutOptions), [layoutInput, collapsed, layoutOptions])

  /* ---------- cards the viewer has moved ---------- */

  const storageKey = offsetsKey(scope, viewerId)
  const [offsets, setOffsets] = useState<Offsets>(() => new Map())
  const offsetsLoadedFor = useRef<string | null>(null)
  useEffect(() => {
    setOffsets(loadOffsets(storageKey))
    offsetsLoadedFor.current = storageKey
  }, [storageKey])
  useEffect(() => {
    if (offsetsLoadedFor.current !== storageKey) return
    saveOffsets(storageKey, pruneOffsets(offsets, new Set(model.nodeById.keys())))
  }, [offsets, storageKey, model])

  const positions = useMemo(() => {
    const out = new Map<string, Point>()
    for (const [id, p] of base.positions) {
      const o = offsets.get(id)
      out.set(id, o ? { x: p.x + o.x, y: p.y + o.y } : p)
    }
    return out
  }, [base.positions, offsets])
  const movedIds = useMemo(() => new Set(offsets.keys()), [offsets])

  const contentBounds = useMemo(() => {
    let minX = 0
    let minY = 0
    let maxX = Math.max(base.bounds.maxX, 1)
    let maxY = Math.max(base.bounds.maxY, 1)
    for (const p of positions.values()) {
      minX = Math.min(minX, p.x - NODE_W / 2 - 40)
      minY = Math.min(minY, p.y - NODE_H / 2 - 40)
      maxX = Math.max(maxX, p.x + NODE_W / 2 + 40)
      maxY = Math.max(maxY, p.y + NODE_H / 2 + 40)
    }
    return { minX, minY, width: maxX - minX, height: maxY - minY }
  }, [base.bounds, positions])

  /* ---------- view: pan, zoom, fit ---------- */

  const viewportRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [transform, setTransformState] = useState<Transform>({ x: 0, y: 0, scale: 1 })
  const transformRef = useRef(transform)
  transformRef.current = transform
  const [smooth, setSmooth] = useState(false)
  const smoothTimer = useRef<number | null>(null)

  const setTransform = useCallback((next: Transform, animate = false) => {
    if (smoothTimer.current) window.clearTimeout(smoothTimer.current)
    setSmooth(animate)
    if (animate) smoothTimer.current = window.setTimeout(() => setSmooth(false), 320)
    transformRef.current = next
    setTransformState(next)
  }, [])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewport({ width: element.clientWidth, height: element.clientHeight }))
    observer.observe(element)
    setViewport({ width: element.clientWidth, height: element.clientHeight })
    return () => observer.disconnect()
  }, [])

  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const viewportSizeRef = useRef(viewport)
  viewportSizeRef.current = viewport
  const rootsRef = useRef(layoutInput.roots)
  rootsRef.current = layoutInput.roots

  const fit = useCallback(
    (ids?: string[], animate = true, options?: { minScale?: number }) => {
      const { width, height } = viewportSizeRef.current
      if (width < 10 || height < 10) return
      const pts = (ids ?? [...positionsRef.current.keys()]).map((id) => positionsRef.current.get(id)).filter((p): p is Point => Boolean(p))
      if (pts.length === 0) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of pts) {
        minX = Math.min(minX, p.x - NODE_W / 2)
        maxX = Math.max(maxX, p.x + NODE_W / 2)
        minY = Math.min(minY, p.y - NODE_H / 2)
        maxY = Math.max(maxY, p.y + NODE_H / 2)
      }
      const pad = 70
      const fitScale = clampZoom(Math.min(1.1, (width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY)))
      const scale = options?.minScale && fitScale < options.minScale ? options.minScale : fitScale
      // If we had to stay larger than the true fit, show the top of the tree and let the viewer pan down.
      const tooBig = scale > fitScale + 0.001
      const rootPoints = rootsRef.current.map((id) => positionsRef.current.get(id)).filter((p): p is Point => Boolean(p))
      // The first root is the organization's own; later ones are strays (a Client, say) off to the side.
      const anchorX = tooBig && rootPoints.length > 0 ? rootPoints[0].x : (minX + maxX) / 2
      setTransform(
        {
          scale,
          x: width / 2 - anchorX * scale,
          y: tooBig ? pad - minY * scale : height / 2 - ((minY + maxY) / 2) * scale,
        },
        animate,
      )
    },
    [setTransform],
  )

  const centerOn = useCallback(
    (point: Point, scale?: number, animate = true) => {
      const { width, height } = viewportSizeRef.current
      const k = scale ?? transformRef.current.scale
      setTransform({ scale: k, x: width / 2 - point.x * k, y: height / 2 - point.y * k }, animate)
    },
    [setTransform],
  )

  const zoomBy = useCallback(
    (factor: number, around?: { x: number; y: number }) => {
      const current = transformRef.current
      const { width, height } = viewportSizeRef.current
      const origin = around ?? { x: width / 2, y: height / 2 }
      const scale = clampZoom(current.scale * factor)
      const ratio = scale / current.scale
      setTransform({ scale, x: origin.x - (origin.x - current.x) * ratio, y: origin.y - (origin.y - current.y) * ratio }, !around)
    },
    [setTransform],
  )

  // Fit once the viewport is measured and whenever the arrangement style changes - not when
  // someone collapses a team or drags a card, which must not move the picture under them.
  // Hidden until the first fit, so the chart never flashes at the wrong place and size.
  const [opened, setOpened] = useState(false)
  const fittedKey = useRef<string>("")
  useEffect(() => {
    if (viewport.width < 10 || positions.size === 0) return
    const key = `${scope}|${settings.layout}|${settings.orientation}`
    if (fittedKey.current === key) return
    fittedKey.current = key
    fit(undefined, false, { minScale: OPEN_MIN_ZOOM })
    setOpened(true)
  }, [viewport, positions, scope, settings.layout, settings.orientation, fit])

  // Wheel zoom around the pointer. Native listener: React's onWheel is passive and cannot stop the page scrolling.
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      zoomBy(event.deltaY > 0 ? 1 / 1.12 : 1.12, { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [zoomBy])

  /* ---------- selection, hover, filters ---------- */

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [roleFocus, setRoleFocus] = useState<string | null>(null)
  const [mode, setMode] = useState<"arrange" | "reassign">("arrange")
  const [helpOpen, setHelpOpen] = useState(false)
  useEffect(() => {
    if (!props.canReassign) setMode("arrange")
  }, [props.canReassign])
  useEffect(() => {
    if (selectedId && !model.nodeById.has(selectedId)) setSelectedId(null)
  }, [model, selectedId])

  const focusId = hoverId ?? selectedId
  const traced = useMemo(() => {
    if (!focusId || !model.nodeById.has(focusId)) return null
    const set = new Set(pathToRoot(model, focusId))
    const below = focusId === selectedId ? descendantsOf(model, focusId) : (model.childrenOf.get(focusId) ?? [])
    for (const id of below) set.add(id)
    return set
  }, [focusId, selectedId, model])

  const roles = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of model.nodeById.values()) counts.set(node.role, (counts.get(node.role) ?? 0) + 1)
    return [...counts].map(([role, count]) => ({ role, count })).sort((a, b) => roleRank(b.role) - roleRank(a.role))
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

  const toggleCollapse = useCallback((id: string) => {
    setLevels(null)
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const select = useCallback(
    (id: string | null, options?: { center?: boolean }) => {
      setSelectedId(id)
      if (id && options?.center) {
        // Reveal it first: a collapsed ancestor would hide the card we are about to centre on.
        const hidden = pathToRoot(model, id).slice(1).filter((ancestor) => collapsed.has(ancestor))
        if (hidden.length > 0) {
          setCollapsed((prev) => {
            const next = new Set(prev)
            hidden.forEach((h) => next.delete(h))
            return next
          })
          window.setTimeout(() => {
            const p = positionsRef.current.get(id)
            if (p) centerOn(p, Math.max(transformRef.current.scale, 0.8))
          }, 60)
        } else {
          const p = positionsRef.current.get(id)
          if (p) centerOn(p, Math.max(transformRef.current.scale, 0.8))
        }
      }
    },
    [model, collapsed, centerOn],
  )

  /* ---------- toasts and reassignment ---------- */

  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<number | null>(null)
  const showToast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    setToast({ text, tone })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3800)
  }, [])

  const [pending, setPending] = useState<{ memberId: string; newParentId: string } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState("")

  const requestMove = useCallback(
    (memberId: string, newParentId: string) => {
      const verdict = canReassign(model, memberId, newParentId)
      if (!verdict.ok) return showToast(verdict.reason, "bad")
      if (verdict.noop) return showToast(`${model.nodeById.get(memberId)?.name ?? "They"} already report to ${model.nodeById.get(newParentId)?.name ?? "them"}.`)
      setConfirmError("")
      setPending({ memberId, newParentId })
    },
    [model, showToast],
  )

  const confirmMove = useCallback(async () => {
    if (!pending || !props.onReassign) return
    setConfirmBusy(true)
    setConfirmError("")
    try {
      await props.onReassign(pending.memberId, pending.newParentId)
      const { memberId, newParentId } = pending
      setMoves((prev) => new Map(prev).set(memberId, newParentId))
      setOffsets((prev) => {
        if (!prev.has(memberId)) return prev
        const next = new Map(prev)
        next.delete(memberId)
        return next
      })
      setPending(null)
      showToast(`${model.nodeById.get(memberId)?.name ?? "Member"} now reports to ${model.nodeById.get(newParentId)?.name ?? "their new manager"}.`)
      select(memberId, { center: true })
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : "Could not change the manager.")
    } finally {
      setConfirmBusy(false)
    }
  }, [pending, props, model, showToast, select])

  /* ---------- dragging cards ---------- */

  const modeRef = useRef(mode)
  modeRef.current = mode
  const modelRef = useRef(model)
  modelRef.current = model
  const offsetsRef = useRef(offsets)
  offsetsRef.current = offsets
  const canReassignRef = useRef(props.canReassign)
  canReassignRef.current = props.canReassign
  const requestMoveRef = useRef(requestMove)
  requestMoveRef.current = requestMove
  const [dragId, setDragId] = useState<string | null>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)

  const toCanvas = useCallback((clientX: number, clientY: number): Point => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const t = transformRef.current
    return { x: (clientX - (rect?.left ?? 0) - t.x) / t.scale, y: (clientY - (rect?.top ?? 0) - t.y) / t.scale }
  }, [])

  const targetAt = useCallback((point: Point, draggedId: string): string | null => {
    let found: string | null = null
    for (const [id, p] of positionsRef.current) {
      if (id === draggedId) continue
      if (Math.abs(point.x - p.x) <= NODE_W / 2 && Math.abs(point.y - p.y) <= NODE_H / 2) found = id
    }
    return found
  }, [])

  /** Starts a drag of one card (or, from the tray, one member). `reassign` decides what dropping means. */
  const beginDrag = useCallback(
    (event: { clientX: number; clientY: number; shiftKey: boolean }, id: string, reassign: boolean, onClick: () => void) => {
      const startX = event.clientX
      const startY = event.clientY
      const ids = reassign ? [id] : event.shiftKey ? [id, ...descendantsOf(modelRef.current, id).filter((d) => positionsRef.current.has(d))] : [id]
      const origin = new Map(ids.map((i) => [i, offsetsRef.current.get(i) ?? { x: 0, y: 0 }]))
      let moved = false

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        if (!moved) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
          moved = true
          setDragId(id)
        }
        if (reassign) {
          const point = toCanvas(e.clientX, e.clientY)
          const target = targetAt(point, id)
          const verdict = target ? canReassign(modelRef.current, id, target) : null
          setGhost({
            id,
            x: point.x,
            y: point.y,
            targetId: target,
            ok: verdict ? verdict.ok && !verdict.noop : false,
            reason: verdict ? (verdict.ok ? (verdict.noop ? "Already their manager" : "") : verdict.reason) : "",
          })
        } else {
          const k = transformRef.current.scale
          setOffsets((prev) => {
            const next = new Map(prev)
            for (const [i, o] of origin) next.set(i, { x: o.x + dx / k, y: o.y + dy / k })
            return next
          })
        }
      }
      const finish = (e: PointerEvent | null) => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onCancel)
        setDragId(null)
        setGhost(null)
        if (!moved) {
          if (e) onClick()
          return
        }
        if (reassign && e) {
          const target = targetAt(toCanvas(e.clientX, e.clientY), id)
          if (target) requestMoveRef.current(id, target)
        }
      }
      const onUp = (e: PointerEvent) => finish(e)
      const onCancel = () => finish(null)
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onCancel)
    },
    [toCanvas, targetAt],
  )

  const onNodePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, id: string) => {
      if (event.button !== 0) return
      event.stopPropagation()
      viewportRef.current?.focus({ preventScroll: true })
      const reassign = modeRef.current === "reassign" && canReassignRef.current
      beginDrag(event, id, reassign, () => setSelectedId(id))
    },
    [beginDrag],
  )

  const onTrayDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>, id: string) => {
      if (event.button !== 0 || !canReassignRef.current) return
      beginDrag(event, id, true, () => setSelectedId(id))
    },
    [beginDrag],
  )

  /* ---------- panning the background ---------- */

  const panRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null)
  const [panning, setPanning] = useState(false)
  const onBackgroundPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    viewportRef.current?.focus({ preventScroll: true })
    panRef.current = { x: event.clientX, y: event.clientY, ox: transformRef.current.x, oy: transformRef.current.y, moved: false }
  }
  const onBackgroundPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (!pan) return
    const dx = event.clientX - pan.x
    const dy = event.clientY - pan.y
    if (!pan.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      pan.moved = true
      setPanning(true)
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* pointer already gone */
      }
    }
    setTransform({ scale: transformRef.current.scale, x: pan.ox + dx, y: pan.oy + dy })
  }
  const endPan = () => {
    const pan = panRef.current
    panRef.current = null
    setPanning(false)
    if (pan && !pan.moved) setSelectedId(null)
  }

  /* ---------- keyboard ---------- */

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).tagName === "INPUT") return
    const id = selectedId
    const move = (to: string | null | undefined) => {
      if (to) select(to, { center: true })
    }
    switch (event.key) {
      case "/":
        event.preventDefault()
        searchRef.current?.focus()
        break
      case "+":
      case "=":
        zoomBy(ZOOM_STEP)
        break
      case "-":
      case "_":
        zoomBy(1 / ZOOM_STEP)
        break
      case "0":
      case "f":
      case "F":
        fit()
        break
      case "Escape":
        if (pending) setPending(null)
        else if (helpOpen) setHelpOpen(false)
        else if (ghost) setGhost(null)
        else setSelectedId(null)
        break
      case "ArrowUp":
        event.preventDefault()
        if (id) move(model.parentOf.get(id))
        break
      case "ArrowDown":
        event.preventDefault()
        if (id) move(model.childrenOf.get(id)?.[0])
        break
      case "ArrowLeft":
      case "ArrowRight": {
        event.preventDefault()
        if (!id) break
        const siblings = model.parentOf.get(id) ? (model.childrenOf.get(model.parentOf.get(id)!) ?? []) : model.roots
        const index = siblings.indexOf(id)
        move(siblings[index + (event.key === "ArrowRight" ? 1 : -1)])
        break
      }
      case "Enter":
      case " ":
        if (id && (model.childrenOf.get(id)?.length ?? 0) > 0) {
          event.preventDefault()
          toggleCollapse(id)
        }
        break
    }
  }

  /* ---------- structure controls ---------- */

  const depth = maxDepth(model)
  const collapseAll = () => {
    setLevels(null)
    setCollapsed(allParents(model))
    window.setTimeout(() => fit(), 50)
  }
  const expandAll = () => {
    setLevels(null)
    setCollapsed(new Set())
    window.setTimeout(() => fit(), 50)
  }
  const showLevels = (n: number) => {
    const clamped = Math.max(1, Math.min(depth, n))
    setLevels(clamped >= depth ? null : clamped)
    setCollapsed(clamped >= depth ? new Set() : collapsedBeyond(model, clamped))
    window.setTimeout(() => fit(), 50)
  }
  const shownLevels = levels ?? depth

  const resetArrangement = () => {
    setOffsets(new Map())
    saveOffsets(storageKey, new Map())
    showToast("Cards are back where the layout put them.")
  }

  const focusBranch = (id: string) => {
    setFocusRootId(id)
    window.setTimeout(() => fit(), 60)
  }
  const clearFocusBranch = () => {
    setFocusRootId(null)
    window.setTimeout(() => fit(), 60)
  }

  /* ---------- export ---------- */

  const exportSvgText = () =>
    buildTreeSvg({
      model,
      positions,
      groups: base.groups,
      movedIds,
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
      orientation: settings.orientation,
      linkType: settings.linkType,
      stepPercent: settings.stepPercent,
      isDark,
      title: `Members tree (${scope})`,
    })
  const download = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `members-tree-${scope}-${new Date().toISOString().slice(0, 10)}.${extension}`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  const exportSvg = () => download(new Blob([exportSvgText()], { type: "image/svg+xml" }), "svg")
  const exportPng = () => {
    const svg = exportSvgText()
    const image = new Image()
    image.onload = () => {
      const maxSide = 7000
      const scale = Math.min(2, maxSide / Math.max(image.width, image.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext("2d")
      if (!context) return showToast("Your browser could not make the image.", "bad")
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => (blob ? download(blob, "png") : showToast("Your browser could not make the image.", "bad")), "image/png")
    }
    image.onerror = () => showToast("Your browser could not make the image.", "bad")
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }

  /* ---------- drawing ---------- */

  const links = useMemo(
    () =>
      buildLinks({
        model,
        positions,
        groups: base.groups,
        movedIds,
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
        orientation: settings.orientation,
        type: settings.linkType,
        stepPercent: settings.stepPercent,
      }),
    [model, positions, base.groups, movedIds, settings.orientation, settings.linkType, settings.stepPercent],
  )

  const compact = transform.scale < COMPACT_BELOW
  const selfId = viewerId
  const tracedFor = (id: string) => (traced ? traced.has(id) : false)
  const dimmedFor = (id: string) => {
    if (roleFocus) return roleKey(model.nodeById.get(id)?.role) !== roleKey(roleFocus)
    return traced ? !traced.has(id) : false
  }
  const dropFor = (id: string): DropState => {
    if (!ghost || ghost.targetId !== id) return null
    return ghost.ok ? "ok" : "bad"
  }

  if (model.nodeById.size === 0) {
    return (
      <div className="grid h-full min-h-[320px] place-items-center text-sm" style={{ color: theme.muted }}>
        No members to display.
      </div>
    )
  }

  const selectedNode = selectedId ? model.nodeById.get(selectedId) : null
  const reassignAllowed = props.canReassign && Boolean(props.onReassign)

  return (
    <div
      ref={viewportRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onBackgroundPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      // overflow-clip, not hidden: a hidden box can still be scrolled by focus or scrollIntoView, which slid the whole chart sideways.
      className="relative h-full min-h-[480px] w-full select-none overflow-clip outline-none"
      style={{
        backgroundColor: theme.canvas,
        backgroundImage: `radial-gradient(${theme.dots} 1.2px, transparent 1.2px)`,
        backgroundSize: `${28 * transform.scale}px ${28 * transform.scale}px`,
        backgroundPosition: `${transform.x}px ${transform.y}px`,
        cursor: panning ? "grabbing" : ghost ? "copy" : "default",
        touchAction: "none",
      }}
    >
      {/* the chart */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transition: smooth ? "transform 300ms cubic-bezier(.2,.8,.2,1)" : undefined,
          willChange: "transform",
          opacity: opened ? 1 : 0,
        }}
      >
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {base.groups.map((g) => (
            <g key={`frame-${g.parentId}`}>
              <rect x={g.x} y={g.y} width={g.width} height={g.height} rx={16} fill={theme.frame} stroke={theme.border} strokeDasharray="5 5" />
              <text x={g.x + 14} y={g.y + 17} fontSize={11} fontWeight={600} fill={theme.muted}>
                {g.memberIds.length} direct reports
              </text>
            </g>
          ))}
          {links.map((link) => {
            const active = traced ? Boolean(traced.has(link.fromId) && (link.toId ? traced.has(link.toId) : true)) : false
            const dim = traced ? !active : false
            return (
              <path
                key={link.key}
                d={link.d}
                fill="none"
                stroke={active ? theme.linkActive : theme.link}
                strokeWidth={active ? 2.2 : 1.5}
                opacity={dim ? 0.18 : 1}
                style={{ transition: "opacity 140ms ease, stroke 140ms ease" }}
              />
            )
          })}
        </svg>

        {[...positions].map(([id, p]) => {
          const node = model.nodeById.get(id)
          if (!node) return null
          const directReports = model.childrenOf.get(id)?.length ?? 0
          return (
            <NodeCard
              key={id}
              node={node}
              x={p.x}
              y={p.y}
              width={NODE_W}
              height={NODE_H}
              theme={theme}
              avatarColor={memberColour(id, id === selfId)}
              isSelf={id === selfId}
              selected={id === selectedId}
              dimmed={dimmedFor(id)}
              traced={tracedFor(id)}
              collapsed={collapsed.has(id)}
              directReports={directReports}
              branchSize={branchSizes.get(id) ?? 0}
              compact={compact}
              drop={dropFor(id)}
              dragging={dragId === id}
              needsManager={node.hierarchy_status === "hierarchy_assignment_required"}
              onPointerDown={onNodePointerDown}
              onDoubleClick={(nodeId) => (model.childrenOf.get(nodeId)?.length ? toggleCollapse(nodeId) : undefined)}
              onToggle={toggleCollapse}
              onAdd={props.onAddHere && roleKey(node.role) !== "client" ? (nodeId) => props.onAddHere?.(model.nodeById.get(nodeId)!) : undefined}
              onHover={setHoverId}
            />
          )
        })}

        {ghost ? (
          <div className="pointer-events-none absolute z-50" style={{ left: ghost.x, top: ghost.y, transform: "translate(-50%, -50%)" }}>
            <div
              className="rounded-xl border px-3 py-2 text-xs font-semibold"
              style={{ background: theme.card, borderColor: ghost.targetId ? (ghost.ok ? theme.accent : theme.danger) : theme.borderStrong, color: theme.text, boxShadow: theme.shadow }}
            >
              {model.nodeById.get(ghost.id)?.name}
              {ghost.targetId ? (
                <span className="ml-2 font-normal" style={{ color: ghost.ok ? theme.accent : theme.danger }}>
                  {ghost.ok ? `→ under ${model.nodeById.get(ghost.targetId)?.name}` : ghost.reason}
                </span>
              ) : (
                <span className="ml-2 font-normal" style={{ color: theme.muted }}>
                  drop on a manager
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* top left: find + mode */}
      <div className="absolute left-3 top-3 z-40 flex flex-wrap items-center gap-2">
        <Surface theme={theme} className="flex items-center gap-2 p-1.5">
          <SearchBox theme={theme} model={model} inputRef={searchRef} onPick={(id) => select(id, { center: true })} />
          {reassignAllowed ? (
            <div className="flex overflow-hidden rounded-lg border" style={{ borderColor: theme.panelBorder }} role="group" aria-label="Drag mode">
              <ModeButton theme={theme} active={mode === "arrange"} onClick={() => setMode("arrange")} icon={<Hand className="h-3.5 w-3.5" />} label="Arrange" title="Drag cards to rearrange the picture (nothing is saved to the organization)" />
              <ModeButton theme={theme} active={mode === "reassign"} onClick={() => setMode("reassign")} icon={<ArrowRightLeft className="h-3.5 w-3.5" />} label="Reassign" title="Drag a member onto a new manager to change who they report to" />
            </div>
          ) : null}
        </Surface>
        {focusRootId ? (
          <Surface theme={theme} className="flex items-center gap-2 px-3 py-1.5 text-xs" style={{ color: theme.text }}>
            Focused on <strong>{model.nodeById.get(focusRootId)?.name}</strong>
            <button type="button" onClick={clearFocusBranch} aria-label="Show the whole tree" style={{ color: theme.muted }}>
              <X className="h-3.5 w-3.5" />
            </button>
          </Surface>
        ) : null}
      </div>

      {/* top right: view controls */}
      <div className="absolute right-3 top-3 z-40 flex items-start gap-2" style={{ right: selectedNode ? 324 : 12 }}>
        <Surface theme={theme} className="flex items-center gap-1 p-1.5">
          <IconButton theme={theme} title="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <Minus className="h-4 w-4" />
          </IconButton>
          <span className="w-11 text-center text-[11px] font-semibold tabular-nums" style={{ color: theme.muted }}>
            {Math.round(transform.scale * 100)}%
          </span>
          <IconButton theme={theme} title="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
            <Plus className="h-4 w-4" />
          </IconButton>
          <IconButton theme={theme} title="Fit everything on screen  ( F )" onClick={() => fit()}>
            <Maximize2 className="h-4 w-4" />
          </IconButton>
          <IconButton
            theme={theme}
            title="Find me"
            disabled={!selfId || !positions.has(selfId)}
            onClick={() => selfId && select(selfId, { center: true })}
          >
            <LocateFixed className="h-4 w-4" />
          </IconButton>
        </Surface>
        <Surface theme={theme} className="flex items-center gap-1 p-1.5">
          <IconButton theme={theme} title="Hide every team" onClick={collapseAll}>
            <ChevronsDownUp className="h-4 w-4" />
          </IconButton>
          <IconButton theme={theme} title="Show every team" onClick={expandAll}>
            <ChevronsUpDown className="h-4 w-4" />
          </IconButton>
          <div className="flex items-center gap-0.5 pl-1" title="How many levels to show">
            <IconButton theme={theme} title="Show one level fewer" disabled={shownLevels <= 1} onClick={() => showLevels(shownLevels - 1)}>
              <Minus className="h-3.5 w-3.5" />
            </IconButton>
            <span className="w-14 text-center text-[11px] font-semibold tabular-nums" style={{ color: theme.muted }}>
              {shownLevels}/{depth} levels
            </span>
            <IconButton theme={theme} title="Show one level more" disabled={shownLevels >= depth} onClick={() => showLevels(shownLevels + 1)}>
              <Plus className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </Surface>
        <Surface theme={theme} className="flex items-center gap-1 p-1.5">
          <IconButton theme={theme} title="Put every card back where the layout placed it" disabled={offsets.size === 0} onClick={resetArrangement}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>
          <IconButton theme={theme} title="Download as a vector image (SVG)" onClick={exportSvg}>
            <Download className="h-4 w-4" />
          </IconButton>
          <IconButton theme={theme} title="Download as a picture (PNG)" onClick={exportPng}>
            <FileImage className="h-4 w-4" />
          </IconButton>
          <IconButton theme={theme} title="Shortcuts" active={helpOpen} onClick={() => setHelpOpen((v) => !v)}>
            <HelpCircle className="h-4 w-4" />
          </IconButton>
        </Surface>
      </div>

      {helpOpen ? (
        <Surface theme={theme} className="absolute right-3 top-[60px] z-50 w-[270px] p-4 text-xs leading-relaxed" style={{ color: theme.text, right: selectedNode ? 324 : 12 }}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.muted }}>
            Shortcuts
          </p>
          <ul className="space-y-1">
            <li>Drag the background to pan, scroll to zoom</li>
            <li>Drag a card to move it · hold Shift to move its whole team</li>
            <li>Click a card for details · double-click to hide or show its team</li>
            <li>Arrow keys move between cards · Enter hides or shows a team</li>
            <li>
              <kbd>/</kbd> find · <kbd>F</kbd> fit · <kbd>+</kbd> <kbd>-</kbd> zoom · <kbd>Esc</kbd> deselect
            </li>
            {reassignAllowed ? <li>Reassign mode: drag a member onto their new manager</li> : null}
          </ul>
        </Surface>
      ) : null}

      {/* details */}
      {selectedNode ? (
        <div className="absolute bottom-3 right-3 top-3 z-40 flex w-[300px] items-start">
          <DetailsPanel
            theme={theme}
            model={model}
            memberId={selectedNode.id}
            isSelf={selectedNode.id === selfId}
            collapsed={collapsed.has(selectedNode.id)}
            reassignAllowed={reassignAllowed}
            onClose={() => setSelectedId(null)}
            onSelect={(id) => select(id, { center: true })}
            onFocusBranch={focusBranch}
            onToggleCollapse={toggleCollapse}
            onAdd={props.onAddHere && roleKey(selectedNode.role) !== "client" ? (id) => props.onAddHere?.(model.nodeById.get(id)!) : undefined}
            onChooseManager={requestMove}
          />
        </div>
      ) : null}

      {/* bottom left: minimap + people who need a manager */}
      <div className="absolute bottom-3 left-3 z-40 flex flex-col items-start gap-2">
        <OrphanTray theme={theme} model={model} reassignAllowed={reassignAllowed} onSelect={(id) => setSelectedId(id)} onStartDrag={onTrayDrag} />
        <Minimap
          theme={theme}
          model={model}
          positions={positions}
          bounds={contentBounds}
          viewport={viewport}
          transform={transform}
          selectedId={selectedId}
          onCenterOn={(point) => centerOn(point, undefined, false)}
        />
      </div>

      {/* bottom: legend */}
      <div className="absolute bottom-3 z-30" style={{ left: 218, right: selectedNode ? 324 : 12 }}>
        <div className="flex justify-end">
          <Legend theme={theme} roles={roles} active={roleFocus} onToggle={setRoleFocus} />
        </div>
      </div>

      {mode === "reassign" ? (
        <div className="pointer-events-none absolute left-1/2 top-[58px] z-30 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: theme.accentSoft, color: theme.accent }}>
          Reassign: drag a member onto their new manager
        </div>
      ) : null}

      {toast ? (
        <div
          role="status"
          className="pointer-events-none absolute bottom-16 left-1/2 z-[80] -translate-x-1/2 rounded-xl px-4 py-2 text-xs font-semibold"
          style={{ background: toast.tone === "ok" ? theme.accent : theme.danger, color: "#fff", boxShadow: theme.shadow }}
        >
          {toast.text}
        </div>
      ) : null}

      {pending ? (
        <ConfirmMove
          theme={theme}
          model={model}
          memberId={pending.memberId}
          newParentId={pending.newParentId}
          busy={confirmBusy}
          error={confirmError}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmMove()}
        />
      ) : null}
    </div>
  )
}

function ModeButton({ theme, active, onClick, icon, label, title }: { theme: ReturnType<typeof chartTheme>; active: boolean; onClick: () => void; icon: React.ReactNode; label: string; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-8 items-center gap-1.5 px-2.5 text-xs font-semibold"
      style={{ background: active ? theme.accentSoft : "transparent", color: active ? theme.accent : theme.muted }}
    >
      {icon}
      {label}
    </button>
  )
}
