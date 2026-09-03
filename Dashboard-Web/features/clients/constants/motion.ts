
const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
} as const

const slideUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.22 },
} as const

export const bannerEnterExit = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8, height: 0, marginBottom: 0 },
  transition: { duration: 0.22 },
} as const

function rowTransition(index: number) {
  return {
    duration: 0.18,
    delay: Math.min(index * 0.035, 0.18),
  }
}
