import Redis from "ioredis";
import { getEnv } from "../../config/env.js";

let client = null;
let subscriberClient = null;

export function isRedisConfigured() {
  return Boolean(getEnv().redis.url);
}

export function getRedisClient() {
  const url = getEnv().redis.url;
  if (!url) return null;
  if (!client) {
    client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
    client.on("error", (err) => {
      console.error("[redis] connection error:", err?.message ?? err);
    });
  }
  return client;
}

/**
 * The shared client only when it is connected right now, else null. For callers with an
 * in-memory fallback (the rate limiters): while Redis is down or still connecting, ioredis
 * queues commands and retries them, which would add that wait to every request - better to
 * fall back at once. The first call creates the client, so Redis is used from the first
 * request after it connects.
 */
export function getReadyRedisClient() {
  const redis = getRedisClient();
  return redis?.status === "ready" ? redis : null;
}

export function getRedisSubscriberClient() {
  const url = getEnv().redis.url;
  if (!url) return null;
  if (!subscriberClient) {
    subscriberClient = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
    subscriberClient.on("error", (err) => {
      console.error("[redis/subscriber] connection error:", err?.message ?? err);
    });
  }
  return subscriberClient;
}

export async function __closeRedisForTests() {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
  if (subscriberClient) {
    await subscriberClient.quit().catch(() => {});
    subscriberClient = null;
  }
}
