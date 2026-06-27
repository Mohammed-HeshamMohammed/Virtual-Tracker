"use client"

import Link from "next/link"
import { isExternalHref } from "@/lib/site-urls"
import { safeHref } from "@/lib/safe"

type AppCtaLinkProps = {
  href: string
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
  onClick?: () => void
}

export default function AppCtaLink({ href, className, style, children, onClick }: AppCtaLinkProps) {
  const target = safeHref(href, "/")

  if (isExternalHref(target)) {
    return (
      <a href={target} className={className} style={style} onClick={onClick} rel="noopener noreferrer">
        {children}
      </a>
    )
  }

  return (
    <Link href={target} className={className} style={style} onClick={onClick}>
      {children}
    </Link>
  )
}
