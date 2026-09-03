"use client"

import { HttpErrorPage } from "@/shared/ui/errors"

type ServerConnectionOfflineScreenProps = {
  error?: string | null
  onRetry?: () => void
}

export function ServerConnectionOfflineScreen({ error, onRetry }: ServerConnectionOfflineScreenProps) {
  return <HttpErrorPage status={503} detail={error} onPrimaryAction={onRetry} />
}
