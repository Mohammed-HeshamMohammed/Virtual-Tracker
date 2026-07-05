import { type Auth, browserLocalPersistence, browserSessionPersistence, setPersistence } from "firebase/auth"

export async function applyAuthPersistenceRememberMe(auth: Auth, rememberMe: boolean): Promise<void> {
  await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence)
}
