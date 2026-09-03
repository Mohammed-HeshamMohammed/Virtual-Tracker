export function createMemoryPresenceStore() {
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
