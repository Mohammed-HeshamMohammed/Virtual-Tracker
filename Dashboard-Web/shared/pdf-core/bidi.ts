/**
 * Arabic in a PDF, without a text shaper.
 *
 * jsPDF draws characters left to right exactly as given. Arabic needs two
 * things first: each letter swapped for the form it takes in its word
 * (jsPDF's own `processArabic` does that, in reading order), and the words laid
 * out right to left with any Latin names and numbers kept left to right inside
 * them. This does the second, and hands each Arabic run to the first.
 */

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/
const STRONG_LTR = /[\p{L}\p{N}]/u
/** Digits - Western and Arabic-Indic alike - read left to right even inside Arabic text. */
const NEUTRAL_ARABIC = /[،؛؟٪-٬]/
const DIGIT = /[0-9٠-٩۰-۹]/

export function hasArabic(text: string): boolean {
  return ARABIC.test(text)
}

type Dir = "R" | "L"

const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<", "«": "»", "»": "«" }

function classify(char: string): Dir | null {
  if (DIGIT.test(char)) return "L"
  // Arabic punctuation (percent, decimal and thousands separators, comma,
  // semicolon, question mark) is neutral: it follows the text around it, so
  // "٤٬٩٤٠٫٥٠" stays one left-to-right number.
  if (NEUTRAL_ARABIC.test(char)) return null
  if (ARABIC.test(char)) return "R"
  if (STRONG_LTR.test(char)) return "L"
  return null
}

/** The string to hand jsPDF so it reads correctly once drawn left to right. */
export function visualOrder(text: string, baseRtl: boolean, shape: (run: string) => string): string {
  if (!ARABIC.test(text)) return text

  const chars = [...text]
  const dirs: (Dir | null)[] = chars.map(classify)
  const base: Dir = baseRtl ? "R" : "L"

  // A neutral (space, comma, dash) takes the direction of the text on both
  // sides of it when they agree, and the paragraph's own direction otherwise.
  let i = 0
  while (i < dirs.length) {
    if (dirs[i] !== null) {
      i++
      continue
    }
    let j = i
    while (j < dirs.length && dirs[j] === null) j++
    const before = i > 0 ? dirs[i - 1] : null
    const after = j < dirs.length ? dirs[j] : null
    const resolved: Dir = before && before === after ? before : base
    for (let k = i; k < j; k++) dirs[k] = resolved
    i = j
  }

  const runs: { dir: Dir; text: string }[] = []
  chars.forEach((char, index) => {
    const dir = dirs[index] as Dir
    const last = runs[runs.length - 1]
    if (last && last.dir === dir) last.text += char
    else runs.push({ dir, text: char })
  })

  const ordered = baseRtl ? runs.reverse() : runs
  return ordered
    .map((run) => {
      if (run.dir === "L") return run.text
      const shaped = [...shape(run.text)].reverse()
      return shaped.map((c) => MIRROR[c] ?? c).join("")
    })
    .join("")
}
