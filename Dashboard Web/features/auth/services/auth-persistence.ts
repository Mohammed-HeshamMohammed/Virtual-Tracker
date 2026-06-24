import {
  type Auth,
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
} from "firebase/auth"

/**
 * Controls how long the Firebase session survives in this browser.
 * - `true`: survive browser restarts (local persistence).
 * - `false`: cleared when the tab/window session ends (session persistence).
 */
export async function applyAuthPersistenceRememberMe(auth: Auth, rememberMe: boolean): Promise<void> {
  await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence)
}
