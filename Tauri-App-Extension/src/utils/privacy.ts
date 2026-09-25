import type { CaptureStatus, CaptureSummary } from "../types";

export const EMPTY_CAPTURE_STATUS: CaptureStatus = { blocked: false, reason: "", breakUntilMs: 0, issue: "" };

export const BREAK_OPTIONS = [
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
] as const;

/** Polled every few seconds, so an unchanged answer must not become a new
 *  object or the whole app re-renders on each poll for nothing. */
export function sameCaptureStatus(a: CaptureStatus, b: CaptureStatus): boolean {
  return (
    a.blocked === b.blocked && a.reason === b.reason && a.breakUntilMs === b.breakUntilMs && a.issue === b.issue
  );
}

export function isOnBreak(status: CaptureStatus, nowMs: number = Date.now()): boolean {
  return status.breakUntilMs > nowMs;
}

/** "12 min left", rounded up so the last minute never reads as "0 min left". */
export function formatRemaining(untilMs: number, nowMs: number = Date.now()): string {
  const ms = untilMs - nowMs;
  if (ms <= 0) return "";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr left` : `${hours} hr ${rest} min left`;
}

export function canStartBreak(reason: string, busy: boolean): boolean {
  return !busy && reason.trim().length > 0;
}

function count(n: number, singular: string, plural: string = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** One honest line about what exists, so "nothing" reads as nothing rather than as a blank. */
export function describeCollection(summary: CaptureSummary): string {
  const parts = [
    count(summary.screenshots, "screenshot"),
    count(summary.apps, "app"),
    count(summary.domains, "website"),
  ];
  return summary.screenshots + summary.apps + summary.domains === 0
    ? "Nothing has been collected yet today."
    : parts.join(" · ");
}

/** A rule as the member typed it is a poor label for what it does. */
export function exclusionLabel(matchType: string): string {
  return matchType === "domain" ? "Website" : "App";
}
