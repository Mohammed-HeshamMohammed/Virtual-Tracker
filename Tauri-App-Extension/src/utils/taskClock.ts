/**
 * What the task clock shows when the server's figure for the task arrives.
 *
 * Normally the higher of the two: the clock ticks locally between polls, and a poll that
 * lands a beat before the server catches up must not read as seconds dropping off. Two
 * cases legitimately go lower - a different task was selected, or an idle stop took the
 * stretch with no input back. Keeping the floor through an idle stop showed time the
 * server no longer counts until the task was reselected.
 */
export function nextTaskClockSeconds(
  shown: number,
  server: number,
  { sameTask, idleRewind }: { sameTask: boolean; idleRewind: boolean },
): number {
  if (!sameTask || idleRewind) return server;
  return Math.max(shown, server);
}
