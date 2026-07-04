// In-memory cache for GET /api/members/:id/profile (60s SWR, list-cache-registry).
import {
  getFetchPromise,
  getLastFetchTime,
  hasCachedData,
  invalidateCache,
  readCache,
  setFetchPromise,
  writeCache,
} from "@/shared/tables/hooks/list-cache-registry"
import type { Member, MemberManageTab } from "@/features/members/models/member"
import type { MemberProfileForm } from "@/features/members/api/member-api"
import { MANAGE_MODAL_TABS } from "@/features/members/config/members-config"

export const MEMBER_PROFILE_CACHE_STALE_MS = 60_000

const CACHE_KEY_PREFIX = "people-members:profile:"
const ALL_PROFILE_SECTIONS = MANAGE_MODAL_TABS.map((tab) => tab.id)

export type CachedMemberProfile = {
  form: Partial<MemberProfileForm>
  member: Member
  loadedSections: MemberManageTab[]
}

type StoredMemberProfileCache = CachedMemberProfile & {
  loadedSections: MemberManageTab[]
}

function profileCacheKey(memberId: string): string {
  return `${CACHE_KEY_PREFIX}${memberId}`
}

function sectionFetchKey(memberId: string, section: MemberManageTab): string {
  return `${profileCacheKey(memberId)}:${section}`
}

function normalizeLoadedSections(sections?: readonly MemberManageTab[]): MemberManageTab[] {
  if (!sections?.length) return []
  return [...new Set(sections.filter((section) => ALL_PROFILE_SECTIONS.includes(section)))]
}

export function peekMemberProfileCache(memberId: string): CachedMemberProfile | null {
  const cached = readCache<StoredMemberProfileCache>(profileCacheKey(memberId))
  if (!cached) return null
  return {
    ...cached,
    loadedSections: normalizeLoadedSections(cached.loadedSections),
  }
}

export function isMemberProfileSectionLoaded(memberId: string, section: MemberManageTab): boolean {
  const cached = peekMemberProfileCache(memberId)
  if (!cached) return false
  return cached.loadedSections.includes(section)
}

export function isMemberProfileCacheFresh(
  memberId: string,
  staleMs = MEMBER_PROFILE_CACHE_STALE_MS,
): boolean {
  const key = profileCacheKey(memberId)
  if (!hasCachedData(key)) return false
  return Date.now() - getLastFetchTime(key) < staleMs
}

export function isMemberProfileSectionFresh(
  memberId: string,
  section: MemberManageTab,
  staleMs = MEMBER_PROFILE_CACHE_STALE_MS,
): boolean {
  if (!isMemberProfileSectionLoaded(memberId, section)) return false
  const key = sectionFetchKey(memberId, section)
  if (!hasCachedData(key)) {
    return isMemberProfileCacheFresh(memberId, staleMs)
  }
  return Date.now() - getLastFetchTime(key) < staleMs
}

export function writeMemberProfileCache(memberId: string, data: CachedMemberProfile): void {
  writeCache(profileCacheKey(memberId), {
    ...data,
    loadedSections: normalizeLoadedSections(data.loadedSections),
  })
}

export function mergeMemberProfileCache(
  memberId: string,
  partial: {
    form: Partial<MemberProfileForm>
    member: Member
    sections: MemberManageTab[]
  },
): CachedMemberProfile {
  const existing = peekMemberProfileCache(memberId)
  const mergedSections = normalizeLoadedSections([
    ...(existing?.loadedSections ?? []),
    ...partial.sections,
  ])
  const merged: StoredMemberProfileCache = {
    form: { ...(existing?.form ?? {}), ...partial.form },
    member: { ...(existing?.member ?? partial.member), ...partial.member },
    loadedSections: mergedSections,
  }
  writeCache(profileCacheKey(memberId), merged)
  for (const section of partial.sections) {
    writeCache(sectionFetchKey(memberId, section), merged)
  }
  return merged
}

export function invalidateMemberProfileCache(memberId: string): void {
  invalidateCache(profileCacheKey(memberId))
  for (const section of ALL_PROFILE_SECTIONS) {
    invalidateCache(sectionFetchKey(memberId, section))
  }
}

export async function fetchMemberProfileCached(
  memberId: string,
  fetcher: () => Promise<CachedMemberProfile>,
  options: { force?: boolean } = {},
): Promise<CachedMemberProfile> {
  const key = profileCacheKey(memberId)

  if (!options.force && isMemberProfileCacheFresh(memberId)) {
    const cached = readCache<StoredMemberProfileCache>(key)
    if (cached) return cached
  }

  const pending = getFetchPromise(key)
  if (pending) {
    await pending
    const cached = readCache<StoredMemberProfileCache>(key)
    if (cached) return cached
  }

  const fetchTask = fetcher()
    .then((data) => {
      writeMemberProfileCache(memberId, {
        ...data,
        loadedSections: normalizeLoadedSections(data.loadedSections),
      })
    })
    .finally(() => {
      setFetchPromise(key, null)
    })

  setFetchPromise(key, fetchTask)
  await fetchTask

  const result = readCache<StoredMemberProfileCache>(key)
  if (!result) {
    throw new Error("Member profile cache miss after fetch")
  }
  return result
}

export async function fetchMemberProfileSectionCached(
  memberId: string,
  section: MemberManageTab,
  fetcher: () => Promise<{
    form: Partial<MemberProfileForm>
    member: Member
    sections?: MemberManageTab[]
  }>,
  options: { force?: boolean } = {},
): Promise<CachedMemberProfile> {
  if (!options.force && isMemberProfileSectionFresh(memberId, section)) {
    return peekMemberProfileCache(memberId)!
  }

  const key = sectionFetchKey(memberId, section)
  const pending = getFetchPromise(key)
  if (pending) {
    await pending
    const cached = peekMemberProfileCache(memberId)
    if (cached) return cached
  }

  const fetchTask = fetcher()
    .then((data) => {
      mergeMemberProfileCache(memberId, {
        form: data.form,
        member: data.member,
        sections: normalizeLoadedSections(data.sections ?? [section]),
      })
    })
    .finally(() => {
      setFetchPromise(key, null)
    })

  setFetchPromise(key, fetchTask)
  await fetchTask

  const result = peekMemberProfileCache(memberId)
  if (!result) {
    throw new Error("Member profile cache miss after sectional fetch")
  }
  return result
}

/** Fire-and-forget refresh when showing stale cached data. */
export function revalidateMemberProfileCache(
  memberId: string,
  fetcher: () => Promise<CachedMemberProfile>,
): void {
  if (isMemberProfileCacheFresh(memberId)) return
  void fetchMemberProfileCached(memberId, fetcher, { force: true }).catch(() => {
    /* keep stale cache on background failure */
  })
}
