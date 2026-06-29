/** Visual tokens aligned with the signed-in dashboard shell (sidebar + main panel). */
export function getDashboardStatusStyles(isDark: boolean) {
  return {
    pageBg: isDark ? "bg-[#151b2d]" : "bg-[#f0f4f8]",
    pageText: isDark ? "text-[#dce1fb]" : "text-slate-900",
    panel: isDark
      ? "bg-[#101417] border-[#3d4a3d]/40 shadow-[0_8px_40px_0_rgba(75,226,119,0.04)]"
      : "bg-white border-slate-100 shadow-lg",
    card: isDark
      ? "bg-[#151b2d] border-[#3d4a3d]/40 shadow-[0_8px_40px_0_rgba(75,226,119,0.04)]"
      : "bg-white border-slate-100 shadow-lg",
    title: isDark ? "text-[#dce1fb]" : "text-slate-900",
    heading: isDark ? "text-[#dce1fb]" : "text-slate-900",
    body: isDark ? "text-[#bccbb9]" : "text-slate-600",
    bodySub: isDark ? "text-[#bccbb9]/70" : "text-slate-500",
    badge: isDark
      ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#bccbb9]"
      : "border-slate-200 bg-slate-50 text-slate-500",
    accent: isDark ? "text-[#4be277]" : "text-blue-600",
    accentMuted: isDark ? "text-[#bccbb9]" : "text-slate-500",
    linkCard: isDark
      ? "border-[#3d4a3d]/40 bg-[#151b2d] hover:bg-[#191f31]"
      : "border-slate-100 bg-slate-50 hover:bg-white hover:shadow-sm",
    btnPrimary: isDark
      ? "bg-[#4be277] text-[#0c1324] hover:bg-[#3dd86a] shadow-[0_4px_16px_rgba(75,226,119,0.2)]"
      : "bg-blue-600 text-white hover:bg-blue-700 shadow-[0_4px_16px_rgba(37,99,235,0.2)]",
    btnSecondary: isDark
      ? "bg-[#191f31] text-[#dce1fb] border border-[#3d4a3d]/40 hover:bg-[#2e3447]"
      : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200",
    iconPanel: isDark
      ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#4be277]"
      : "border-slate-100 bg-slate-50 text-blue-600",
    iconPanelError: isDark
      ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
      : "border-amber-200 bg-amber-50 text-amber-600",
    iconPanelLoading: isDark ? "text-[#4be277]" : "text-blue-600",
    diagnosticBorder: isDark ? "border-[#3d4a3d]/40" : "border-slate-200",
    diagnosticBox: isDark
      ? "rounded-xl border bg-[#151b2d] p-3 text-xs text-red-400"
      : "rounded-xl border bg-slate-50 p-3 text-xs text-red-600",
    glowPrimary: isDark ? "bg-[#4be277]/8" : "bg-blue-500/5",
    glowSecondary: isDark ? "bg-[#22c55e]/5" : "bg-indigo-400/4",
  }
}


export type DashboardStatusStyles = ReturnType<typeof getDashboardStatusStyles>
