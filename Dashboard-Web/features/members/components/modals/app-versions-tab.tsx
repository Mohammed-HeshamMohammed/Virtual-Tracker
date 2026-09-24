"use client"

import { useEffect, useMemo, useState } from "react"
import { Bell, CheckCircle2, Mail, RefreshCw, Send, TriangleAlert } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  getAgentVersions,
  sendAgentInstallEmail,
  sendAgentUpdateReminder,
  sendAgentVersionReminders,
  sendUnknownAgentInstallEmails,
  type AgentVersionGroup,
  type AgentVersionMember,
} from "@/features/members/services/member-onboarding"

type Channel = "app" | "email"

function formatOpened(value: string | null): string {
  if (!value) return "Never reported"
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return "Unrecognized report"
  const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000))
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

function groupLabel(group: AgentVersionGroup): string {
  if (group.status === "unknown") return "Never reported"
  if (group.status === "unrecognized") return "Unrecognized report"
  return `v${group.version}`
}

export function AppVersionsTab() {
  const [groups, setGroups] = useState<AgentVersionGroup[]>([])
  const [latestVersion, setLatestVersion] = useState("")
  const [selectedKey, setSelectedKey] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [result, setResult] = useState("")
  const [busyKey, setBusyKey] = useState("")

  async function load() {
    setLoading(true)
    setError("")
    try {
      const data = await getAgentVersions()
      setGroups(data.groups)
      setLatestVersion(data.latestVersion)
      setSelectedKey((current) => data.groups.some((group) => group.key === current) ? current : (data.groups[0]?.key ?? ""))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tracker versions")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const selected = useMemo(
    () => groups.find((group) => group.key === selectedKey) ?? groups[0] ?? null,
    [groups, selectedKey],
  )

  async function sendOne(member: AgentVersionMember, channel: Channel) {
    const key = `${member.memberId}:${channel}`
    setBusyKey(key)
    setError("")
    setResult("")
    try {
      const response = await sendAgentUpdateReminder(member.memberId, channel)
      setResult(response.status === "duplicate" ? "Reminder already sent recently." : `Sent ${channel === "app" ? "in-app" : "email"} reminder to ${member.displayName}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reminder")
    } finally {
      setBusyKey("")
    }
  }

  async function sendInstall(member: AgentVersionMember) {
    const key = `${member.memberId}:install`
    setBusyKey(key)
    setError("")
    setResult("")
    try {
      await sendAgentInstallEmail(member.memberId)
      setResult(`Sent latest-app install instructions to ${member.displayName}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send install instructions")
    } finally {
      setBusyKey("")
    }
  }

  async function sendAll(channel: Channel) {
    if (!selected?.version || selected.status !== "outdated") return
    const eligible = selected.members.filter((member) => channel === "app" ? member.supportsAgentInbox : member.canReceiveEmail).length
    if (!eligible || !window.confirm(`Send ${channel === "app" ? "in-app" : "email"} update reminders to ${eligible} member${eligible === 1 ? "" : "s"} using v${selected.version}?`)) return
    setBusyKey(`all:${channel}`)
    setError("")
    setResult("")
    try {
      const summary = await sendAgentVersionReminders(selected.version, channel)
      setResult(`Sent ${summary.sent}. Skipped ${summary.current + summary.duplicate + summary.unsupported + summary.missingEmail}. Failed ${summary.failed}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send bulk reminders")
    } finally {
      setBusyKey("")
    }
  }

  async function sendAllInstall() {
    if (selected?.status !== "unknown") return
    const eligible = selected.members.filter((member) => member.canReceiveEmail).length
    if (!eligible || !window.confirm(`Email latest-app install instructions to ${eligible} member${eligible === 1 ? "" : "s"} who never reported a version?`)) return
    setBusyKey("all:install")
    setError("")
    setResult("")
    try {
      const summary = await sendUnknownAgentInstallEmails()
      setResult(`Sent ${summary.sent}. Skipped ${summary.current + summary.duplicate + summary.missingEmail}. Failed ${summary.failed}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send install instructions")
    } finally {
      setBusyKey("")
    }
  }

  if (loading) return <div className="py-14 text-center text-sm text-slate-500 dark:text-slate-400">Loading tracker versions…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">Latest published tracker: <strong className="text-slate-700 dark:text-slate-200">v{latestVersion}</strong></p>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">{error}</div> : null}
      {result ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">{result}</div> : null}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {groups.map((group) => (
          <button key={group.key} type="button" onClick={() => { setSelectedKey(group.key); setError(""); setResult("") }} className={cn(
            "min-w-36 rounded-xl border px-3 py-2 text-left transition-colors",
            selected?.key === group.key
              ? "border-blue-500 bg-blue-50 dark:border-emerald-500 dark:bg-emerald-950/40"
              : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800",
          )}>
            <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{groupLabel(group)}</span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{group.memberCount} member{group.memberCount === 1 ? "" : "s"}{group.status === "latest" ? " · Latest" : group.status === "outdated" ? " · Outdated" : ""}{group.members.some((m) => m.needsManualReinstall) ? " · Needs reinstall" : group.members.some((m) => m.updateBlocked === true) ? " · Cannot install" : ""}</span>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/70">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{groupLabel(selected)}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {selected.status === "latest" ? "Update reminders disabled: members already use latest version." : selected.status === "outdated" ? "Send individually or to all eligible members." : "Update reminders disabled until a valid version is reported."}
              </p>
            </div>
            <div className="flex gap-2">
              {selected.status === "unknown" ? (
                <button type="button" disabled={busyKey !== "" || !selected.members.some((member) => member.canReceiveEmail)} onClick={() => void sendAllInstall()} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-700 dark:text-amber-300">
                  <Send className="h-3.5 w-3.5" /> Email install instructions
                </button>
              ) : null}
              <button type="button" disabled={selected.status !== "outdated" || busyKey !== "" || !selected.members.some((member) => member.supportsAgentInbox)} onClick={() => void sendAll("app")} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-600">
                <Bell className="h-3.5 w-3.5" /> Notify all in app
              </button>
              <button type="button" disabled={selected.status !== "outdated" || busyKey !== "" || !selected.members.some((member) => member.canReceiveEmail)} onClick={() => void sendAll("email")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200">
                <Mail className="h-3.5 w-3.5" /> Email all
              </button>
            </div>
          </div>
          <div className="max-h-[310px] overflow-auto">
            <table className="w-full min-w-[760px]">
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Member</th><th className="px-3 py-2.5 font-medium">Platform</th><th className="px-3 py-2.5 font-medium">Last opened</th><th className="px-3 py-2.5 text-center font-medium">In app</th><th className="px-3 py-2.5 text-center font-medium">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {selected.members.map((member) => {
                  const updateAllowed = selected.status === "outdated"
                  const appDisabled = !updateAllowed || !member.supportsAgentInbox || busyKey !== ""
                  const emailDisabled = !updateAllowed || !member.canReceiveEmail || busyKey !== ""
                  return (
                    <tr key={member.memberId} className="text-sm text-slate-700 dark:text-slate-200">
                      <td className="px-4 py-3">
                        <span className="block font-medium">{member.displayName}</span>
                        <span className="block text-xs text-slate-400">{member.email || "No email"}</span>
                        {member.needsManualReinstall ? (
                          <span
                            title="This tracker is too old to update itself. It receives no updates until it is reinstalled from the download page."
                            className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                          >
                            Needs reinstall
                          </span>
                        ) : null}
                        {/* Shown only alongside a current version: an agent that already
                            needs a reinstall is stuck for the older, louder reason, and two
                            badges would just compete. */}
                        {!member.needsManualReinstall && member.updateBlocked === true ? (
                          <span
                            title={`This tracker downloads updates but cannot install them: ${member.agentInstallDir || "its install folder"} is not writable by the person running it. It needs an administrator, or a reinstall for that user.`}
                            className="mt-1 inline-block rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                          >
                            Cannot install updates
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 capitalize">{member.agentPlatform || "—"}</td>
                      <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{formatOpened(member.agentLastOpenedAt)}</td>
                      <td className="px-3 py-3 text-center"><button type="button" title={!updateAllowed ? "A valid outdated version is required" : !member.supportsAgentInbox ? "This tracker version cannot receive in-app notifications" : "Send in-app reminder"} disabled={appDisabled} onClick={() => void sendOne(member, "app")} className="rounded-full p-2 text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"><Bell className="h-4 w-4" /></button></td>
                      <td className="px-3 py-3 text-center">
                        {selected.status === "unknown" ? (
                          <button type="button" title="Send latest-app install instructions" disabled={!member.canReceiveEmail || busyKey !== ""} onClick={() => void sendInstall(member)} className="rounded-full p-2 text-amber-600 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-30 dark:text-amber-400 dark:hover:bg-amber-950/50"><Send className="h-4 w-4" /></button>
                        ) : selected.status === "unrecognized" ? (
                          <span className="text-xs text-slate-400" title="Ask the member to reopen or reinstall the tracker">Needs new report</span>
                        ) : (
                          <button type="button" title={!updateAllowed ? "Member already uses latest version" : !member.canReceiveEmail ? "No deliverable email" : "Send email reminder"} disabled={emailDisabled} onClick={() => void sendOne(member, "email")} className="rounded-full p-2 text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"><Mail className="h-4 w-4" /></button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {!selected.members.length ? <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-500">No members reported this version.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><TriangleAlert className="h-4 w-4" /> No tracker version data.</div>
      )}
      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><CheckCircle2 className="h-3.5 w-3.5" /> Unknown versions never receive update reminders; install instructions are a separate email.</p>
    </div>
  )
}
