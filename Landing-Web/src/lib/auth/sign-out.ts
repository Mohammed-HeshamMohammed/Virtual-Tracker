import { signOut as firebaseSignOut } from "firebase/auth"
import { getFirebaseAuthClient } from "@/lib/firebase-client"
import { clearSharedSessionCookie } from "@/lib/auth/session-cookie-sync"

export async function signOut(): Promise<void> {
  void clearSharedSessionCookie()
  await firebaseSignOut(getFirebaseAuthClient())
}
