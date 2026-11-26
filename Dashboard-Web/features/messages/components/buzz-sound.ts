import type { LiveBuzzMessage } from "@/features/auth/services/presence-ws"

/**
 * The sound a buzz makes in the browser: a short electric "bzzt-bzzt" for a nudge, a lower,
 * longer drone for the blue screen. Made with the Web Audio API, so there is no sound file to
 * load.
 *
 * Browsers only let a page make sound after the person has clicked or typed on it at least once
 * (autoplay rules). Anyone who has used the dashboard has; if not, the browser keeps it silent
 * and the buzz still shows.
 *
 * Every open dashboard tab receives the same buzz, so the tabs agree on one of them to play it
 * (claimSound) - otherwise three tabs would buzz three times at once.
 */

const VOLUME = 0.12
const CLAIM_PREFIX = "vt-buzz-sound:"
/** How long the tabs wait before checking who won the claim. */
const CLAIM_SETTLE_MS = 60
/** Claims older than this are cleaned up. */
const CLAIM_KEEP_MS = 60_000

let context: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!context) context = new Ctor()
  return context
}

/** One buzzing tone: a square wave with a fast tremolo, so it rasps rather than beeps. */
function tone(ctx: AudioContext, start: number, length: number, frequency: number) {
  const osc = ctx.createOscillator()
  osc.type = "square"
  osc.frequency.value = frequency

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(VOLUME, start + 0.015)
  gain.gain.setValueAtTime(VOLUME, start + length - 0.04)
  gain.gain.linearRampToValueAtTime(0, start + length)

  const tremolo = ctx.createOscillator()
  tremolo.frequency.value = 30
  const tremoloDepth = ctx.createGain()
  tremoloDepth.gain.value = VOLUME * 0.5
  tremolo.connect(tremoloDepth).connect(gain.gain)

  osc.connect(gain).connect(ctx.destination)
  osc.start(start)
  tremolo.start(start)
  osc.stop(start + length)
  tremolo.stop(start + length)
}

/**
 * Whether this tab should play the sound for `buzz`. Each tab writes its own id under the buzz's
 * key unless one is there already, waits a moment, and plays only if its id is the one left.
 * Without storage (private windows can refuse it) the tab just plays.
 */
async function claimSound(buzz: LiveBuzzMessage): Promise<boolean> {
  const key = `${CLAIM_PREFIX}${buzz.at}`
  const mine = Math.random().toString(36).slice(2)
  try {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, mine)
    await new Promise((resolve) => setTimeout(resolve, CLAIM_SETTLE_MS))
    const won = window.localStorage.getItem(key) === mine
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const k = window.localStorage.key(i)
      if (k?.startsWith(CLAIM_PREFIX) && Date.now() - Number(k.slice(CLAIM_PREFIX.length)) > CLAIM_KEEP_MS) {
        window.localStorage.removeItem(k)
      }
    }
    return won
  } catch {
    return true
  }
}

export async function playBuzzSound(buzz: LiveBuzzMessage): Promise<void> {
  if (!(await claimSound(buzz))) return
  const ctx = audioContext()
  if (!ctx) return
  try {
    if (ctx.state === "suspended") await ctx.resume()
    if (ctx.state !== "running") return
    const now = ctx.currentTime + 0.02
    if (buzz.style === "bluescreen") {
      tone(ctx, now, 0.9, 82)
    } else {
      tone(ctx, now, 0.18, 150)
      tone(ctx, now + 0.26, 0.18, 150)
    }
  } catch {
    /* No sound allowed or available - the buzz still shows. */
  }
}
