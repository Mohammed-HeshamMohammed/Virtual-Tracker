const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isEmailLikeNamePart(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed.includes("@")) return false
  return EMAIL_REGEX.test(trimmed)
}

/** Strips `@` and anything after it so emails cannot be entered in name fields. */
export function sanitizePersonNameInput(value: string): string {
  const atIdx = value.indexOf("@")
  if (atIdx === -1) return value
  return value.slice(0, atIdx)
}

export function validateNamePart(value: string, label: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (isEmailLikeNamePart(trimmed)) return `${label} cannot be an email address.`
  if (trimmed.includes("@")) return `${label} cannot contain @.`
  return null
}
