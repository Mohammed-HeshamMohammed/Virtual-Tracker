export const FLOATING_MENU_ATTR = "data-floating-menu"

export const FLOATING_MENU_Z_CLASS = "z-[200]"

export function isFloatingMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(`[${FLOATING_MENU_ATTR}]`))
}
