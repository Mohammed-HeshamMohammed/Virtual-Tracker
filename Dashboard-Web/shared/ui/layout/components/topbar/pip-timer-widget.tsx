"use client"

import React from "react"

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const sec = seconds % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

function fmtPlanned(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function formatStatus(status: string | null | undefined): string {
  if (!status) return "—"
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function PipTimerWidget({
  activeSeconds,
  idleSeconds = 0,
  progressPercent = null,
  plannedSeconds = null,
  taskStatus = null,
  isTimerRunning,
  isDark,
  onToggle,
  onClose,
  taskName,
}: {
  activeSeconds: number
  idleSeconds?: number
  progressPercent?: number | null
  plannedSeconds?: number | null
  taskStatus?: string | null
  isTimerRunning: boolean
  isDark: boolean
  onToggle: () => void
  onClose: () => void
  taskName: string
}) {
  const bg = isDark ? "#1e2532" : "#ffffff"
  const text = isDark ? "#f1f5f9" : "#0f172a"
  const sub = isDark ? "#94a3b8" : "#64748b"
  const border = isDark ? "#2d3748" : "#e2e8f0"

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        padding: "12px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        fontFamily: "Inter, system-ui, sans-serif",
        boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.5)" : "0 8px 32px rgba(0,0,0,0.12)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: isTimerRunning ? "#22c55e" : "#94a3b8",
                display: "inline-block",
                boxShadow: isTimerRunning ? "0 0 0 0 #22c55e" : "none",
                animation: isTimerRunning ? "pip-pulse 1.5s ease-in-out infinite" : "none",
              }}
            />
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: sub }}>
              {formatStatus(taskStatus)}
            </span>
          </div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: text,
              textAlign: "left",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {taskName}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              fontSize: 28,
              fontWeight: 900,
              fontFamily: "monospace",
              letterSpacing: "-2px",
              color: text,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {fmtDuration(activeSeconds)}
          </span>

          <button
            onClick={onToggle}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isTimerRunning ? "#ef4444" : "linear-gradient(135deg,#006e2f,#22c55e)",
              boxShadow: isTimerRunning ? "0 4px 14px rgba(239,68,68,0.35)" : "0 4px 14px rgba(34,197,94,0.35)",
            }}
            type="button"
          >
            {isTimerRunning ? "⏹" : "▶"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 10, color: sub }}>
        <span>Planned: {fmtPlanned(plannedSeconds)}</span>
        <span>Active: {fmtDuration(activeSeconds)}</span>
        <span>Idle: {fmtDuration(idleSeconds)}</span>
        {progressPercent != null ? <span>Progress: {progressPercent}%</span> : null}
      </div>

      {progressPercent != null ? (
        <div style={{ height: 4, borderRadius: 999, background: isDark ? "#334155" : "#e2e8f0", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(100, progressPercent)}%`, background: "#22c55e", borderRadius: 999 }} />
        </div>
      ) : null}

      <button
        onClick={onClose}
        type="button"
        style={{
          alignSelf: "flex-end",
          border: "none",
          background: "transparent",
          color: sub,
          fontSize: 10,
          cursor: "pointer",
          padding: 0,
        }}
      >
        Close
      </button>

      <style>{`
        @keyframes pip-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.7); }
          50%      { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
        }
      `}</style>
    </div>
  )
}
