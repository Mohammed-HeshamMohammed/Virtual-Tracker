import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthSessionLoader } from "@/features/auth"
import AuthActionPage from "@/features/auth/pages/auth-action-page"

export const metadata: Metadata = {
  title: "Verify email — Virtual Tracker",
  description: "Complete email verification for your Virtual Tracker account.",
}

export default function EmailActionRoutePage() {
  return (
    <Suspense fallback={<AuthSessionLoader message="Opening verification link…" />}>
      <AuthActionPage />
    </Suspense>
  )
}
