"use client"

import { HttpErrorPage } from "@/shared/ui/errors"

type GlobalErrorPageProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  const detail = error.digest ? `${error.message} (digest: ${error.digest})` : error.message

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <HttpErrorPage status={500} detail={detail} onPrimaryAction={reset} standalone />
      </body>
    </html>
  )
}
