export function resolveEmailFromUserRecord(userRecord) {
  const direct = typeof userRecord.email === "string" ? userRecord.email.trim() : "";
  if (direct) return direct;

  const providers = Array.isArray(userRecord.providerData) ? userRecord.providerData : [];
  for (const p of providers) {
    const em = typeof p.email === "string" ? p.email.trim() : "";
    if (em) return em;
  }

  return "";
}

export function placeholderEmailForUid(uid) {
  const safe = typeof uid === "string" && uid ? uid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) : "user";
  return `noemail+${safe}@users.virtual-tracker.local`;
}
