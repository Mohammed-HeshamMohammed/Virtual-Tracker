/** Shared modal motion constants - same values as the Client modal's own
 * (features/clients/components/modals/client-modal/client-modal-motion.ts),
 * generalized for use by any modal/panel in the app rather than duplicated
 * per-feature. */
export const MODAL_EASE = [0.22, 1, 0.36, 1] as const

export const MODAL_EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)"

export const MODAL_DURATION = 0.32

export const MODAL_TRANSITION_MS = `${MODAL_DURATION * 1000}ms`

export const MODAL_SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.7 } as const
