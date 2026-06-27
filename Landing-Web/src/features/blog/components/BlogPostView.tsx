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
        <main className="mx-auto flex min-h-screen max-w-4xl items-center px-6 py-24 lg:px-8">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-10 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-violet-600">Blog</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">Article not found</h1>
            <p className="mt-4 text-slate-600">This article is not available. Return to the blog index.</p>
            <Link href="/blog" className="mt-6 inline-flex text-sm font-semibold text-slate-900 hover:text-violet-700">
              Back to blog →
            </Link>
          </div>
        </main>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <main className="mx-auto max-w-4xl px-6 py-24 lg:px-8">
        <Link href="/blog" className="text-sm font-semibold text-violet-600 hover:text-violet-700">
          ← Back to blog
        </Link>
        <article className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-10 shadow-sm">
          <p className="text-sm font-medium text-violet-600">{post.date}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{post.title}</h1>
          <div className="mt-8 space-y-5 text-lg leading-8 text-slate-700">
            {post.content.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </article>
      </main>
    </PageShell>
  )
}
