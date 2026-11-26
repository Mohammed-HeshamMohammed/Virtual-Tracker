import type { LiveBuzzMessage } from "@/features/auth/services/presence-ws"

/**
 * The sound a buzz makes in the browser, chosen by the sender (BUZZ_SOUND_OPTIONS): a short
 * electric buzz made here with the Web Audio API, one of the real recordings in
 * public/sounds/buzz (public domain / CC0 from Wikimedia Commons - see SOURCES.md there), or
 * nothing. A recording plays for at most MAX_RECORDING_SEC and fades out.
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

export type BuzzSound =
  | "buzz"
  | "siren"
  | "missile"
  | "dive"
  | "ship"
  | "alarm-clock"
  | "police"
  | "klaxon"
  | "foghorn"
  | "none"

type Recording = {
  file: string
  /** Where the loudest few seconds start: several recordings open with silence or a wind-up. */
  offset: number
  /** Evens out how loud the recordings are (measured: loudest 4 s brought to the same level). */
  gain: number
}

/** `recording` is a file in public/sounds/buzz; without one the sound is made here. */
export const BUZZ_SOUND_OPTIONS: { value: BuzzSound; label: string; recording?: Recording }[] = [
  { value: "buzz", label: "Buzz" },
  { value: "siren", label: "Nuclear air-raid siren", recording: { file: "siren.mp3", offset: 52, gain: 1.19 } },
  { value: "missile", label: "Missile emergency alarm", recording: { file: "missile.mp3", offset: 8, gain: 0.83 } },
  { value: "dive", label: "Submarine dive klaxon", recording: { file: "dive.mp3", offset: 0, gain: 2.37 } },
  { value: "ship", label: "Ship emergency alarm", recording: { file: "ship.mp3", offset: 14, gain: 0.28 } },
  { value: "alarm-clock", label: "Alarm clock", recording: { file: "alarm-clock.mp3", offset: 0.5, gain: 0.94 } },
  { value: "police", label: "Police siren", recording: { file: "police.mp3", offset: 12.75, gain: 18.88 } },
  { value: "klaxon", label: "Old car klaxon", recording: { file: "klaxon.mp3", offset: 0, gain: 0.98 } },
  { value: "foghorn", label: "Foghorn", recording: { file: "foghorn.mp3", offset: 0.5, gain: 1.1 } },
  { value: "none", label: "No sound" },
]

/** The longest a recording plays, and how long its fade-out takes within that. */
const MAX_RECORDING_SEC = 4
const FADE_SEC = 0.4
/** Overall level of the recordings after evening them out, close to the made-up buzz. */
const RECORDING_VOLUME = 0.6

const decoded = new Map<string, Promise<AudioBuffer | null>>()

/** Loads and decodes a recording once; later buzzes reuse it. */
function loadRecording(ctx: AudioContext, file: string): Promise<AudioBuffer | null> {
  let pending = decoded.get(file)
  if (!pending) {
    pending = fetch(`/sounds/buzz/${file}`)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => {
        decoded.delete(file)
        return null
      })
    decoded.set(file, pending)
  }
  return pending
}

async function playRecording(ctx: AudioContext, recording: Recording) {
  const buffer = await loadRecording(ctx, recording.file)
  if (!buffer) return
  const offset = Math.min(recording.offset, Math.max(0, buffer.duration - 0.5))
  const length = Math.min(buffer.duration - offset, MAX_RECORDING_SEC)
  const level = RECORDING_VOLUME * recording.gain
  const start = ctx.currentTime + 0.02
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(level, start + 0.03)
  gain.gain.setValueAtTime(level, start + Math.max(0.03, length - FADE_SEC))
  gain.gain.linearRampToValueAtTime(0, start + length)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(gain).connect(ctx.destination)
  source.start(start, offset, length)
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

async function play(ctx: AudioContext, sound: BuzzSound, style: LiveBuzzMessage["style"]) {
  const recording = BUZZ_SOUND_OPTIONS.find((o) => o.value === sound)?.recording
  if (recording) {
    await playRecording(ctx, recording)
    return
  }
  if (sound !== "buzz") return
  const now = ctx.currentTime + 0.02
  if (style === "bluescreen") {
    tone(ctx, now, 0.9, 82)
  } else {
    tone(ctx, now, 0.18, 150)
    tone(ctx, now + 0.26, 0.18, 150)
  }
}

function soundOf(buzz: LiveBuzzMessage): BuzzSound {
  return BUZZ_SOUND_OPTIONS.some((o) => o.value === buzz.sound) ? (buzz.sound as BuzzSound) : "buzz"
}

async function runningContext(): Promise<AudioContext | null> {
  const ctx = audioContext()
  if (!ctx) return null
  if (ctx.state === "suspended") await ctx.resume()
  return ctx.state === "running" ? ctx : null
}

export async function playBuzzSound(buzz: LiveBuzzMessage): Promise<void> {
  const sound = soundOf(buzz)
  if (sound === "none") return
  if (!(await claimSound(buzz))) return
  try {
    const ctx = await runningContext()
    if (ctx) await play(ctx, sound, buzz.style)
  } catch {
    /* No sound allowed or available - the buzz still shows. */
  }
}

/** The sender hearing a sound before choosing it (the Buzz dialog's Preview). */
export async function previewBuzzSound(sound: BuzzSound, style: LiveBuzzMessage["style"]): Promise<void> {
  if (sound === "none") return
  try {
    const ctx = await runningContext()
    if (ctx) await play(ctx, sound, style)
  } catch {
    /* ignore */
  }
}
