"use client"

import Link from "next/link"
import { getSignInHref } from "@/lib/site-urls"
import AppCtaLink from "@/components/AppCtaLink"
import { FOOTER_COLS } from "@/lib/product-content"
import { safeHref } from "@/lib/safe"

export default function Footer() {
  return (
    <footer className="py-12 px-4 md:px-8" style={{ background: "#151d2e" }}>
      <div className="w-full">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "2rem" }}>
          {FOOTER_COLS.map((col) => (
            <div key={col.title} className="min-w-0">
              <div className="text-xs font-bold text-white mb-4">{col.title}</div>
              <ul className="space-y-2.5">
                {col.links.map((link) => {
                  const linkClass = "text-slate-400 hover:text-slate-200 text-sm transition-colors"
                  if ("useAppLink" in link && link.useAppLink) {
                    return (
                      <li key={link.label}>
                        <AppCtaLink href={getSignInHref()} className={linkClass}>
                          {link.label}
                        </AppCtaLink>
                      </li>
                    )
                  }
                  return (
                    <li key={link.label}>
                      <Link href={safeHref(link.href)} className={linkClass}>
                        {link.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  )
}
