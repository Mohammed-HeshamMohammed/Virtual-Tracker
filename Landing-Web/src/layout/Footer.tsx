"use client"

import Link from "next/link"

const FOOTER_COLS = [
  {
    title: "Product & platform",
    links: [
      { label: "Hour logging", href: "/hour-logging" },
      { label: "Output visibility", href: "/output-visibility" },
      { label: "Workforce signals", href: "/workforce-signals" },
      { label: "Pay & invoicing", href: "/pay-invoicing" },
      { label: "Connected apps", href: "/connected-apps" },
      { label: "Smart timesheets", href: "/smart-timesheets" },
      { label: "Team visibility", href: "/team-visibility" },
      { label: "Custom reports", href: "/custom-reports" },
      { label: "Client invoicing", href: "/client-invoicing" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", href: "/about-us" },
      { label: "Guiding principles", href: "/guiding-principles" },
      { label: "Reviews", href: "/reviews" },
      { label: "Press", href: "/press" },
      { label: "Partners", href: "/partners" },
      { label: "Status", href: "/status" },
      { label: "Product roadmap", href: "/product-roadmap" },
      { label: "Careers", href: "/careers" },
    ],
    badges: [{ label: "Hiring", index: 7 }],
  },
  {
    title: "Get Virtual Tracker",
    links: [
      { label: "Download Virtual Tracker", href: "/download-virtual-tracker" },
      { label: "Mac time tracker", href: "/mac-time-tracker" },
      { label: "Linux time tracker", href: "/linux-time-tracker" },
      { label: "Windows time tracker", href: "/windows-time-tracker" },
      { label: "Web Time Tracker", href: "/web-time-tracker" },
    ],
  },
  {
    title: "Connect with us",
    links: [
      { label: "Help center", href: "/help-center" },
      { label: "Sign in", href: "/sign-in" },
      { label: "Pricing", href: "/pricing" },
      { label: "Try Demo now", href: "/demo" },
      { label: "Contact Us", href: "/contact-us" },
    ],
    badges: [{ label: "Free trial", index: 2 }],
  },
  {
    title: "Compare Virtual Tracker with",
    links: [
      { label: "Toggl", href: "/toggl" },
      { label: "Clockify", href: "/clockify" },
      { label: "Insightful", href: "/insightful" },
      { label: "Apploye", href: "/apploye" },
      { label: "ActivTrak", href: "/activtrak" },
      { label: "Time Doctor", href: "/time-doctor" },
      { label: "Desktime", href: "/desktime" },
      { label: "See all comparisons", href: "/see-all-comparisons" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Resource hub", href: "/resource-hub" },
      { label: "Time tracking resources", href: "/time-tracking-resources" },
      { label: "Virtual Tracker ROI calculator", href: "/roi-calculator" },
      { label: "Virtual Tracker buy-in guide", href: "/buy-in-guide" },
      { label: "FAQ", href: "/faq" },
      { label: "Customer stories", href: "/customer-stories" },
      { label: "Blog", href: "/blog" },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="py-12 px-4 md:px-8" style={{ background: "#151d2e" }}>
      <div className="w-full">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "2rem" }}>
          {FOOTER_COLS.map((col) => (
            <div key={col.title} className="min-w-0">
              <div className="text-xs font-bold text-white mb-4">{col.title}</div>
              <ul className="space-y-2.5">
                {col.links.map((link, linkIdx) => {
                  const badge = col.badges?.find((b) => b.index === linkIdx)
                  return (
                    <li key={link.label} className="flex items-center gap-2">
                      <Link href={link.href} className="text-slate-400 hover:text-slate-200 text-sm transition-colors">
                        {link.label}
                      </Link>
                      {badge && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-white" style={{ background: badge.label === "Hiring" ? "#16a34a" : "#7c3aed" }}>
                          {badge.label}
                        </span>
                      )}
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