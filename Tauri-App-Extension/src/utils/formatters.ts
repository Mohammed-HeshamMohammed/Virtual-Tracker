export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// Sub-hour values need mins/seconds to actually look like they're recording
// (an active task sitting at "0h" for the first 59 minutes reads as broken,
// even though the real number underneath is fine). Right at an hour boundary
// with 0 minutes elapsed, minutes alone would freeze on "Xh 0m" for up to a
// full minute — show seconds there too until the first minute ticks over.
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

// Backend task statuses are free-form strings from whatever project-type
// owns them (todo/in_progress/blocked/on_hold/...) - grade on keywords
// rather than an exact match so an unfamiliar one still lands somewhere
// sane instead of falling through as an error.
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

export function fmtLimitHours(hours: number): string {
  if (!hours || hours <= 0) return "No cap";
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
