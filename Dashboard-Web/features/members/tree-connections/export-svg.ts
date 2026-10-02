// A standalone picture of the chart as it is on screen right now: the same positions, the same
// dragged cards, the same collapsed teams. SVG (not a screenshot of the DOM) so it stays sharp at
// any size and needs nothing from the page. Photos are left out and initials used instead, which
// keeps the file self-contained and lets it be turned into a PNG without tainting the canvas.
import type { GroupFrame, Point } from "./layout.ts"
import { buildLinks } from "./link-set.ts"
import type { LinkType } from "./links.ts"
import type { Orientation } from "./layout.ts"
import type { TreeModel } from "./model.ts"
import { roleColor } from "./roles.ts"

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

export type SvgExportInput = {
  model: TreeModel
  positions: ReadonlyMap<string, Point>
  groups: GroupFrame[]
  nodeWidth: number
  nodeHeight: number
  orientation: Orientation
  linkType: LinkType
  stepPercent: number
  isDark: boolean
  title: string
  movedIds?: ReadonlySet<string>
  /** "avatar" draws each member as a picture-sized circle instead of a card. */
  variant?: "card" | "avatar"
}

export function buildTreeSvg(input: SvgExportInput): string {
  const { model, positions, groups, nodeWidth: w, nodeHeight: h } = input
  const palette = input.isDark
    ? { bg: "#0f1424", card: "#191f31", border: "#3d4a3d", text: "#dce1fb", muted: "#bccbb9", link: "#6b8afd", frame: "#1c2338" }
    : { bg: "#ffffff", card: "#f8fafc", border: "#cbd5e1", text: "#0f172a", muted: "#64748b", link: "#94a3b8", frame: "#f1f5f9" }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x - w / 2)
    maxX = Math.max(maxX, p.x + w / 2)
    minY = Math.min(minY, p.y - h / 2)
    maxY = Math.max(maxY, p.y + h / 2)
  }
  for (const g of groups) {
    minX = Math.min(minX, g.x)
    minY = Math.min(minY, g.y)
    maxX = Math.max(maxX, g.x + g.width)
    maxY = Math.max(maxY, g.y + g.height)
  }
  if (!Number.isFinite(minX)) return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`
  const pad = 40
  const width = Math.ceil(maxX - minX + pad * 2)
  const height = Math.ceil(maxY - minY + pad * 2)

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX - pad} ${minY - pad} ${width} ${height}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`)
  parts.push(`<title>${escapeXml(input.title)}</title>`)
  parts.push(`<rect x="${minX - pad}" y="${minY - pad}" width="${width}" height="${height}" fill="${palette.bg}"/>`)

  for (const g of groups) {
    parts.push(`<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="12" fill="${palette.frame}" stroke="${palette.border}" stroke-dasharray="4 4"/>`)
    const heading = g.label ? `${g.label} · ${g.memberIds.length}` : `${g.memberIds.length} direct reports`
    parts.push(`<text x="${g.x + 12}" y="${g.y + 16}" font-size="11" font-weight="600" fill="${palette.muted}">${escapeXml(heading)}</text>`)
  }

  for (const link of buildLinks({
    model,
    positions,
    groups,
    movedIds: input.movedIds,
    nodeWidth: w,
    nodeHeight: h,
    orientation: input.orientation,
    type: input.linkType,
    stepPercent: input.stepPercent,
  })) {
    parts.push(`<path d="${link.d}" fill="none" stroke="${palette.link}" stroke-width="1.5"/>`)
  }
  for (const [id, p] of positions) {
    const node = model.nodeById.get(id)
    if (!node) continue
    const x = p.x - w / 2
    const y = p.y - h / 2
    const colour = roleColor(node.role)
    if (input.variant === "avatar") {
      const r = Math.min(w, h) * 0.36
      parts.push(`<g>`)
      parts.push(`<title>${escapeXml(node.name)} - ${escapeXml(node.role)}</title>`)
      parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r + 3}" fill="none" stroke="${colour}" stroke-width="3"/>`)
      parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${colour}"/>`)
      parts.push(`<text x="${p.x}" y="${p.y + 4}" font-size="${Math.round(r * 0.6)}" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(initialsOf(node.name))}</text>`)
      parts.push(`</g>`)
      continue
    }
    parts.push(`<g>`)
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${palette.card}" stroke="${palette.border}"/>`)
    parts.push(`<rect x="${x}" y="${y + 10}" width="4" height="${h - 20}" rx="2" fill="${colour}"/>`)
    parts.push(`<circle cx="${x + 30}" cy="${p.y}" r="17" fill="${colour}"/>`)
    parts.push(`<text x="${x + 30}" y="${p.y + 4}" font-size="11" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(initialsOf(node.name))}</text>`)
    parts.push(`<text x="${x + 54}" y="${p.y - 3}" font-size="12" font-weight="600" fill="${palette.text}">${escapeXml(truncate(node.name, 20))}</text>`)
    parts.push(`<text x="${x + 54}" y="${p.y + 13}" font-size="10" fill="${palette.muted}">${escapeXml(truncate(node.role, 24))}</text>`)
    parts.push(`</g>`)
  }
  parts.push(`</svg>`)
  return parts.join("\n")
}
