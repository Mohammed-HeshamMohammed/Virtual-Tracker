
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

export function extractPresenceFields(memberData) {
  const nested =
    memberData.presence && typeof memberData.presence === "object" && !Array.isArray(memberData.presence)
      ? (memberData.presence)
      : {};

  const last_seen_at = memberData.last_seen_at ?? nested.last_seen_at ?? null;
  const profile_linked_records_at =
    memberData.profile_linked_records_at ?? nested.profile_linked_records_at ?? null;

  return {
    last_seen_at,
    profile_linked_records_at,
  };
}


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
