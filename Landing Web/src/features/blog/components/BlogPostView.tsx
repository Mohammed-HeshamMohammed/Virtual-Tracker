import Link from "next/link"
import PageShell from "@/components/PageShell"

const posts: Record<string, { title: string; date: string; content: string[] }> = {
  "how-modern-teams-track-time-without-friction": {
    title: "How modern teams track time without friction",
    date: "June 24, 2026",
    content: [
      "Good time tracking should feel like a normal part of work, not a separate admin task.",
      "Modern teams adopt tools that reduce friction with simple timers, automatic reminders, and clear approvals.",
      "The result is better reporting, stronger trust, and less time lost to manual reconciliation.",
    ],
  },
  "the-rise-of-workforce-productivity-ops": {
    title: "The rise of workforce productivity operations",
    date: "June 18, 2026",
    content: [
      "Leaders are increasingly treating productivity data as an operational input for planning and delivery.",
      "That shift is driving demand for dashboards that combine time tracking, workload visibility, and performance context.",
      "The best systems support decision-making without becoming invasive or overly complex.",
    ],
  },
  "why-billing-accuracy-starts-with-better-tracking": {
    title: "Why billing accuracy starts with better tracking",
    date: "June 10, 2026",
    content: [
      "Billing errors often come from broken handoffs, delayed entries, or inconsistent client-specific reporting.",
      "Accurate time capture creates a stronger foundation for invoices, budgets, and forecasts.",
      "Teams that standardize their workflow gain fewer disputes and faster payment cycles.",
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
            <p className="mt-4 text-slate-600">This article is not available yet. Return to the blog index to browse the latest posts.</p>
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
