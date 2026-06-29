export const CLIENT_MODAL_EASE = [0.22, 1, 0.36, 1] as const

export const CLIENT_MODAL_EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)"

export const CLIENT_MODAL_DURATION = 0.32

export const CLIENT_MODAL_FADE = {
  duration: CLIENT_MODAL_DURATION,
  ease: CLIENT_MODAL_EASE,
} as const

export const CLIENT_MODAL_LAYOUT = {
  duration: CLIENT_MODAL_DURATION,
  ease: CLIENT_MODAL_EASE,
} as const

export const CLIENT_MODAL_CROSSFADE = {
  duration: CLIENT_MODAL_DURATION,
  ease: CLIENT_MODAL_EASE,
} as const

export const CLIENT_MODAL_SLIDE_PX = 6

export const CLIENT_MODAL_TRANSITION_MS = `${CLIENT_MODAL_DURATION * 1000}ms`
