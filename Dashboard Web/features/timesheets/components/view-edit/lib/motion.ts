/** Shared motion presets for the View & Edit review center. */

export const pageTitleEnter = {
  initial: { opacity: 0, y: -12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
} as const

export const sectionHeaderEnter = (delay = 0) => ({
  initial: { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
  transition: { duration: 0.25, delay, ease: [0.22, 1, 0.36, 1] },
})

export const contentEnter = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28, delay, ease: [0.22, 1, 0.36, 1] },
})

export const filterBarEnter = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, delay: 0.08 },
} as const

export const tableContainerEnter = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.26, delay: 0.12 },
} as const

export function rowTransition(index: number) {
  return {
    duration: 0.2,
    delay: Math.min(index * 0.04, 0.24),
    ease: [0.22, 1, 0.36, 1] as const,
  }
}

export const emptyStateEnter = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.25 },
} as const

export const loadingPulse = {
  initial: { opacity: 0.4 },
  animate: { opacity: [0.4, 0.8, 0.4] as number[] },
  transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" as const },
}

export const badgePop = {
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.2, delay: 0.1 },
} as const

export const buttonTap = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.97 },
  transition: { duration: 0.12 },
} as const
