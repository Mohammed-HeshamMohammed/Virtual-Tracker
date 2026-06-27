/**
 * In-memory presence store (L1). Firebase RTD is the shared live layer when FIREBASE_DATABASE_URL is set.
 *
 * @returns {{
 *   get: (userId: string) => import("./presence-events.js").PresenceRecord | null;
 *   set: (userId: string, record: import("./presence-events.js").PresenceRecord) => void;
 *   delete: (userId: string) => void;
 *   entries: () => Array<[string, import("./presence-events.js").PresenceRecord]>;
 * }}
 */
export function createMemoryPresenceStore() {
  /** @type {Map<string, import("./presence-events.js").PresenceRecord>} */
  const records = new Map();

  return {
    get(userId) {
      return records.get(userId) ?? null;
    },
    set(userId, record) {
      records.set(userId, record);
    },
    delete(userId) {
      records.delete(userId);
    },
    entries() {
      return [...records.entries()];
    },
  };
}
