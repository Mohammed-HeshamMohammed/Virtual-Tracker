import Link from "next/link"
import PageShell from "@/components/PageShell"

const posts = [
  {
    slug: "how-modern-teams-track-time-without-friction",
    title: "How modern teams track time without friction",
    excerpt: "A practical look at how smart time tracking improves adoption, visibility, and team trust.",
    date: "June 24, 2026",
  },
  {
    slug: "the-rise-of-workforce-productivity-ops",
    title: "The rise of workforce productivity operations",
    excerpt: "Why leaders are treating productivity insights as a core operational function, not a side metric.",
    date: "June 18, 2026",
  },
  {
    slug: "why-billing-accuracy-starts-with-better-tracking",
    title: "Why billing accuracy starts with better tracking",
    excerpt: "How reliable time capture reduces rework, disputes, and revenue leakage for service teams.",
    date: "June 10, 2026",
  },
]

export function BlogListView() {
  return (
    <PageShell>
      <main className="bg-white text-slate-900">
        <section className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
              Blog
            </span>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Insights for operators, managers, and growing teams.</h1>
            <p className="text-lg text-slate-600">Explore practical articles on time tracking, productivity, billing clarity, and modern workforce operations.</p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {posts.map((post) => (
              <article key={post.slug} className="rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
                <p className="text-sm font-medium text-violet-600">{post.date}</p>
                <h2 className="mt-3 text-xl font-semibold text-slate-900">{post.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{post.excerpt}</p>
                <Link href={`/blog/${post.slug}`} className="mt-6 inline-flex text-sm font-semibold text-slate-900 hover:text-violet-700">
                  Read article →
                </Link>
              </article>
            ))}
          </div>
        </section>
      </main>
    </PageShell>
  )
}
