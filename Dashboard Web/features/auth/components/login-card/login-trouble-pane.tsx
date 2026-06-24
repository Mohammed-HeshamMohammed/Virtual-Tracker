"use client"

import React from "react"
import { cn } from "@/shared/utils/utils"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import { AuthMotionPane, AuthStaggerGroup, AuthStaggerItem } from "@/features/auth/components/auth-motion"

interface LoginTroublePaneProps {
  isDark: boolean
  isActive: boolean
  onSelectOption: (option: "forgot-email" | "forgot-password" | "forgot-work-mail") => void
  onBackToSignIn: () => void
}

const options: {
  key: "forgot-email" | "forgot-password" | "forgot-work-mail"
  label: string
  sub: string
}[] = [
  {
    key: "forgot-email",
    label: "I forgot my email",
    sub: "We'll ask for your phone number",
  },
  {
    key: "forgot-password",
    label: "I forgot my password",
    sub: "We'll send a reset link to your email",
  },
  {
    key: "forgot-work-mail",
    label: "I forgot my work email",
    sub: "We'll ask for your phone number",
  },
]

export function LoginTroublePane({
  isDark,
  isActive,
  onSelectOption,
  onBackToSignIn,
}: LoginTroublePaneProps) {
  const u = getAuthStyles(isDark)

  return (
    <AuthMotionPane isActive={isActive}>
      <AuthStaggerGroup groupKey="trouble">
        <AuthStaggerItem>
          <p className={cn("text-center text-xl font-black tracking-tight", u.heading)}>
            Having trouble?
          </p>
        </AuthStaggerItem>
        <AuthStaggerItem>
          <p className={cn("mt-2 text-center text-sm leading-relaxed", u.bodySub)}>
            Choose an option below. Password reset sends a secure link to your email; phone-based recovery may require an
            administrator.
          </p>
        </AuthStaggerItem>

        <div className="mt-6 flex flex-col gap-2.5">
          {options.map(({ key, label, sub }) => (
            <AuthStaggerItem key={key}>
              <button
                type="button"
                onClick={() => onSelectOption(key)}
                className={cn(
                  "flex w-full flex-col items-start rounded-xl px-4 py-3.5 text-left transition-all duration-200",
                  u.panel,
                )}
              >
                <span className="text-sm font-semibold">{label}</span>
                <span className={cn("mt-0.5 text-xs font-normal", u.panelSub)}>{sub}</span>
              </button>
            </AuthStaggerItem>
          ))}
        </div>

        <AuthStaggerItem className="mt-6">
          <button type="button" className={cn("w-full text-center text-sm", u.link)} onClick={onBackToSignIn}>
            Back to sign in
          </button>
        </AuthStaggerItem>
      </AuthStaggerGroup>
    </AuthMotionPane>
  )
}
