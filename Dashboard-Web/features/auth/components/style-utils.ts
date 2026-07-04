/** Auth page styles — dark (#0c1324 / mint) and light (#f6fafe / purple) palettes. */
export function getAuthStyles(isDark: boolean) {
  return {
    // ─── Shell & Page ─────────────────────────────────────────────────────────
    shell: isDark
      ? "bg-[#0c1324]"
      : "bg-[#f6fafe]",

    brandTitle: isDark ? "text-[#dce1fb]" : "text-[#171c1f]",
    brandLink: isDark
      ? "text-[#bccbb9] hover:text-[#4be277]"
      : "text-[#171c1f]/55 hover:text-[#6b38d4]",
    globeBtn: isDark
      ? "text-[#bccbb9] hover:bg-[#4be277]/10 hover:text-[#4be277]"
      : "text-slate-500 hover:bg-[#6b38d4]/10 hover:text-[#6b38d4]",
    wipPopover: isDark
      ? "bg-[#191f31]/90 backdrop-blur-xl text-[#dce1fb] shadow-[0_8px_32px_rgba(75,226,119,0.08)] border border-[#3d4a3d]/20"
      : "bg-white/90 backdrop-blur-xl text-[#171c1f] shadow-[0_8px_32px_rgba(107,56,212,0.08)] border border-[#cbc3d7]/30",
    // Gradient CTA button
    requestAccess: isDark
      ? "bg-gradient-to-r from-[#4be277] to-[#22c55e] text-[#0c1324] font-bold shadow-[0_4px_20px_rgba(75,226,119,0.35)] hover:shadow-[0_6px_28px_rgba(75,226,119,0.45)] hover:-translate-y-0.5 transition-all duration-200"
      : "bg-gradient-to-r from-[#6b38d4] to-[#5a2db8] text-white font-bold shadow-[0_4px_20px_rgba(107,56,212,0.30)] hover:shadow-[0_6px_28px_rgba(107,56,212,0.40)] hover:-translate-y-0.5 transition-all duration-200",

    // ─── Main Card ────────────────────────────────────────────────────────────
    card: isDark
      ? "bg-[#191f31]/80 backdrop-blur-xl border border-[#3d4a3d]/20 shadow-[0_20px_60px_rgba(75,226,119,0.06),0_8px_32px_rgba(0,0,0,0.4)]"
      : "bg-white/85 backdrop-blur-xl border border-[#cbc3d7]/20 shadow-[0_20px_60px_rgba(107,56,212,0.07),0_8px_32px_rgba(0,0,0,0.06)]",

    // ─── Typography ───────────────────────────────────────────────────────────
    heading: isDark ? "text-[#dce1fb]" : "text-[#171c1f]",
    body: isDark ? "text-[#bccbb9]" : "text-[#171c1f]/70",
    bodyMuted: isDark ? "text-[#bccbb9]/85" : "text-slate-600",
    bodySub: isDark ? "text-[#bccbb9]/70" : "text-slate-500",
    bodyStrong: isDark ? "text-[#dce1fb]" : "text-[#171c1f]",

    // ─── Input Fields ─────────────────────────────────────────────────────────
    // Bottom-accent focus on inputs
    input: isDark
      ? "bg-[#151b2d] text-[#dce1fb] placeholder:text-[#bccbb9]/40 border-0 border-b-2 border-[#3d4a3d]/30 rounded-lg focus:border-b-[#4be277]/60 focus:ring-0 focus:outline-none focus:shadow-[0_2px_12px_rgba(75,226,119,0.12)] transition-all duration-200"
      : "bg-[#f0f4f8] text-[#171c1f] placeholder:text-slate-400 border-0 border-b-2 border-[#cbc3d7]/40 rounded-lg focus:border-b-[#6b38d4]/50 focus:ring-0 focus:outline-none focus:shadow-[0_2px_12px_rgba(107,56,212,0.10)] transition-all duration-200",

    // ─── Buttons ──────────────────────────────────────────────────────────────
    // Primary — gradient CTA with lift micro-animation
    btnPrimary: isDark
      ? "bg-gradient-to-r from-[#4be277] to-[#22c55e] font-bold text-[#0c1324] shadow-[0_4px_20px_rgba(75,226,119,0.25)] hover:shadow-[0_6px_28px_rgba(75,226,119,0.38)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0"
      : "bg-gradient-to-r from-[#6b38d4] to-[#5a2db8] font-bold text-white shadow-[0_4px_20px_rgba(107,56,212,0.25)] hover:shadow-[0_6px_28px_rgba(107,56,212,0.38)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0",
    // Secondary / Outline
    btnOutline: isDark
      ? "bg-[#2e3447] font-bold text-[#dce1fb] hover:bg-[#3a4158] transition-colors duration-200"
      : "bg-[#f0f4f8] font-bold text-[#171c1f] hover:bg-[#e4e9ed] transition-colors duration-200",

    // ─── Social Buttons ───────────────────────────────────────────────────────
    social: isDark
      ? "bg-[#151b2d] text-[#dce1fb] hover:bg-[#1e2640] border border-[#3d4a3d]/20 hover:border-[#4be277]/20 transition-all duration-200"
      : "bg-white text-[#171c1f] hover:bg-[#f0f4f8] border border-[#cbc3d7]/30 hover:border-[#6b38d4]/25 transition-all duration-200",

    // ─── Option Panel Cards (Trouble menu) ────────────────────────────────────
    panel: isDark
      ? "bg-[#151b2d] text-[#dce1fb] hover:bg-[#1e2640] border border-[#3d4a3d]/15 hover:border-[#4be277]/20 hover:shadow-[0_0_20px_rgba(75,226,119,0.06)] transition-all duration-200"
      : "bg-[#f0f4f8] text-[#171c1f] hover:bg-[#e8ecf2] border border-[#cbc3d7]/20 hover:border-[#6b38d4]/20 hover:shadow-[0_0_20px_rgba(107,56,212,0.06)] transition-all duration-200",
    panelSub: isDark ? "text-[#bccbb9]/70" : "text-slate-500",

    // ─── Text Links ───────────────────────────────────────────────────────────
    link: isDark
      ? "text-[#bccbb9] hover:text-[#4be277] transition-colors duration-150"
      : "text-slate-500 hover:text-[#6b38d4] transition-colors duration-150",
    linkBold: isDark
      ? "font-bold text-[#4be277] hover:text-[#6ef090] transition-colors duration-150"
      : "font-bold text-[#6b38d4] hover:text-[#5a2db8] transition-colors duration-150",

    // ─── Divider ──────────────────────────────────────────────────────────────
    dividerBar: isDark ? "bg-[#3d4a3d]/30" : "bg-[#cbc3d7]/35",
    dividerLabel: isDark ? "text-[#bccbb9]/60" : "text-slate-400",

    // ─── Misc ─────────────────────────────────────────────────────────────────
    hint: isDark ? "text-[#bccbb9]/65" : "text-slate-500",
    eyeBtn: isDark ? "text-[#bccbb9] hover:text-[#4be277] transition-colors" : "text-slate-400 hover:text-[#6b38d4] transition-colors",
    dot: isDark ? "text-[#3d4a3d]/50" : "text-slate-300",
    iconMuted: isDark ? "text-[#bccbb9]/40" : "text-slate-300",
    meter: isDark ? "bg-[#151b2d] border-[#3d4a3d]/20" : "bg-[#f0f4f8] border-[#cbc3d7]/25",
  }
}

export type AuthStyles = ReturnType<typeof getAuthStyles>
