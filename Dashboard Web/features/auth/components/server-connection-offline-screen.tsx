"use client"

import { HttpErrorPage } from "@/shared/ui/errors"

type ServerConnectionOfflineScreenProps = {
  error?: string | null
  onRetry?: () => void
}

/** Auth bootstrap maintenance state — maps to the shared 503 error page. */
export function ServerConnectionOfflineScreen({ error, onRetry }: ServerConnectionOfflineScreenProps) {
  return <HttpErrorPage status={503} detail={error} onPrimaryAction={onRetry} />
}
