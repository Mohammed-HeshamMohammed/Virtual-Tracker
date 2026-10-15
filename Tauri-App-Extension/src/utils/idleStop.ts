import type { IdleStopInfo } from "../types";

function minutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * The sentence a member reads when the timer stopped for idling. It names the cause and
 * the amount, because "the idle time was removed" with the hours visibly dropping read
 * as minutes vanishing for no reason.
 */
export function describeIdleStop(stop: IdleStopInfo | null | undefined): string {
  if (!stop) {
    return "Timer stopped after being idle longer than this project allows. Press Start to carry on.";
  }
  const idle = plural(minutes(stop.idleSeconds), "minute");
  const allowance = plural(minutes(stop.allowanceSeconds), "minute");
  const moved =
    stop.movedSeconds >= 60
      ? ` ${plural(Math.floor(stop.movedSeconds / 60), "minute")} of it moved from worked time to idle.`
      : "";
  return `Timer stopped: no mouse or keyboard for ${idle}, and this project allows ${allowance}.${moved} Press Start to carry on.`;
}
