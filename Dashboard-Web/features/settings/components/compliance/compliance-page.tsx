"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Trash2 } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { Toggle } from "@/shared/ui/forms/toggle"
import {
  addCaptureExclusion,
  getActiveDevices,
  getTenantIsolation,
  revokeDevice,
  getCaptureExclusions,
  getMonitoringPolicy,
  getPolicyHealth,
  POLICY_CHANGED_EVENT,
  getRetentionSettings,
  getScreenshotAccessLog,
  removeCaptureExclusion,
  setMonitoringCapability,
  setRetentionDays,
  type CaptureExclusion,
  type MonitoringCapability,
  type RetentionSetting,
  type AgentDevice,
  type IsolationReport,
  type PolicyHealth,
  type ScreenshotAccessEntry,
} from "@/features/settings/api/compliance-api"

const CAPABILITY_LABELS: Record<string, string> = {
  screenshots: "Screenshots",
  app_tracking: "Application tracking",
  url_capture: "URL capture",
  activity_metering: "Activity metering",
  dns_logging: "DNS logging",
  integrity_signals: "Integrity signals",
}

const LAWFUL_BASES = ["legitimate_interest", "consent", "contract"]

const DATA_TYPE_LABELS: Record<string, string> = {
  screenshots: "Screenshots",
  app_logs: "Application logs",
  url_logs: "URL logs",
  sessions: "Sessions",
}

function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key.replace(/_/g, " ")
}

function formatDate(value?: string | null): string {
  if (!value) return ""
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t).toLocaleString() : ""
}

export function CompliancePage() {
  const { isDark } = useTheme()
  const [capabilities, setCapabilities] = useState<MonitoringCapability[]>([])
  const [retention, setRetention] = useState<RetentionSetting[]>([])
  const [exclusions, setExclusions] = useState<CaptureExclusion[]>([])
  const [accessLog, setAccessLog] = useState<ScreenshotAccessEntry[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [devices, setDevices] = useState<AgentDevice[]>([])
  const [isolation, setIsolation] = useState<IsolationReport | null>(null)
  const [health, setHealth] = useState<PolicyHealth | null>(null)
  const [setupBasis, setSetupBasis] = useState("")
  const [setupSkip, setSetupSkip] = useState<Record<string, boolean>>({})
  const [newPattern, setNewPattern] = useState("")
  const [newType, setNewType] = useState("app")

  const load = useCallback(() => {
    setError("")
    Promise.allSettled([
      getMonitoringPolicy(),
      getRetentionSettings(),
      getCaptureExclusions(),
      getScreenshotAccessLog(),
      getActiveDevices(),
      getTenantIsolation(),
      getPolicyHealth(),
    ]).then(([policy, ret, excl, log, devs, iso, hlth]) => {
      if (hlth.status === "fulfilled") setHealth(hlth.value)
      if (devs.status === "fulfilled") setDevices(devs.value)
      if (iso.status === "fulfilled") setIsolation(iso.value)
      if (policy.status === "fulfilled") setCapabilities(policy.value)
      if (ret.status === "fulfilled") setRetention(ret.value)
      if (excl.status === "fulfilled") setExclusions(excl.value)
      if (log.status === "fulfilled") setAccessLog(log.value)
      const failed = [policy, ret, excl, log].find((r) => r.status === "rejected")
      if (failed && failed.status === "rejected") {
        setError(failed.reason instanceof Error ? failed.reason.message : "Some compliance data could not be loaded.")
      }
    })
  }, [])

  useEffect(load, [load])

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    setError("")
    try {
      await fn()
      load()
      window.dispatchEvent(new Event(POLICY_CHANGED_EVENT))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "That change could not be saved.")
    } finally {
      setBusy("")
    }
  }

  const card = cn("rounded-xl border p-4", isDark ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-white")
  const heading = cn("text-sm font-semibold", isDark ? "text-slate-100" : "text-slate-800")
  const hint = cn("text-xs", isDark ? "text-slate-400" : "text-slate-500")
  const input = cn(
    "rounded-lg border px-2 py-1 text-sm",
    isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-700",
  )

  const anyEnforcedOff = capabilities.some((c) => c.enforced && !c.enabled)
  const needing = (health?.capabilities ?? []).filter((c) => c.discarding || c.needsBasis)
  const chosen = needing.filter((c) => !setupSkip[c.capability])

  // One basis for everything chosen: a lawful basis is a recorded decision about
  // why data is collected, so it is picked once, deliberately, before anything
  // is switched on - never defaulted.
  async function enableChosen() {
    if (!setupBasis || !chosen.length) return
    await run("setup", async () => {
      for (const c of chosen) {
        await setMonitoringCapability({ capability: c.capability, enabled: true, lawfulBasis: setupBasis })
      }
    })
  }

  return (
    <div className="space-y-4 p-4">
      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

      {needing.length ? (
        <section className={cn(card, health?.discarding ? "border-amber-400 dark:border-amber-700" : "")}>
          <h3 className={heading}>{health?.discarding ? "Data is being discarded" : "Finish setting up data collection"}</h3>
          <p className={cn("mt-1 mb-3", hint)}>
            {health?.discarding
              ? "Trackers are capturing these, but they are switched off here, so everything that arrives is thrown away."
              : "These are on, but no lawful basis is recorded for them."}{" "}
            Pick why the data is collected, then turn on what you want kept. You can change any of it later.
          </p>
          <ul className="mb-3 space-y-2">
            {needing.map((c) => (
              <li key={c.capability} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id={`setup-${c.capability}`}
                  checked={!setupSkip[c.capability]}
                  onChange={(e) => setSetupSkip((prev) => ({ ...prev, [c.capability]: !e.target.checked }))}
                  className="mt-1"
                />
                <label htmlFor={`setup-${c.capability}`} className="min-w-0">
                  <span className={cn("text-sm", isDark ? "text-slate-200" : "text-slate-700")}>
                    {label(CAPABILITY_LABELS, c.capability)}
                  </span>
                  <span className={cn("block", hint)}>
                    {c.discarding
                      ? `${c.dropped} item${c.dropped === 1 ? "" : "s"} from ${c.members} ${c.members === 1 ? "person" : "people"} discarded in the last ${health?.days} days`
                      : "No lawful basis recorded"}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={setupBasis}
              onChange={(e) => setSetupBasis(e.target.value)}
              aria-label="Lawful basis"
              className={input}
            >
              <option value="">Choose a lawful basis…</option>
              {LAWFUL_BASES.map((b) => (
                <option key={b} value={b}>
                  {label({}, b)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!setupBasis || !chosen.length || busy === "setup"}
              onClick={() => void enableChosen()}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-emerald-600"
            >
              {busy === "setup" ? "Turning on…" : `Turn on ${chosen.length || ""} selected`.replace("  ", " ")}
            </button>
          </div>
          {chosen.length ? (
            <p className={cn("mt-2", hint)}>
              {chosen.some((c) => c.discarding)
                ? "Turning something on changes what your monitoring notice says, so members will be asked to acknowledge it before their next timer."
                : "Recording a basis does not change the notice, so nobody is asked to acknowledge anything again."}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className={card}>
        <h3 className={heading}>What may be collected</h3>
        <p className={cn("mt-1 mb-3", hint)}>
          Switching one off stops that data being stored, for everyone, at the point it arrives. A capability marked
          &ldquo;not enforced&rdquo; is recorded for your policy but nothing reads it yet.
        </p>
        {anyEnforcedOff ? (
          <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Something is switched off. Trackers may still capture it locally, but it will not be stored.
          </p>
        ) : null}
        <ul className="space-y-3">
          {capabilities.map((c) => (
            <li key={c.capability} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={cn("text-sm", isDark ? "text-slate-200" : "text-slate-700")}>
                  {label(CAPABILITY_LABELS, c.capability)}
                  {!c.enforced ? (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      not enforced
                    </span>
                  ) : null}
                </p>
                <p className={hint}>
                  {c.lawfulBasis ? `Basis: ${label({}, c.lawfulBasis)}` : "No lawful basis recorded"}
                  {c.enabledAt ? ` · since ${formatDate(c.enabledAt)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={c.lawfulBasis ?? ""}
                  disabled={busy === c.capability}
                  onChange={(e) =>
                    void run(c.capability, () =>
                      setMonitoringCapability({
                        capability: c.capability,
                        enabled: c.enabled,
                        lawfulBasis: e.target.value || null,
                      }),
                    )
                  }
                  className={input}
                >
                  <option value="">No basis</option>
                  {LAWFUL_BASES.map((b) => (
                    <option key={b} value={b}>
                      {label({}, b)}
                    </option>
                  ))}
                </select>
                {/* Turning one on needs a basis on record. Without this the switch
                    looked live and answered with an error, so it stays inert until
                    one is chosen, and the hint says what to do. */}
                <fieldset
                  disabled={!c.enabled && !c.lawfulBasis}
                  title={!c.enabled && !c.lawfulBasis ? "Choose a lawful basis first" : undefined}
                  className="m-0 border-0 p-0 disabled:opacity-50"
                >
                  <Toggle
                    checked={c.enabled}
                    onChange={(enabled) =>
                      void run(c.capability, () =>
                        setMonitoringCapability({ capability: c.capability, enabled, lawfulBasis: c.lawfulBasis }),
                      )
                    }
                  />
                </fieldset>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h3 className={heading}>How long it is kept</h3>
        <p className={cn("mt-1 mb-3", hint)}>The retention sweep deletes anything older than this.</p>
        <ul className="space-y-2">
          {retention.map((r) => (
            <li key={r.dataType} className="flex items-center justify-between gap-3">
              <span className={cn("text-sm", isDark ? "text-slate-200" : "text-slate-700")}>
                {label(DATA_TYPE_LABELS, r.dataType)}
              </span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  defaultValue={r.retentionDays}
                  disabled={busy === r.dataType}
                  onBlur={(e) => {
                    const days = Number(e.target.value)
                    if (Number.isFinite(days) && days > 0 && days !== r.retentionDays) {
                      void run(r.dataType, () => setRetentionDays(r.dataType, days))
                    }
                  }}
                  className={cn(input, "w-24")}
                />
                <span className={hint}>days</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h3 className={heading}>Never captured</h3>
        <p className={cn("mt-1 mb-3", hint)}>
          Applications and domains excluded for everyone. Members can add their own as well.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select value={newType} onChange={(e) => setNewType(e.target.value)} className={input}>
            <option value="app">Application</option>
            <option value="domain">Domain</option>
          </select>
          <input
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder={newType === "app" ? "e.g. 1password" : "e.g. mybank.com"}
            className={cn(input, "min-w-48 flex-1")}
          />
          <button
            type="button"
            disabled={!newPattern.trim() || busy === "add-exclusion"}
            onClick={() =>
              void run("add-exclusion", async () => {
                await addCaptureExclusion(newType, newPattern.trim())
                setNewPattern("")
              })
            }
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-emerald-600"
          >
            Add
          </button>
        </div>
        <ul className="space-y-1">
          {exclusions.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 text-sm">
              <span className={isDark ? "text-slate-200" : "text-slate-700"}>
                <span className={hint}>{x.matchType}</span> {x.pattern}
              </span>
              <button
                type="button"
                disabled={busy === x.id}
                onClick={() => void run(x.id, () => removeCaptureExclusion(x.id))}
                className="rounded p-1 text-slate-400 hover:text-rose-600"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {!exclusions.length ? <li className={hint}>Nothing excluded.</li> : null}
        </ul>
      </section>

      <section className={card}>
        <h3 className={heading}>Linked devices</h3>
        <p className={cn("mt-1 mb-3", hint)}>
          Every tracker still linked to an account. Archiving or banning a member already revokes theirs — this is for a
          machine that was lost while its owner is still with you. Revoking is not permanent: they can link again.
        </p>
        {devices.length ? (
          <ul className="space-y-1">
            {devices.map((d) => (
              <li key={d.device_id} className="flex items-center justify-between gap-3 text-sm">
                <span className={isDark ? "text-slate-200" : "text-slate-700"}>
                  {d.member_name || d.member_id}
                  <span className={cn("ml-2", hint)}>
                    {d.ownership && d.ownership !== "unspecified" ? `${d.ownership} · ` : ""}
                    last seen {formatDate(d.last_seen_at) || "never"}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy === d.device_id}
                  onClick={() => void run(d.device_id, () => revokeDevice(d.device_id))}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-rose-950/40"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={hint}>No linked devices.</p>
        )}
      </section>

      {isolation ? (
        <section className={card}>
          <h3 className={heading}>Tenant isolation</h3>
          <p className={cn("mt-1 mb-2", hint)}>{isolation.summary}</p>
          {isolation.status !== "enforced" ? (
            <ul className="space-y-1">
              {isolation.reasons.map((r, i) => (
                <li key={i} className={cn("flex items-start gap-2 text-xs", isolation.critical ? "text-rose-600 dark:text-rose-400" : hint)}>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {r}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className={card}>
        <h3 className={heading}>Who viewed screenshots</h3>
        <p className={cn("mt-1 mb-3", hint)}>
          Recorded on every screenshot opened. This is the record you would be asked for if someone challenged how their
          images were used.
        </p>
        {accessLog.length ? (
          <ul className="space-y-1 text-sm">
            {accessLog.slice(0, 50).map((entry, i) => (
              <li key={entry.id ?? i} className={isDark ? "text-slate-200" : "text-slate-700"}>
                {entry.viewerName || entry.viewerId || "Someone"}
                <span className={cn("ml-2", hint)}>{formatDate(entry.accessedAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={hint}>No screenshot views recorded.</p>
        )}
      </section>
    </div>
  )
}
