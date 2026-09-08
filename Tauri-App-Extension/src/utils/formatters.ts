export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** "2:02 PM" - current wall-clock time in `timeZone` (the device's own zone
 *  when omitted), 12-hour with AM/PM. `hour: "numeric"` (not "2-digit") is
 *  deliberate: a 12-hour clock reads "2:02 PM", not "02:02 PM" - 2-digit
 *  only makes sense once hour12 is off. Same rule TimezonePicker's
 *  clockOf uses. */
export function fmtWallClock(at: number | Date = Date.now(), timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(at);
  } catch {
    return "--:--";
  }
}

export function fmtHours(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || totalSeconds <= 0) return "0s";
  const total = Math.floor(totalSeconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m === 0 ? `${h}h ${s}s` : `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function initialsFromName(name: string): string {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0]?.[0] || "?").toUpperCase();
}

export function statusTone(status: string, signedIn: boolean): "idle" | "ok" | "live" | "warn" {
  const s = status.toLowerCase();
  if (s.includes("active")) return "live";
  if (s.includes("linking")) return "warn";
  if (signedIn) return "ok";
  return "idle";
}

export function statusLabel(status: string, signedIn: boolean): string {
  const s = status.toLowerCase();
  if (s.includes("active")) return "Tracking";
  if (s.includes("idle") || s.includes("paused")) return "Paused";
  if (s.includes("linking")) return "Linking";
  if (signedIn) return "Ready";
  return "Signed out";
}

export function taskStatusTone(status: string): "neutral" | "good" | "warn" {
  const s = status.toLowerCase();
  if (s.includes("block") || s.includes("hold") || s.includes("stuck") || s.includes("overdue")) return "warn";
  if (s.includes("progress") || s.includes("active") || s.includes("review")) return "good";
  return "neutral";
}

export function taskStatusLabel(status: string): string {
  const trimmed = status.trim();
  if (!trimmed) return "Open";
  return trimmed.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function taskPriorityTone(priority: string): "neutral" | "warn" | "bad" {
  const key = priority.trim().toLowerCase();
  if (key === "urgent" || key === "critical") return "bad";
  if (key === "high") return "warn";
  return "neutral";
}

export function fmtLimitHours(hours: number): string {
  if (!hours || hours <= 0) return "No cap";
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
