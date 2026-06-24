/** Guards AuthProvider from treating ephemeral Firebase phone-verify sessions as app sign-in. */
let activeSessions = 0

export function beginPhoneVerificationSession(): void {
  activeSessions += 1
}

export function endPhoneVerificationSession(): void {
  activeSessions = Math.max(0, activeSessions - 1)
}

export function isPhoneVerificationSessionActive(): boolean {
  return activeSessions > 0
}
