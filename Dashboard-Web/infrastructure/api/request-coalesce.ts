/**
 * In-flight request coalescing — avoids duplicate parallel GETs (e.g. React Strict Mode).
 */

const inFlight = new Map<string, Promise<unknown>>();

export function coalesceRequest<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = factory().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export function clearCoalescedRequest(key: string): void {
  inFlight.delete(key);
}
