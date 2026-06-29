"use client"

import React from "react"
import { NotifyToastHost } from "@/shared/ui/layout/toasts/notify-toast-host"

export interface AuthErrorToastHostProps {
  message: string | null
  onDismiss: () => void
  title?: string
}

export function AuthErrorToastHost({ message, onDismiss, title = "Authentication" }: AuthErrorToastHostProps): React.ReactElement | null {
  return <NotifyToastHost message={message} onDismiss={onDismiss} title={title} tone="error" />
}
