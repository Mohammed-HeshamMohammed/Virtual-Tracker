/**
 * How much an idle-escalation stop may take back.
 *
 * When a member goes idle past the project's allowance the agent stops the timer and rewinds
 * its running total to the last moment there was real input, moving the time since into idle.
 * That is the one legitimate way a stop writes a *lower* active figure than the server holds,
 * so a stop is allowed to decrease (updatePgSession's `allowDecrease`).
 *
 * But what it may take back is bounded by what idle time is: the time between the last input
 * and the moment the allowance ran out - one idle threshold, plus at most a tick or two. An
 * agent that lost track of its last-input point (it starts at 0 each run, and an agent that
 * adopts a session while nobody is at the machine has seen no input yet) rewinds to 0 instead,
 * and the server used to take that at its word: the whole session's hours were erased and the
 * same hours were booked as idle. A day showed zero with nothing anyone did.
 *
 * Anything beyond one threshold plus this slack is not idle time being removed; it is hours
 * being lost, so it is kept.
 */
export const IDLE_REWIND_SLACK_SECONDS = 5 * 60;

/**
 * @param {object} input
 * @param {number} input.storedActive   The session's running total the server holds (earned + seed).
 * @param {number} input.storedIdle     Its idle running total.
 * @param {number} input.incomingActive What the stop reports.
 * @param {number} input.incomingIdle
 * @param {number} input.thresholdSeconds The project's idle allowance for this member.
 * @returns {{ activeSeconds: number, idleSeconds: number, clampedSeconds: number }}
 *   `clampedSeconds` is how much of the rewind was refused (0 for an ordinary stop).
 */
export function guardIdleRewind({ storedActive, storedIdle, incomingActive, incomingIdle, thresholdSeconds }) {
  const stored = Math.max(0, Math.floor(Number(storedActive) || 0));
  const storedIdleTotal = Math.max(0, Math.floor(Number(storedIdle) || 0));
  const active = Math.max(0, Math.floor(Number(incomingActive) || 0));
  const idle = Math.max(0, Math.floor(Number(incomingIdle) || 0));
  const maxRewind = Math.max(0, Math.floor(Number(thresholdSeconds) || 0)) + IDLE_REWIND_SLACK_SECONDS;

  const floor = Math.max(0, stored - maxRewind);
  if (active >= floor) return { activeSeconds: active, idleSeconds: idle, clampedSeconds: 0 };

  // The refused part would have been booked as idle too - take it back out, never below what
  // the server already holds for idle.
  const refused = floor - active;
  return {
    activeSeconds: floor,
    idleSeconds: Math.max(storedIdleTotal, idle - refused),
    clampedSeconds: refused,
  };
}
