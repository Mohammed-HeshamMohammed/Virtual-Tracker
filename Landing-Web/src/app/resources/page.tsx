"use client"

import { useState } from "react"
import PageShell from "../../components/PageShell"
import PageIntro from "@/components/PageIntro"

export default function ResourcesPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTag, setActiveTag] = useState("all")
  const [copiedPath, setCopiedPath] = useState<string | null>(null)

  const handleCopy = (path: string) => {
    navigator.clipboard.writeText(path)
    setCopiedPath(path)
    setTimeout(() => setCopiedPath(null), 2000)
  }

  const resources = [
    {
      title: "Project Hierarchy",
      desc: "A structural map for database schemas, Next.js dashboard pages, API router handlers, and agent client modules.",
      tag: "Architecture",
      file: "app/docs/hierarchy.md",
      icon: "M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.884 2.233c.124 2.207 1.258 4.135 2.884 5.378m0-7.611a2.25 2.25 0 011.883-2.233m2.247-2.11H14m0 0a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 4.5v10.856m8.121-6.634a2.23 2.23 0 001.379-.626L16.21 6.1m-2.09 2.01l2.09-2.01m-2.09 2.01H18.75a2.25 2.25 0 012.25 2.25v7.5a2.25 2.25 0 01-2.25 2.25H5.25a2.25 2.25 0 01-2.25-2.25v-7.5a2.25 2.25 0 012.25-2.25h11.25"
    },
    {
      title: "Roles & Visibility Guide",
      desc: "Description of org hierarchies, security boundaries, and Firestore rule sets managing what leads versus members can see.",
      tag: "Security",
      file: "app/docs/roles-visibility.md",
      icon: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751A11.956 11.956 0 0112 2.714z"
    },
    {
      title: "Authentication Handler",
      desc: "Technical details on Firebase Auth email configuration, account pre-provisioning scripts, and active session verifications.",
      tag: "API & Auth",
      file: "app/docs/auth-handler.md",
      icon: "M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818l6.902-6.902c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
    },
    {
      title: "Python Desktop Client",
      desc: "Step-by-step guidance on setting up the local desktop tracking agent, linking workspace keys, and running cross-platform capture loops.",
      tag: "Setup Agent",
      file: "app/Python-App-Extension/README.md",
      icon: "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
    }
  ]

  const categories = [
    { id: "all", label: "All Docs" },
    { id: "Architecture", label: "Architecture" },
    { id: "Security", label: "Security & Roles" },
    { id: "API & Auth", label: "Auth & API" },
    { id: "Setup Agent", label: "Agent Setup" }
  ]

  const filteredResources = resources.filter((resource) => {
    const matchesSearch = resource.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          resource.desc.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesTag = activeTag === "all" || resource.tag === activeTag
    return matchesSearch && matchesTag
  })

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 pb-24">
        <PageIntro
          eyebrow="Resources & Docs"
          title="Documentation and guides"
          description="Detailed guide sheets and architecture descriptions for the Virtual Tracker client. Read sheets inside the codebase."
        />

        <div className="mx-auto max-w-7xl px-6 lg:px-8 mt-12 space-y-12">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveTag(cat.id)}
                  className={`px-4 py-2 rounded-full text-xs font-bold border transition-all duration-200 cursor-pointer ${
                    activeTag === cat.id
                      ? "bg-violet-600 border-violet-600 text-white shadow-sm"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="relative max-w-xs w-full">
              <input
                type="text"
                placeholder="Search resources..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-full border border-slate-200 px-5 py-2.5 pl-10 text-xs focus:border-violet-500 focus:outline-none bg-white transition-colors"
              />
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2">
                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
              </svg>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {filteredResources.map((resource) => (
              <div key={resource.title} className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between animate-fadeIn">
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-600 uppercase tracking-wide">
                      {resource.tag}
                    </span>
                    <svg viewBox="0 0 24 24" className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d={resource.icon} />
                    </svg>
                  </div>
                  <h3 className="text-base font-bold text-slate-900">{resource.title}</h3>
                  <p className="mt-3 text-xs leading-relaxed text-slate-500 font-light mb-6">
                    {resource.desc}
                  </p>
                </div>
                <div className="border-t border-slate-100 pt-4 mt-2 flex items-center justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 font-mono block">Code Repository Location:</span>
                    <code className="text-[11px] text-violet-700 bg-violet-50/50 border border-violet-100/50 px-2 py-1 rounded-md mt-1.5 inline-block font-mono">
                      {resource.file}
                    </code>
                  </div>
                  <button
                    onClick={() => handleCopy(resource.file)}
                    className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-50 border border-slate-200/80 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
                    title="Copy path to clipboard"
                  >
                    {copiedPath === resource.file ? (
                      <span className="text-[9px] font-bold text-emerald-600 font-sans">Copied</span>
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12a1.5 1.5 0 01.439 1.061V16.5A1.5 1.5 0 0115.5 18h-7A1.5 1.5 0 017 16.5v-13z" />
                        <path d="M15 6.5a1.5 1.5 0 01-1.5-1.5V3.07a.5.5 0 00-.1-.13L10.28 6.06a.5.5 0 00-.13.1v.34H15z" />
                        <path d="M3.5 6A1.5 1.5 0 002 7.5v9A1.5 1.5 0 003.5 18h7a1.5 1.5 0 001.5-1.5v-1.25a.75.75 0 00-1.5 0v1.25h-7v-9H5.5a.75.75 0 000-1.5H3.5z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </PageShell>
  )
}
