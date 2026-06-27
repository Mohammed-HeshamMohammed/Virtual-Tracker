import { Timestamp } from "firebase-admin/firestore";

const snakeToCamel = (input) => input.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

export function normalizeDoc(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    const normalized = value instanceof Timestamp ? value.toDate().toISOString() : value instanceof Date ? value.toISOString() : value;
    out[key] = normalized;
    const camel = snakeToCamel(key);
    if (camel !== key) out[camel] = normalized;
  }
  return out;
}
