import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthSessionLoader } from "@/features/auth"
import AuthActionPage from "@/features/auth/pages/auth-action-page"

export const metadata: Metadata = {
  title: "Verify email — My Virtual Tracker",
  description: "Complete email verification for your account on My Virtual Tracker.",
}

export default function EmailActionRoutePage() {
  return (
    <Suspense fallback={<AuthSessionLoader message="Opening verification link…" />}>
      <AuthActionPage />
    </Suspense>
  )
}
