"use client"

import { Check, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  analyzePassword,
  buildPasswordChecklist,
  isRequirementMet,
  strengthToLabel,
  usePasswordBackendCheck,
  usePasswordPolicy,
} from "@/features/auth/services/password-policy"
import { AuthPresenceFade } from "@/features/auth/components/auth-motion"
import type { AuthStyles } from "@/features/auth/components/style-utils"

type PasswordStrengthPanelProps = {
  password: string
  confirmPassword?: string
  visible: boolean
  isDark: boolean
  styles: AuthStyles
  compact?: boolean
  /** `side` — rendered in the auth form's right panel (no duplicate card chrome). */
  variant?: "inline" | "side"
}

const STRENGTH_COLORS: Record<string, { bar: string; text: string }> = {
  weak: { bar: "bg-red-500", text: "text-red-500" },
  fair: { bar: "bg-orange-500", text: "text-orange-500" },
  good: { bar: "bg-amber-500", text: "text-amber-500" },
  strong: { bar: "bg-emerald-500", text: "text-emerald-500" },
  "very-strong": { bar: "bg-[#4be277]", text: "text-[#4be277]" },
}

function RequirementRow({
  met,
  pending,
  label,
  isDark,
}: {
  met: boolean
  pending: boolean
  label: string
  isDark: boolean
}) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={cn(
          "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
          met
            ? isDark
              ? "bg-[#4be277]/15 text-[#4be277]"
              : "bg-emerald-100 text-emerald-600"
            : pending
              ? isDark
                ? "bg-[#2e3447] text-[#bccbb9]/40"
                : "bg-slate-100 text-slate-300"
              : isDark
                ? "bg-[#2e3447] text-[#bccbb9]/50"
                : "bg-slate-100 text-slate-400",
        )}
        aria-hidden="true"
      >
        {met ? <Check className="h-2.5 w-2.5" /> : pending ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : <X className="h-2.5 w-2.5" />}
      </span>
      <span className={cn(met ? (isDark ? "text-[#dce1fb]" : "text-slate-700") : isDark ? "text-[#bccbb9]/70" : "text-slate-500")}>
        {label}
      </span>
    </li>
  )
}

export function PasswordStrengthPanel({
  password,
  confirmPassword = "",
  visible,
  isDark,
  styles,
  compact = false,
  variant = "inline",
}: PasswordStrengthPanelProps) {
  const { policy: policyResponse } = usePasswordPolicy()
  const rules = policyResponse.passwordPolicy
  const backendCheck = usePasswordBackendCheck(password, rules)
  const analysis = analyzePassword(password, rules, {
    confirmPassword,
    backendSecurityValid: backendCheck.valid,
    backendSecurityError: backendCheck.error,
    backendRequirements: backendCheck.requirements,
  })
  const checklist = buildPasswordChecklist(rules)
  const strengthLabel = strengthToLabel(analysis.strength)
  const strengthColors = STRENGTH_COLORS[analysis.strength] ?? STRENGTH_COLORS.weak
  const strengthIndex = ["weak", "fair", "good", "strong", "very-strong"].indexOf(analysis.strength)

  const isSide = variant === "side"

  return (
    <AuthPresenceFade show={visible}>
      <div
        aria-live="polite"
        className={cn(
          isSide ? "w-full" : "relative w-full rounded-xl border",
          !isSide && (compact ? "p-3" : "p-4 sm:p-5"),
          !isSide && styles.card,
        )}
      >
        <h3 className={cn("mb-2 text-sm font-bold", styles.heading)}>Password strength</h3>

        <div className="mb-1 flex items-center justify-between gap-2">
          <span className={cn("text-xs font-medium", styles.bodySub)}>Strength</span>
          <span className={cn("text-xs font-bold", strengthColors.text)}>{strengthLabel}</span>
        </div>

        <div className={cn("mb-3 h-1.5 overflow-hidden rounded-full border", styles.meter)}>
          <div
            className={cn("h-full rounded-full transition-all duration-300", strengthColors.bar)}
            style={{ width: `${Math.max(8, ((strengthIndex + 1) / 5) * 100)}%` }}
          />
        </div>

        <ul className="space-y-1.5">
          {checklist.map((item) => {
            if (item.key === "passwordsMatch") {
              return null
            }
            const value = analysis.requirements[item.key]
            const pending =
              password.length > 0 &&
              backendCheck.checking &&
              ((item.key === "notBlocked" && value === null) ||
                (item.key === "notSimplePattern" && value === null))
            const met = isRequirementMet(item.key, value)
            return (
              <RequirementRow
                key={item.key}
                met={met}
                pending={pending}
                label={item.label}
                isDark={isDark}
              />
            )
          })}
        </ul>
      </div>
    </AuthPresenceFade>
  )
}
