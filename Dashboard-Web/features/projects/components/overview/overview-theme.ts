/**
 * The project overview's colours, light and dark, in one place.
 *
 * The panels were written for light mode and only their card background
 * followed the theme, so in dark mode slate-800/700 text sat on a #0c1324 card
 * at 1.3-2.4:1 - the stat numbers, project names and titles all but vanished -
 * while light badges, tracks and dividers glared. Every text colour here was
 * measured against the surface it sits on and meets WCAG AA (4.5:1); data
 * bars meet 3:1. Light and dark are defined side by side so they can't drift.
 */

export type Tone = "success" | "warning" | "danger" | "info" | "neutral"
export type Priority = "low" | "medium" | "high" | "urgent"
export type Segment = "done" | "in_progress" | "in_review" | "blocked" | "todo"

export type OverviewPalette = {
  card: string
  border: string
  divide: string
  tableHead: string
  rowHover: string
  hoverCard: string
  focusRing: string
  /** Headings and figures. */
  title: string
  /** Names and body text. */
  text: string
  /** Labels and supporting values. */
  secondary: string
  /** Hints, column headers, meta text. */
  muted: string
  icon: string
  link: string
  countPill: string
  inactiveChip: string
  track: string
  emptyIconWrap: string
  emptyIcon: string
  danger: string
  success: string
  modal: string
  closeHover: string
  primaryButton: string
  bone: string
  badge: Record<Tone, string>
  toneText: Record<Tone, string>
  priority: Record<Priority, string>
  segment: Record<Segment, string>
  bar: { ok: string; warn: string; over: string }
}

const DARK: OverviewPalette = {
  card: "bg-[#0c1324] border-[#3d4a3d]/40",
  border: "border-[#3d4a3d]/40",
  divide: "divide-[#3d4a3d]/40",
  tableHead: "bg-[#191f31]/80",
  rowHover: "hover:bg-white/[0.03]",
  hoverCard: "hover:bg-white/[0.04] hover:border-[#3d4a3d]/40",
  focusRing: "focus-visible:ring-2 focus-visible:ring-[#4be277]/50",
  title: "text-[#dce1fb]", // 14.3:1 on the card
  text: "text-[#dce1fb]",
  secondary: "text-[#aeb7cf]", // 9.2:1
  muted: "text-[#8f98b8]", // 6.5:1 (5.7:1 on the table head)
  icon: "text-[#8f98b8]",
  link: "text-[#4be277]", // 11:1
  countPill: "bg-white/10 text-[#aeb7cf]",
  inactiveChip: "bg-white/[0.06] text-[#aeb7cf] hover:bg-white/10",
  track: "bg-white/10",
  emptyIconWrap: "bg-[#191f31]",
  emptyIcon: "text-[#8f98b8]",
  danger: "text-red-400",
  success: "text-emerald-300",
  modal: "bg-[#0c1324] border border-[#3d4a3d]/40",
  closeHover: "hover:bg-white/5",
  primaryButton: "bg-[#4be277] text-[#0c1324] hover:bg-[#4be277]/90",
  bone: "bg-[#2e3447]",
  // Tinted fills with light text - 8.5-10:1.
  badge: {
    success: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/25",
    warning: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/25",
    danger: "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-400/25",
    info: "bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-400/25",
    neutral: "bg-white/[0.08] text-slate-300 ring-1 ring-inset ring-white/10",
  },
  toneText: {
    success: "text-emerald-400",
    warning: "text-amber-400",
    danger: "text-red-400",
    info: "text-blue-400",
    neutral: "text-slate-400",
  },
  priority: {
    low: "text-slate-400",
    medium: "text-blue-400",
    high: "text-amber-400",
    urgent: "text-red-400",
  },
  segment: {
    done: "bg-emerald-400",
    in_progress: "bg-blue-400",
    in_review: "bg-amber-400",
    blocked: "bg-red-400",
    todo: "bg-slate-500",
  },
  bar: { ok: "bg-emerald-500", warn: "bg-amber-500", over: "bg-red-500" },
}

const LIGHT: OverviewPalette = {
  card: "bg-white border-slate-100",
  border: "border-slate-100",
  divide: "divide-slate-100",
  tableHead: "bg-slate-50",
  rowHover: "hover:bg-slate-50",
  hoverCard: "hover:bg-slate-50 hover:border-slate-100",
  focusRing: "focus-visible:ring-2 focus-visible:ring-green-600/40",
  title: "text-slate-800",
  text: "text-slate-700",
  secondary: "text-slate-600", // 7.6:1
  muted: "text-slate-500", // 4.8:1 (slate-400 was 2.6:1)
  icon: "text-slate-500",
  link: "text-green-700", // 5:1
  countPill: "bg-slate-100 text-slate-600",
  inactiveChip: "bg-slate-100 text-slate-600 hover:bg-slate-200",
  track: "bg-slate-100",
  emptyIconWrap: "bg-slate-100",
  emptyIcon: "text-slate-400",
  danger: "text-red-600",
  success: "text-emerald-700",
  modal: "bg-white border border-slate-200",
  closeHover: "hover:bg-slate-100",
  primaryButton: "bg-green-600 text-white hover:bg-green-700",
  bone: "bg-slate-200",
  // 700 on 50: 4.8-6.2:1 (the 600s were 3.1-3.6:1).
  badge: {
    success: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15",
    warning: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
    danger: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/15",
    info: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/15",
    neutral: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/10",
  },
  toneText: {
    success: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-red-600",
    info: "text-blue-600",
    neutral: "text-slate-500",
  },
  priority: {
    low: "text-slate-500",
    medium: "text-blue-600",
    high: "text-amber-700",
    urgent: "text-red-600",
  },
  // The 400s were under 3:1 on white.
  segment: {
    done: "bg-emerald-600",
    in_progress: "bg-blue-600",
    in_review: "bg-amber-600",
    blocked: "bg-red-600",
    todo: "bg-slate-400",
  },
  bar: { ok: "bg-emerald-600", warn: "bg-amber-600", over: "bg-red-500" },
}

export function overviewTheme(isDark: boolean): OverviewPalette {
  return isDark ? DARK : LIGHT
}

/** Green under 85% of budget, amber from 85%, red at or over it. */
export function budgetBarClass(pct: number, palette: OverviewPalette): string {
  return pct >= 100 ? palette.bar.over : pct >= 85 ? palette.bar.warn : palette.bar.ok
}
