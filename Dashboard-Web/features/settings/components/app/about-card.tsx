"use client"

/**
 * Who made this. Sits with the transparency material rather than buried in a
 * menu: an employee-monitoring product that is hard to attribute is a worse
 * product, and an IT admin approving it needs a named vendor.
 */

const DEVELOPERS = [
  { name: "Mohammed Hesham", handle: "Mohammed-HeshamMohammed" },
  { name: "Mohammed Magdy", handle: "mo7amed-magdy" },
]

/** Inline rather than from lucide, which dropped brand marks in recent
 *  versions. Same path as the agent's copy - the two apps are separate
 *  packages with no shared component library. */
function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.3-1.7-1.3-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.5 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z" />
    </svg>
  )
}

export function AboutCard() {
  return (
    <section className="mt-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 p-6">
      <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">About Virtual Tracker</h4>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Owned and operated by <span className="font-semibold text-slate-700 dark:text-slate-200">Soft Fix</span> and{" "}
        <span className="font-semibold text-slate-700 dark:text-slate-200">Virtual Callers</span>.
      </p>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Developers
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEVELOPERS.map((dev) => (
            <a
              key={dev.handle}
              href={`https://github.com/${dev.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <GithubMark />
              {dev.name}
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
