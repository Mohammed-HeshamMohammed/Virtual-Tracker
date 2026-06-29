"use client"

import { HttpErrorPage } from "@/shared/ui/errors"

type ErrorPageProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const detail = error.digest ? `${error.message} (digest: ${error.digest})` : error.message
  return <HttpErrorPage status={500} detail={detail} onPrimaryAction={reset} />
}
