/** Portaled pickers (select, searchable select, date) rendered outside Radix dialog content. */
export const FLOATING_MENU_ATTR = "data-floating-menu"

/** Above Radix dialog overlay/content (`z-50`). Must pair with `pointer-events-auto`. */
export const FLOATING_MENU_Z_CLASS = "z-[200]"

export function isFloatingMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(`[${FLOATING_MENU_ATTR}]`))
}
