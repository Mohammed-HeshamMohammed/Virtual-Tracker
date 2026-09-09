import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app"
import { getAuth, type Auth } from "firebase/auth"
import { apiPath } from "@/lib/api/url"

let app: FirebaseApp | null = null
let authInstance: Auth | null = null
let initPromise: Promise<FirebaseApp> | null = null
let cachedConfig: FirebaseOptions | null = null

async function fetchFirebaseWebConfig(): Promise<FirebaseOptions> {
  if (cachedConfig) return cachedConfig

  const res = await fetch(apiPath("/api/auth/firebase-config"), { cache: "no-store" })
  const data: unknown = await res.json().catch(() => ({}))
  if (
    !res.ok ||
    !data ||
    typeof data !== "object" ||
    (data as { success?: unknown }).success !== true ||
    typeof (data as { config?: unknown }).config !== "object" ||
    (data as { config: { apiKey?: unknown } }).config.apiKey == null
  ) {
    const message =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`
    throw new Error(message)
  }
  cachedConfig = (data as { config: FirebaseOptions }).config
  return cachedConfig
}

export async function initFirebase(): Promise<FirebaseApp> {
  if (app) return app
  if (initPromise) return initPromise
  initPromise = (async () => {
    const config = await fetchFirebaseWebConfig()
    const existing = getApps()[0]
    app = existing ?? initializeApp(config)
    authInstance = getAuth(app)
    return app
  })()
  return initPromise
}

export function getFirebaseAuthClient(): Auth {
  if (!authInstance) {
    throw new Error("initFirebase() has not completed yet")
  }
  return authInstance
}
