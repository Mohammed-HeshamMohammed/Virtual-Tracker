import PageShell from "../../components/PageShell"
import { SLUG_PAGES } from "@/lib/product-content"

const DEFAULT_PAGE = {
  title: "Page not found",
  description: "This page is not part of the Virtual Tracker marketing site. Try Features, Demo, or Contact.",
  bullets: ["Features overview", "Product demo", "Contact"],
}

export default async function CatchAllPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  let path = ""

  try {
    const resolved = await params
    path = Array.isArray(resolved.slug) ? resolved.slug.filter(Boolean).join("/") : ""
  } catch {
    path = ""
  }

  const page = (path && SLUG_PAGES[path]) || DEFAULT_PAGE

  return (
    <PageShell className="bg-white text-slate-900">
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-24 lg:px-8">
        <div className="max-w-3xl rounded-3xl border border-slate-200 bg-slate-50 p-10 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-violet-600">Virtual Tracker</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">{page.title}</h1>
          <p className="mt-6 text-lg leading-8 text-slate-600">{page.description}</p>
          <ul className="mt-8 space-y-3 text-sm text-slate-700">
            {page.bullets.map((bullet) => (
              <li key={bullet} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-violet-600" />
                {bullet}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </PageShell>
  )
}
