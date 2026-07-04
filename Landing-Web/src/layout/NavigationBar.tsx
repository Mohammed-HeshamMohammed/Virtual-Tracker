"use client"

import { useState, useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import AppCtaLink from "@/components/AppCtaLink"
import AuthNavAction from "@/components/AuthNavAction"
import { getTrialHref } from "@/lib/site-urls"
import { PLATFORM_NAV_TABS, SOLUTIONS } from "@/lib/product-content"
import { clampIndex } from "@/lib/safe"

const RESOURCE_LINKS = [
  { title: "Features overview", desc: "What ships in the trial client today.", href: "/features" },
  { title: "Desktop agent", desc: "Windows & macOS setup and secure linking.", href: "/desktop-agent" },
  { title: "FAQ", desc: "What exists now vs. what is on the roadmap.", href: "/faq" },
  { title: "Blog", desc: "Product notes on agent setup, hierarchy, and time tracking.", href: "/blog" },
  { title: "Contact", desc: "Talk to us about a trial deployment.", href: "/contact" },
  { title: "Documentation", desc: "Engineering guides in the app/docs folder.", href: "/resources" },
]

function ChevronDown({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlatformDropdown() {
  const [activeTab, setActiveTab] = useState(0)
  const tabIndex = clampIndex(activeTab, PLATFORM_NAV_TABS.length)
  const tab = PLATFORM_NAV_TABS[tabIndex]

  return (
    <div className="absolute top-full left-0 right-0 bg-white/95 backdrop-blur-md shadow-xl z-40 flex justify-center" style={{ minHeight: 400 }}>
      <div className="flex w-full max-w-5xl">
        <div className="w-52 flex-shrink-0 border-r border-slate-100 py-4 px-3 flex flex-col justify-between">
          <div className="space-y-0.5">
            {PLATFORM_NAV_TABS.map((t, i) => (
              <button
                key={t.label}
                onClick={() => setActiveTab(i)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  tabIndex === i ? "bg-slate-100 text-[#0f172a]" : "text-slate-600 hover:bg-slate-50 hover:text-[#0f172a]"
                }`}
              >
                {t.label}
                {tabIndex === i && <ArrowRight className="w-4 h-4 text-[#7c3aed] flex-shrink-0" />}
              </button>
            ))}
          </div>
          <div className="pt-4 border-t border-slate-100">
            <Link href="/desktop-agent" className="flex items-center gap-2 text-sm font-medium text-[#7c3aed] hover:text-[#6d28d9]">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Desktop agent
            </Link>
          </div>
        </div>

        <div className="flex-1 py-4 px-6">
          <div className="mb-3">
            <Link href={tab.href} className="flex items-center gap-2 text-base font-bold text-[#0f172a] hover:text-[#7c3aed] transition-colors">
              {tab.heading} <ArrowRight className="w-4 h-4 text-[#7c3aed]" />
            </Link>
            <p className="text-xs text-slate-500 mt-0.5">{tab.subheading}</p>
          </div>
          <div className="border-t border-slate-100 mb-4" />
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {tab.features.map((f) => (
              <div key={f.title} className="flex gap-2.5">
                <div className="w-2 h-2 rounded-full bg-violet-500 mt-2 flex-shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-[#0f172a]">{f.title}</div>
                  <div className="text-xs text-slate-500 leading-relaxed mt-0.5">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Link href="/features" className="flex items-center gap-1.5 text-sm font-semibold text-[#0f172a] hover:text-[#7c3aed] transition-colors">
              All features <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        <div className="w-60 flex-shrink-0 border-l border-slate-100 py-4 px-5">
          <div className="text-sm font-bold text-[#0f172a] mb-3">{tab.cta.label}</div>
          <div className="w-full h-36 rounded-xl mb-3 flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, #7c3aed, #2563eb)" }}>
            <p className="text-white text-sm font-bold text-center leading-snug">{tab.subheading}</p>
          </div>
          <AppCtaLink href={getTrialHref()} className="flex items-center gap-1.5 text-sm font-bold text-[#0f172a] hover:text-[#7c3aed] transition-colors">
            {tab.cta.link} <ArrowRight className="w-3.5 h-3.5" />
          </AppCtaLink>
        </div>
      </div>
    </div>
  )
}

function SolutionsDropdown() {
  return (
    <div className="absolute top-full left-0 right-0 bg-white/95 backdrop-blur-md shadow-xl z-40 flex justify-center py-6 px-4">
      <div className="grid w-full max-w-3xl grid-cols-2 gap-4">
        {SOLUTIONS.map((item) => (
          <Link key={item.title} href={item.href} className="rounded-xl border border-slate-100 p-4 hover:border-violet-200 hover:bg-violet-50/50 transition-colors">
            <div className="text-sm font-semibold text-[#0f172a]">{item.title}</div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}

function ResourcesDropdown() {
  return (
    <div className="absolute top-full left-0 right-0 bg-white/95 backdrop-blur-md shadow-xl z-40 flex justify-center py-6 px-4">
      <div className="grid w-full max-w-4xl grid-cols-2 md:grid-cols-3 gap-4">
        {RESOURCE_LINKS.map((item) => (
          <Link key={item.title} href={item.href} className="rounded-xl border border-slate-100 p-4 hover:border-violet-200 hover:bg-violet-50/50 transition-colors">
            <div className="text-sm font-semibold text-[#0f172a]">{item.title}</div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}

type OpenMenu = "Platform" | "solutions" | "resources" | null

export default function NavigationBar() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState<OpenMenu>(null)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const toggle = (menu: OpenMenu) => setOpen((prev) => (prev === menu ? null : menu))
  const isHome = pathname === "/"
  const isTransparent = isHome && !scrolled && !open
  const btnBg = isTransparent ? "bg-white text-black hover:bg-white/90" : "bg-[#1e293b] text-white hover:bg-[#0f172a]"

  const navBtnClass = (menu: OpenMenu) =>
    `flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
      open === menu
        ? "text-[#7c3aed] bg-violet-50"
        : isTransparent
          ? "text-white/80 hover:text-white hover:bg-white/10"
          : "text-[#374151] hover:text-[#0f172a] hover:bg-slate-50"
    }`

  const chevronClass = (menu: OpenMenu) =>
    `w-3.5 h-3.5 transition-transform duration-200 ${
      open === menu ? "rotate-180 text-[#7c3aed]" : isTransparent ? "text-white/60" : "text-slate-400"
    }`

  return (
    <nav
      ref={navRef}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isTransparent 
          ? "bg-transparent border-b border-transparent" 
          : "bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-sm"
      }`}
      style={{ overflow: "visible" }}
    >
      <svg className="absolute w-0 h-0 pointer-events-none">
        <defs>
          <filter id="gooey-filter" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="gooey" />
            <feComposite in="SourceGraphic" in2="gooey" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div className="relative z-60 max-w-full px-16 h-16 flex items-center justify-between" style={{ overflow: "visible" }}>
        <Link href="/" className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden">
            <img src={isTransparent ? "/stopwatch-green.png" : "/stopwatch-black.png"} alt="Virtual Tracker" className="w-8 h-8" />
          </div>
          <span className={`font-bold text-lg tracking-tight ${isTransparent ? "text-white" : "text-[#0f172a]"}`}>Virtual Tracker</span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          <button onClick={() => toggle("Platform")} className={navBtnClass("Platform")}>
            Platform <ChevronDown className={chevronClass("Platform")} />
          </button>
          <button onClick={() => toggle("solutions")} className={navBtnClass("solutions")}>
            Solutions <ChevronDown className={chevronClass("solutions")} />
          </button>
          <button onClick={() => toggle("resources")} className={navBtnClass("resources")}>
            Resources <ChevronDown className={chevronClass("resources")} />
          </button>
          <div className={`w-px h-5 mx-2 ${isTransparent ? "bg-white/20" : "bg-slate-200"}`} />
          <Link href="/pricing" className={`px-3 py-2 text-sm font-medium transition-colors ${isTransparent ? "text-white/80 hover:text-white" : "text-[#374151] hover:text-[#0f172a]"}`}>
            Pricing
          </Link>
          <Link href="/demo" className={`px-3 py-2 text-sm font-medium transition-colors ${isTransparent ? "text-white/80 hover:text-white" : "text-[#374151] hover:text-[#0f172a]"}`}>
            Demo
          </Link>
        </div>

        <div className="hidden md:flex items-center gap-16" style={{ overflow: "visible" }}>
          <AppCtaLink
            href={getTrialHref()}
            className="relative inline-flex items-center gap-2 rounded-full font-semibold text-sm px-5 py-2.5 cursor-pointer bg-[#7c3aed] hover:bg-[#6d28d9] text-white transition-colors"
            style={{ boxShadow: "0 0 28px 8px rgba(124,58,237,0.5), 0 0 10px 3px rgba(124,58,237,0.3)" }}
          >
            Open dashboard
          </AppCtaLink>
          <AuthNavAction isTransparent={isTransparent} btnBg={btnBg} />
        </div>

        <button className="md:hidden p-2" type="button" aria-label="Menu">
          <div className={`w-5 h-0.5 mb-1 ${isTransparent ? "bg-white" : "bg-slate-700"}`} />
          <div className={`w-5 h-0.5 mb-1 ${isTransparent ? "bg-white" : "bg-slate-700"}`} />
          <div className={`w-5 h-0.5 ${isTransparent ? "bg-white" : "bg-slate-700"}`} />
        </button>
      </div>

      {open === "Platform" && <PlatformDropdown />}
      {open === "solutions" && <SolutionsDropdown />}
      {open === "resources" && <ResourcesDropdown />}
    </nav>
  )
}
