let suppressNext = false

export function suppressNextAuthStateSync(): void {
  suppressNext = true
}

export function consumeSuppressedAuthStateSync(): boolean {
  if (!suppressNext) return false
  suppressNext = false
  return true
}
