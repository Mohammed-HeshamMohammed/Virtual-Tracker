const PROJECT_SCOPE_KEY = "vt:activity-project-scope-only"
const SELECTED_MEMBER_PREFIX = "vt:activity-selected-member:"

function readSession(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSession(key: string, value: string): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function removeSession(key: string): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export function readStoredProjectScopeOnly(): boolean {
  return readSession(PROJECT_SCOPE_KEY) === "1"
}

export function writeStoredProjectScopeOnly(value: boolean): void {
  writeSession(PROJECT_SCOPE_KEY, value ? "1" : "0")
}

export function clearStoredProjectScopeOnly(): void {
  removeSession(PROJECT_SCOPE_KEY)
}

export function readStoredSelectedMemberId(viewerMemberId: string | null | undefined): string {
  if (!viewerMemberId) return "all"
  const stored = readSession(`${SELECTED_MEMBER_PREFIX}${viewerMemberId}`)
  return stored && stored.length > 0 ? stored : "all"
}

export function writeStoredSelectedMemberId(viewerMemberId: string | null | undefined, memberId: string): void {
  if (!viewerMemberId) return
  writeSession(`${SELECTED_MEMBER_PREFIX}${viewerMemberId}`, memberId)
}

export function clearStoredSelectedMemberId(viewerMemberId: string | null | undefined): void {
  if (!viewerMemberId) return
  removeSession(`${SELECTED_MEMBER_PREFIX}${viewerMemberId}`)
}

export function clearAllActivityScopePreferences(): void {
  clearStoredProjectScopeOnly()
  if (typeof window === "undefined") return
  try {
    const keysToRemove: string[] = []
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index)
      if (key?.startsWith(SELECTED_MEMBER_PREFIX)) keysToRemove.push(key)
    }
    keysToRemove.forEach((key) => window.sessionStorage.removeItem(key))
  } catch {
    // ignore
  }
}
