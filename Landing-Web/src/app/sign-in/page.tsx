import Link from "next/link"
import { redirect } from "next/navigation"
import PageShell from "../../components/PageShell"
import { getDashboardUrl } from "@/lib/site-urls"
import { isValidRedirectUrl } from "@/lib/safe"

export default function SignInPage() {
  const dashboardUrl = getDashboardUrl()
  if (dashboardUrl && isValidRedirectUrl(dashboardUrl)) {
    redirect(dashboardUrl)
  }

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 min-h-[85vh] flex items-center justify-center py-16 px-4">
        {/* Background ambient mesh */}
        <div className="pointer-events-none absolute inset-0 select-none overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-violet-200/20 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 md:p-10 shadow-lg z-10 space-y-6">
          <div className="text-center space-y-4">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3.5 py-1 text-xs font-bold text-violet-700 uppercase tracking-wider">
              Workspace Portal
            </span>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight sm:text-3xl">Access Workspace</h1>
            <p className="text-xs text-slate-500 font-light leading-relaxed">
              Virtual Tracker's workspaces and authentication run in a separate dashboard application. Choose an option below to proceed.
            </p>
          </div>

          <div className="border-t border-slate-100 my-4" />

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 flex gap-3.5 items-start">
              <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-800">Firebase Auth Security</h4>
                <p className="text-[11px] text-slate-400 font-light mt-0.5">Credentials are validated directly against your secure Firebase Auth database.</p>
              </div>
            </div>

            {/* Sandbox Credentials Helper */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Sandbox Demo Users</span>
              <ul className="space-y-2 text-[11px] text-slate-500 font-light">
                <li className="flex justify-between items-center border-b border-slate-200/50 pb-1.5">
                  <span className="font-bold text-slate-700">Administrator:</span>
                  <code className="bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded font-mono">admin@virtualtracker.dev</code>
                </li>
                <li className="flex justify-between items-center border-b border-slate-200/50 pb-1.5">
                  <span className="font-bold text-slate-700">Team Manager:</span>
                  <code className="bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded font-mono">manager@virtualtracker.dev</code>
                </li>
                <li className="flex justify-between items-center">
                  <span className="font-bold text-slate-700">Member:</span>
                  <code className="bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded font-mono">developer@virtualtracker.dev</code>
                </li>
              </ul>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Link
                href="/demo"
                className="w-full inline-flex justify-center items-center rounded-full bg-violet-600 px-6 py-3.5 text-xs font-bold text-white hover:bg-violet-700 shadow-md hover:shadow-lg transition-all duration-200"
              >
                Access Demo Workspace
              </Link>
              <Link
                href="/contact"
                className="w-full inline-flex justify-center items-center rounded-full border border-slate-200 bg-white px-6 py-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all duration-200"
              >
                Request Deployment Access
              </Link>
            </div>
          </div>
        </div>
      </main>
    </PageShell>
  )
}
