import Link from "next/link"
import PageShell from "@/components/PageShell"

const posts: Record<string, { title: string; date: string; content: string[] }> = {
  "desktop-agent-setup": {
    title: "Setting up the Virtual Tracker desktop agent",
    date: "June 2026",
    content: [
      "The Python agent in app/Python-App-Extension runs on Windows and macOS. It links to your workspace through a secure token exchange while the web dashboard timer is active.",
      "Once linked, the agent ingests screenshots on a random 90–210 second interval, logs foreground apps every 30 seconds, and captures browser URLs via platform-specific scripts.",
      "Enable ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED=true on the API, restart the backend, and use the dashboard link flow (?link=) to complete pairing.",
    ],
  },
  "org-hierarchy-and-invites": {
    title: "Org hierarchy, invites, and member onboarding",
    date: "June 2026",
    content: [
      "Virtual Tracker models organizations with member relationships, role ladders, and hierarchy-aware visibility enforced on the backend.",
      "Admins can invite members in bulk, share open-link registration URLs, or pre-provision accounts before first sign-in.",
      "The people workspace includes a visual member tree, team rosters, ban management, and real-time presence over WebSocket and SSE.",
    ],
  },
  "task-linked-time-tracking": {
    title: "Task-linked time tracking in the dashboard",
    date: "June 2026",
    content: [
      "The web dashboard exposes a top-bar timer tied to active tasks and projects. Time entries flow into the timesheets view for review and editing.",
      "Task assignments include a review queue so leads can reconcile work against delivery. Submit, approve, and reject APIs exist on the backend.",
      "The timesheet approvals UI is still gated as coming soon, but view & edit time entries is available in the trial client today.",
    ],
  },
}

export function BlogPostView({ slug }: { slug: string }) {
  const post = posts[slug]

  if (!post) {
    return (
      <PageShell>
        <main className="mx-auto flex min-h-[75vh] max-w-4xl items-center justify-center px-6 py-24 lg:px-8">
          <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm text-center space-y-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-600">Blog error</p>
            <h1 className="text-2xl font-extrabold tracking-tight">Article not found</h1>
            <p className="text-xs text-slate-500 font-light max-w-xs mx-auto">This article is not available. Please return to the blog overview.</p>
            <Link
              href="/blog"
              className="inline-flex items-center gap-1 text-xs font-bold text-violet-600 hover:text-violet-800 transition-colors pt-4"
            >
              &larr; Back to blog
            </Link>
          </div>
        </main>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <main className="relative bg-slate-50/50 text-slate-900 pb-24 pt-28 md:pt-36">
        {/* Ambient background glows */}
        <div className="pointer-events-none absolute inset-0 select-none overflow-hidden">
          <div className="absolute top-0 right-1/4 w-[400px] h-[400px] rounded-full bg-violet-200/20 blur-3xl" />
        </div>

        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          {/* Back button */}
          <Link
            href="/blog"
            className="group inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-violet-700 transition-colors mb-8"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5 duration-200" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M13 8H3m0 0l4-4m-4 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to blog
          </Link>

          {/* Article Container */}
          <article className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm space-y-8">
            <div className="space-y-3 border-b border-slate-100 pb-6">
              <span className="inline-flex rounded-full bg-violet-50 border border-violet-100 px-2.5 py-0.5 text-[10px] font-bold text-violet-700 uppercase tracking-wide">
                Codebase Notes
              </span>
              <p className="text-xs text-slate-400 font-medium font-mono">{post.date}</p>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl md:text-5xl leading-tight pb-1">
                {post.title}
              </h1>
            </div>

            <div className="space-y-6 text-sm md:text-base leading-relaxed text-slate-600 font-light">
              {post.content.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-8 mt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-sm">
                  MH
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">Mohammed Hesham</h4>
                  <p className="text-[10px] text-slate-400 font-light">Lead Developer, Virtual Tracker</p>
                </div>
              </div>
              <Link
                href="/demo"
                className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition-all duration-200"
              >
                Try this feature &rarr;
              </Link>
            </div>
          </article>
        </div>
      </main>
    </PageShell>
  )
}
