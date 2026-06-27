/**
 * Presence API shaping — runtime store is source of truth for live status.
 * Database may only retain `last_seen_at` (updated on WebSocket disconnect).
 */

/**
 * @param {unknown} value
 */
export function timestampMs(value) {
  if (!value) return 0;
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Legacy read helper — only `last_seen_at` and bootstrap marker remain on member rows.
 *
 * @param {Record<string, unknown>} memberData
 */
export function extractPresenceFields(memberData) {
  const nested =
    memberData.presence && typeof memberData.presence === "object" && !Array.isArray(memberData.presence)
      ? /** @type {Record<string, unknown>} */ (memberData.presence)
      : {};

  const last_seen_at = memberData.last_seen_at ?? nested.last_seen_at ?? null;
  const profile_linked_records_at =
    memberData.profile_linked_records_at ?? nested.profile_linked_records_at ?? null;

  return {
    last_seen_at,
    profile_linked_records_at,
  };
}

/**
 * @typedef {"online"|"idle"|"offline"} PresenceStatus
 */

/**
 * @param {{
 *   status?: PresenceStatus;
 *   lastSeenAt?: number | null;
 *   lastActivityAt?: number | null;
 * } | null | undefined} runtime
 * @param {Record<string, unknown>} [memberData]
 */
export function resolveEffectivePresence(runtime, memberData = {}) {
  if (runtime?.status === "online" || runtime?.status === "idle" || runtime?.status === "offline") {
    const lastSeenAt =
      runtime.lastSeenAt != null
        ? new Date(runtime.lastSeenAt)
        : memberData.last_seen_at ?? null;
    const lastActivityAt =
      runtime.lastActivityAt != null ? new Date(runtime.lastActivityAt) : lastSeenAt;
    return {
      status: runtime.status,
      trackingStatus: runtime.status,
      lastSeenAt,
      lastActivityAt,
    };
  }

  const fields = extractPresenceFields(memberData);
  return {
    status: "offline",
    trackingStatus: "offline",
    lastSeenAt: fields.last_seen_at,
    lastActivityAt: fields.last_seen_at,
  };
}

/**
 * @param {Record<string, unknown>} memberData
 * @param {{ status?: PresenceStatus; lastSeenAt?: number | null; lastActivityAt?: number | null } | null} [runtime]
 */
export function flattenPresenceForApi(memberData, runtime = null) {
  const fields = extractPresenceFields(memberData);
  const effective = resolveEffectivePresence(runtime, memberData);
  return {
    tracking_status: effective.trackingStatus,
    last_seen_at: effective.lastSeenAt,
    last_activity_at: effective.lastActivityAt,
    last_presence_at: effective.lastSeenAt,
    trackingStatus: effective.trackingStatus,
    status: effective.status,
    profile_linked_records_at: fields.profile_linked_records_at,
  };
}
