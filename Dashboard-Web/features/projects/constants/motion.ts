
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

export const toolbarEnter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, delay: 0.05 },
} as const

function rowTransition(index: number) {
  return {
    duration: 0.18,
    delay: Math.min(index * 0.035, 0.18),
  }
}

function tabCountTransition(key: string) {
  return {
    key,
    initial: { scale: 0.85, opacity: 0.6 },
    animate: { scale: 1, opacity: 1 },
    transition: { type: "spring" as const, stiffness: 400, damping: 22 },
  }
}
