"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import PageShell from "@/components/PageShell"
import { useCurrentUser } from "@/lib/auth/use-current-user"
import { signOut } from "@/lib/auth/sign-out"

const NAV_ITEMS = [
  { href: "/account/reports", label: "My Activity" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/subscription", label: "Subscription" },
  { href: "/account/settings", label: "Settings" },
]

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading } = useCurrentUser()

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/sign-in")
    }
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <PageShell>
        <main className="bg-slate-50/50 min-h-[70vh] flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
        </main>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 min-h-[85vh] pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 pt-28 grid gap-8 lg:grid-cols-[220px_1fr]">
          <aside className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`block rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                  pathname === item.href ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-white hover:text-slate-900"
                }`}
              >
                {item.label}
              </a>
            ))}
            <button
              type="button"
              onClick={() => {
                void signOut().then(() => router.replace("/"))
              }}
              className="mt-4 block w-full rounded-xl px-4 py-2.5 text-left text-sm font-semibold text-slate-500 hover:bg-white hover:text-red-600 transition-colors"
            >
              Sign out
            </button>
          </aside>
          <div>{children}</div>
        </div>
      </main>
    </PageShell>
  )
}
