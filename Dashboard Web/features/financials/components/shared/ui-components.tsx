import { cn } from "@/shared/utils/utils"

export function Avatar({ av, color, size = "sm" }: { av: string; color: string; size?: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-bold text-white shrink-0",
        size === "sm" ? "w-7 h-7 text-[10px]" : "w-8 h-8 text-xs"
      )}
      style={{ backgroundColor: color }}
    >
      {av}
    </div>
  )
}

export function StatusBadge({ status, config }: { status: string; config?: Record<string, { bg: string; text: string; label?: string }> }) {
  if (config && config[status]) {
    const c = config[status]
    return <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold", c.bg, c.text)}>{c.label || status}</span>
  }
  // Default fallback styles
  const lowerStatus = status.toLowerCase()
  const defaultBg = lowerStatus === "paid" || lowerStatus === "closed" ? "bg-emerald-50 text-emerald-700" :
                    lowerStatus === "pending" || lowerStatus === "uninvoiced" ? "bg-amber-50 text-amber-700" :
                    lowerStatus === "invoiced" || lowerStatus === "processing" ? "bg-blue-50 text-blue-600" :
                    lowerStatus === "failed" ? "bg-red-50 text-red-600" :
                    "bg-slate-100 text-slate-600"

  return <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold", defaultBg)}>{status}</span>
}

export function SmallToggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
        checked ? "bg-blue-500" : "bg-slate-200"
      )} aria-label="Interactive control"
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  )
}

export function ReceiptIllustration({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 120 132" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="28" y="18" width="72" height="90" rx="4" fill="#3f51b5" opacity="0.8" transform="rotate(-8 28 18)" />
      <rect x="22" y="14" width="72" height="95" rx="4" fill="#f5f5f5" stroke="#e0e0e0" strokeWidth="1" />
      <circle cx="30" cy="26" r="3" fill="#bdbdbd" />
      <circle cx="30" cy="80" r="3" fill="#bdbdbd" />
      <rect x="34" y="38" width="42" height="6" rx="2" fill="#9e9e9e" />
      <rect x="34" y="52" width="50" height="4" rx="1.5" fill="#bdbdbd" />
      <rect x="34" y="60" width="44" height="4" rx="1.5" fill="#bdbdbd" />
      <rect x="34" y="68" width="36" height="3" rx="1.5" fill="#e0e0e0" />
      <rect x="34" y="74" width="40" height="3" rx="1.5" fill="#e0e0e0" />
      <text x="34" y="104" fontSize="22" fontWeight="700" fill="#4caf50">$</text>
      <path d="M72 95 L86 95 L86 109 Z" fill="#e0e0e0" />
    </svg>
  )
}

export function PiggyEmpty({ isDark }: { isDark: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <svg width="120" height="100" viewBox="0 0 120 100" fill="none" className="mx-auto" aria-hidden>
        <ellipse cx="60" cy="88" rx="40" ry="6" className={isDark ? "fill-white/5" : "fill-slate-100"} />
        <path
          d="M40 52c0-14 9-26 22-28 4-8 14-12 24-8 10 4 16 14 14 24 10 4 16 14 14 26-2 12-12 22-24 24H48c-12-2-20-12-18-24 1-8 6-14 10-14z"
          className={isDark ? "stroke-sky-400/50 fill-sky-500/10" : "stroke-sky-300 fill-sky-50"}
          strokeWidth="2"
        />
        <circle cx="48" cy="48" r="3" className={isDark ? "fill-sky-300" : "fill-sky-400"} />
        <path
          d="M72 44v8M68 48h8"
          className={isDark ? "stroke-sky-300" : "stroke-sky-500"}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect x="54" y="58" width="12" height="8" rx="2" className={isDark ? "fill-sky-400/30" : "fill-sky-200"} />
      </svg>
      <h3 className={cn("mt-4 text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>No adjustments</h3>
      <p className={cn("mt-2 max-w-sm text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        Create adjustments to include additions or deductions with payroll.
      </p>
    </div>
  )
}
