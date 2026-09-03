"use client"

import { useLayoutEffect, useState } from "react"
import { defaultNavItemForRole } from "@/features/auth/permissions/member-role-access"

type UseAppShellReadyArgs = {
  sessionReady: boolean
  isLoggedIn: boolean
  memberRole: string
}

export function useAppShellReady({ sessionReady, isLoggedIn, memberRole }: UseAppShellReadyArgs) {
  const [activeItem, setActiveItem] = useState("command-center")
  const [shellReady, setShellReady] = useState(false)

  useLayoutEffect(() => {
    if (!sessionReady) {
      setShellReady(false)
      return
    }
    if (!isLoggedIn) {
      setShellReady(true)
      return
    }
    setActiveItem(defaultNavItemForRole(memberRole))
    setShellReady(true)
  }, [sessionReady, isLoggedIn, memberRole])

  return { activeItem, setActiveItem, shellReady }
}
