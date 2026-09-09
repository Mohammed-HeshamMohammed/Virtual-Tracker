"use client"

import { useState } from "react"
import Link from "next/link"
import PageShell from "@/components/PageShell"
import PageIntro from "@/components/PageIntro"
import { BLOG_POSTS } from "@/lib/product-content"

export function BlogListView() {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState("all")

  const categories = [
    { id: "all", label: "All Posts" },
    { id: "setup", label: "Setup & Install" },
    { id: "security", label: "Security & Roles" },
    { id: "features", label: "Features" }
  ]

  const mappedPosts = BLOG_POSTS.map((post) => {
    let tag = "Update"
    let tagId = "features"
    let readTime = "3 min read"
    if (post.slug.includes("agent")) {
      tag = "Setup & Installation"
      tagId = "setup"
      readTime = "5 min read"
    } else if (post.slug.includes("hierarchy")) {
      tag = "Security & Roles"
      tagId = "security"
      readTime = "4 min read"
    } else if (post.slug.includes("tracking")) {
      tag = "Dashboard Features"
      tagId = "features"
      readTime = "3 min read"
    }
    return { ...post, tag, tagId, readTime }
  })

  const filteredPosts = mappedPosts.filter((post) => {
    const matchesSearch = post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          post.excerpt.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = activeCategory === "all" || post.tagId === activeCategory
    return matchesSearch && matchesCategory
  })

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 pb-24">
        <PageIntro
          eyebrow="Blog"
          title="Notes from the Virtual Tracker codebase"
          description="Practical engineering, role hierarchy details, and setup articles tied to features that exist in the trial client today."
        />

        <div className="mx-auto max-w-7xl px-6 lg:px-8 mt-12 space-y-12">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-4 py-2 rounded-full text-xs font-bold border transition-all duration-200 cursor-pointer ${
                    activeCategory === cat.id
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
                placeholder="Search articles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-full border border-slate-200 px-5 py-2.5 pl-10 text-xs focus:border-violet-500 focus:outline-none bg-white transition-colors"
              />
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2">
                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
              </svg>
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {filteredPosts.map((post) => (
              <article
                key={post.slug}
                className="group rounded-3xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-md hover:border-violet-200 transition-all duration-300 flex flex-col justify-between animate-fadeIn"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="inline-flex rounded-full bg-violet-50 border border-violet-100 px-2.5 py-0.5 text-[10px] font-bold text-violet-700 uppercase tracking-wide">
                      {post.tag}
                    </span>
                    <span className="text-[10px] text-slate-400 font-light">{post.readTime}</span>
                  </div>

                  <span className="text-[11px] font-medium text-slate-400 font-mono block">{post.date}</span>
                  <h2 className="mt-3 text-lg font-bold text-slate-900 group-hover:text-violet-700 transition-colors duration-300">
                    {post.title}
                  </h2>
                  <p className="mt-4 text-xs leading-relaxed text-slate-500 font-light line-clamp-3">
                    {post.excerpt}
                  </p>
                </div>

                <div className="border-t border-slate-100 pt-6 mt-6">
                  <Link
                    href={`/blog/${post.slug}`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-slate-800 hover:text-violet-700 transition-colors"
                  >
                    Read article
                    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1 duration-200" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </main>
    </PageShell>
  )
}
