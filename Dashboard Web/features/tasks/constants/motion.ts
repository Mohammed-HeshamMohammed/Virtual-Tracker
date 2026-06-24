/** Shared motion presets for the tasks feature. */

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
} as const

export const toolbarEnter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, delay: 0.05 },
} as const

export const viewSwitch = {
  initial: { opacity: 0, x: 10 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -10 },
  transition: { duration: 0.2 },
} as const

export function rowTransition(index: number) {
  return {
    duration: 0.18,
    delay: Math.min(index * 0.035, 0.18),
  }
}
