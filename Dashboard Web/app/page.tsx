import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthSessionLoader } from "@/features/auth"
import { HomeClient } from "@/app/home-client"

export const metadata: Metadata = {
  title: "Virtual Tracker",
  description: "Virtual Tracker",
}

export default function HomePage() {
  return (
    <Suspense fallback={<AuthSessionLoader />}>
      <HomeClient />
    </Suspense>
  )
}
