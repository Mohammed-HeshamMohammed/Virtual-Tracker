"use client"

import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import { AuthThemeToggle } from "@/features/auth/components/auth-theme-toggle"

function AuthAmbientBackground({ isDark }: { isDark: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div
        className={cn(
          "absolute -left-32 -top-32 h-96 w-96 rounded-full blur-[100px]",
          isDark ? "bg-[#4be277]/6" : "bg-[#6b38d4]/5",
        )}
      />
      <div
        className={cn(
          "absolute -bottom-32 -right-32 h-96 w-96 rounded-full blur-[100px]",
          isDark ? "bg-[#22c55e]/5" : "bg-[#5a2db8]/4",
        )}
      />
    </div>
  )
}

export function AuthViewportShell({
  children,
  className,
  header,
  mainClassName,
}: {
  children: React.ReactNode
  className?: string
  header?: React.ReactNode
  mainClassName?: string
}) {
  const { isDark } = useTheme()
  const styles = getAuthStyles(isDark)

  return (
    <div
      className={cn(
        "fixed inset-0 z-0 flex min-h-dvh w-full flex-col overflow-hidden transition-colors duration-300",
        styles.shell,
        className,
      )}
    >
      <AuthAmbientBackground isDark={isDark} />
      {header}
      <main
        className={cn(
          "relative z-10 flex min-h-0 w-full flex-1 items-center justify-center overflow-y-auto px-4 py-4 sm:px-6",
          mainClassName,
        )}
      >
        {children}
      </main>
    </div>
  )
}

export function AuthGateShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <AuthViewportShell
      className={className}
      header={
        <header className="relative z-10 flex shrink-0 items-center justify-end px-4 pt-4 sm:px-6">
          <AuthThemeToggle />
        </header>
      }
      mainClassName="pb-8 pt-2"
    >
      {children}
    </AuthViewportShell>
  )
}
