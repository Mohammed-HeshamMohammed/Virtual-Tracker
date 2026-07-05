/**
 * Registration momentarily signs a new user in (to set their profile), then
 * signs them straight back out until they verify their email. Without this
 * flag, `useCurrentUser`'s onAuthStateChanged listener would race that
 * sign-in and attempt a pointless verify+session-bootstrap call.
 */
let suppressNext = false

export function suppressNextAuthStateSync(): void {
  suppressNext = true
}

/** Consumes the flag — true at most once per suppress call. */
export function consumeSuppressedAuthStateSync(): boolean {
  if (!suppressNext) return false
  suppressNext = false
  return true
}
