const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value.trim())
}

export function filterValidUuids(ids: string[]): string[] {
  return ids.filter((id) => isValidUuid(id))
}
