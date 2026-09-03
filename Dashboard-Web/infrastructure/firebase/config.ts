import { deleteApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app"
import { getAuth, signOut, type Auth } from "firebase/auth"
import { clearFirebaseWebConfigCache, fetchFirebaseWebConfigFromBackend } from "@/features/auth/services/backend-config"

let app: FirebaseApp | null = null
let authInstance: Auth | null = null
let initPromise: Promise<FirebaseApp> | null = null

export async function resetFirebaseClient(): Promise<void> {
  if (authInstance) {
    try {
      await signOut(authInstance)
    } catch {
      /* already signed out */
    }
  }
  const toDelete = app ?? getApps()[0]
  if (toDelete) {
    try {
      await deleteApp(toDelete)
    } catch {
      /* ignore */
    }
  }
  app = null
  authInstance = null
  initPromise = null
  clearFirebaseWebConfigCache()
}

export async function initFirebase(): Promise<FirebaseApp> {
  if (app) return app
  if (initPromise) return initPromise
  initPromise = (async () => {
    const config: FirebaseOptions = await fetchFirebaseWebConfigFromBackend()
    const existing = getApps()[0]
    if (existing) {
      const existingProject = existing.options.projectId ?? ""
      const nextProject = config.projectId ?? ""
      if (existingProject && nextProject && existingProject !== nextProject) {
        await resetFirebaseClient()
        app = initializeApp(config)
      } else {
        app = existing
      }
    } else {
      app = initializeApp(config)
    }
    authInstance = getAuth(app)
    return app
  })()
  return initPromise
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    throw new Error("initFirebase() has not completed yet")
  }
  return authInstance
}
