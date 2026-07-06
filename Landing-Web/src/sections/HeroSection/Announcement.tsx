"use client"

import Link from "next/link"

export default function Announcement() {
  return (
    <div className="flex items-center justify-center mb-10 px-4">
      <div className="flex items-center gap-2 max-w-full overflow-hidden border border-white/20 rounded-full bg-white/5 px-1 py-0.5 text-xs text-white">
        <span className="bg-white/10 border border-white/20 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap flex-shrink-0">
          Trial client
        </span>
        <span className="hidden sm:inline whitespace-nowrap pl-0.5">Desktop agent for Windows & macOS is available</span>
        <Link
          href="/desktop-agent"
          className="group relative inline-flex items-center h-6 flex-shrink-0 overflow-hidden rounded-full"
        >
          <span className="absolute inset-y-0 left-0 z-0 h-6 w-6 rounded-full bg-white transition-[width] duration-500 ease-[cubic-bezier(0.65,0,0.076,1)] group-hover:w-full" />
          <span className="relative z-10 flex h-6 w-6 items-center justify-center transition-transform duration-500 ease-[cubic-bezier(0.65,0,0.076,1)] group-hover:translate-x-1">
            <span className="block h-1.5 w-1.5 -translate-x-px rotate-45 border-t-2 border-r-2 border-black" />
          </span>
          <span className="relative z-10 whitespace-nowrap pr-3 text-[0.6rem] font-bold uppercase tracking-wide text-white transition-colors duration-500 group-hover:text-black">
            Agent setup
          </span>
        </Link>
      </div>
    </div>
  )
}
