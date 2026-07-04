import Redis from "ioredis";
import { getEnv } from "../../config/env.js";

/** @type {import("ioredis").Redis | null} */
let client = null;
/** @type {import("ioredis").Redis | null} */
let subscriberClient = null;

/**
 * @returns {boolean}
 */
export function isRedisConfigured() {
  return Boolean(getEnv().redis.url);
}

/**
 * Shared connection for commands (GET/SET/PUBLISH/…).
 * @returns {import("ioredis").Redis | null}
 */
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

/** Separate Redis connection for SUBSCRIBE (can't mix with regular commands). */
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

/** @internal Tests only */
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
