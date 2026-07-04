import {
  type Auth,
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
} from "firebase/auth"

/** Firebase persistence: local (remember me) vs session-only. */
export async function applyAuthPersistenceRememberMe(auth: Auth, rememberMe: boolean): Promise<void> {
  await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence)
}
