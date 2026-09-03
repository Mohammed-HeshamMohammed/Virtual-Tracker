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
