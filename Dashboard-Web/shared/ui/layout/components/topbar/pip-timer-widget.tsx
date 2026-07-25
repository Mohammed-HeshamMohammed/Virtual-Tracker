"use client"

import React from "react"

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const sec = seconds % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

function formatStatus(status: string | null | undefined): string {
  if (!status) return "—"
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function PipTimerWidget({
  activeSeconds,
  taskStatus = null,
  isTimerRunning,
  isDark,
  onStop,
  onStartNow,
  onClose,
  taskName,
}: {
  activeSeconds: number
  taskStatus?: string | null
  isTimerRunning: boolean
  isDark: boolean
  /** Running: stop the session — the desktop agent picks this up on its next poll and stops capturing. */
  onStop: () => void
  /** Not running: starting only happens in the agent, so this just points the user there. */
  onStartNow: () => void
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
            onClick={isTimerRunning ? onStop : onStartNow}
            style={{
              height: 32,
              minWidth: isTimerRunning ? 32 : undefined,
              padding: isTimerRunning ? 0 : "0 12px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
              background: isTimerRunning ? "#ef4444" : "linear-gradient(135deg,#006e2f,#22c55e)",
              boxShadow: isTimerRunning ? "0 4px 14px rgba(239,68,68,0.35)" : "0 4px 14px rgba(34,197,94,0.35)",
            }}
            type="button"
          >
            {isTimerRunning ? (
              "⏹"
            ) : (
              <>
                <span>▶</span>
                <span>Start Now</span>
              </>
            )}
          </button>
        </div>
      </div>

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
