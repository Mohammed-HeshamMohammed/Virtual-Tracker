"use client"

import { useMemo } from "react"
import { useTheme } from "@/shared/providers/app"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"

/** Shared layout for two-column form rows in the client modal */
export const FORM_GRID = "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4 items-start"
export const FORM_STACK = "flex flex-col gap-4"
export const FORM_FIELD = "flex min-w-0 flex-col gap-1.5"

/** Scrollable region with scrollbars hidden (wheel/touch scrolling still works). */
export const FORM_SCROLL_HIDDEN =
  "overflow-y-auto scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"

export function useClientFormTheme() {
  const { isDark } = useTheme()
  const page = isDark ? dark : light

  return useMemo(
    () => ({
      page,
      isDark,
      modal: {
        overlay: page.modalOverlay,
        panel: `${page.modalBg} border ${page.modalBorder}`,
        headerBorder: isDark ? "border-[#3d4a3d]/40" : "border-slate-200",
        footerBg: isDark ? "bg-[#151b2d]/80" : "bg-slate-50/80",
        title: page.modalHeader,
        subtitle: page.modalText,
      },
      tab: {
        active: isDark ? "border-[#4be277] text-[#4be277]" : "border-blue-500 text-blue-600",
        inactive: isDark
          ? "border-transparent text-[#bccbb9] hover:text-[#dce1fb]"
          : "border-transparent text-slate-500 hover:text-slate-800",
      },
      accent: {
        primary: page.btnPrimary,
        primarySolid: isDark ? "bg-[#4be277] text-[#0c1324] hover:bg-[#6bf397]" : "bg-blue-500 text-white hover:bg-blue-600",
        check: isDark ? "text-[#4be277]" : "text-blue-500",
        selectedBg: isDark ? "bg-[#4be277]/15" : "bg-blue-50",
        link: isDark ? "text-[#4be277] hover:text-[#6bf397]" : "text-blue-600 hover:text-blue-700",
        dot: isDark ? "bg-[#4be277]" : "bg-blue-500",
      },
      control: isDark
        ? "h-10 w-full rounded-lg border border-[#3d4a3d]/40 bg-[#151b2d] px-3 text-sm text-[#dce1fb] placeholder:text-[#bccbb9]/50 transition-colors focus:border-[#4be277] focus:outline-none focus:ring-2 focus:ring-[#4be277]/20"
        : "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400 transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
      controlOpen: isDark ? "border-[#4be277] ring-1 ring-[#4be277]/30" : "border-blue-400 ring-1 ring-blue-400",
      label: isDark
        ? "text-[10px] font-bold uppercase tracking-wider text-[#bccbb9]"
        : "text-[10px] font-bold uppercase tracking-wider text-slate-500",
      preview: isDark
        ? "h-10 w-full rounded-lg border border-[#3d4a3d]/40 bg-[#191f31] px-3 text-sm text-[#dce1fb]"
        : "h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700",
      hint: isDark ? "text-xs text-[#bccbb9]" : "text-xs text-slate-500",
      toggle: {
        on: isDark ? "bg-[#4be277]" : "bg-blue-500",
        off: isDark ? "bg-[#2e3447]" : "bg-slate-200",
      },
      card: isDark
        ? "rounded-xl border border-[#3d4a3d]/40 bg-[#191f31] p-3"
        : "rounded-xl border border-slate-200 bg-slate-50/80 p-3",
      textarea: isDark
        ? "min-h-[4.5rem] w-full resize-none rounded-lg border border-[#3d4a3d]/40 bg-[#151b2d] px-3 py-2 text-sm text-[#dce1fb] placeholder:text-[#bccbb9]/50 transition-colors focus:border-[#4be277] focus:outline-none focus:ring-2 focus:ring-[#4be277]/20"
        : "min-h-[4.5rem] w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
      segment: {
        active: isDark
          ? "border-[#4be277] bg-[#4be277]/10 text-[#4be277]"
          : "border-blue-500 bg-blue-50 text-blue-600",
        inactive: isDark
          ? "border-[#3d4a3d]/40 text-[#bccbb9] hover:border-[#4be277]/40"
          : "border-slate-200 text-slate-500 hover:border-slate-300",
      },
      footer: {
        border: isDark ? "border-[#3d4a3d]/40" : "border-slate-200",
        cancel: isDark
          ? "border border-[#3d4a3d]/40 bg-[#151b2d] text-[#dce1fb] hover:bg-[#2e3447]"
          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
        dotInactive: isDark ? "bg-[#2e3447]" : "bg-slate-200",
      },
      bodyText: isDark ? "text-sm text-[#dce1fb]" : "text-sm text-slate-700",
      mutedText: isDark ? "text-sm text-[#bccbb9]" : "text-sm text-slate-600",
    }),
    [isDark, page],
  )
}
