/* eslint-disable react-doctor/exhaustive-deps */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import React, { useState as useComponentState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { useAuth } from "@/shared/providers/app"
import { isValidEmail, validatePassword, validatePhoneField } from "@/shared/validation"
import { validateNamePart } from "@/shared/validation/person-name"
import { usePasswordPolicy } from "@/features/auth/services/password-policy"
import { getAuthStyles } from "@/features/auth/components/style-utils"
import { AuthHeader } from "@/features/auth/components/auth-header"
import { AuthViewportShell } from "@/features/auth/components/auth-gate-shell"
import { RequestAccessCard } from "@/features/auth/components/request-access-card"
import { LoginMainPane } from "@/features/auth/components/login-card/login-main-pane"
import { LoginTroublePane } from "@/features/auth/components/login-card/login-trouble-pane"
import { LoginRecoveryPane } from "@/features/auth/components/login-card/login-recovery-pane"
import { LoginWorkEmailPane } from "@/features/auth/components/login-card/login-work-email-pane"
import { AuthAlertBanner, AuthMotionPane } from "@/features/auth/components/auth-motion"
import { AuthSidePanel, AuthMobileHelperStrip } from "@/features/auth/components/auth-side-panels"
import { AuthEmailHelperPanel, AuthPasswordTipPanel } from "@/features/auth/components/auth-password-tip-panel"
import { EmailVerificationSidePanel } from "@/features/auth/components/email-verification-side-panel"
import { PasswordStrengthPanel } from "@/features/auth/components/password-strength-panel"
import { useRegisterEmailAvailability } from "@/features/auth/services/use-register-email-availability"
import { ServerConnectionOfflineScreen } from "@/features/auth/components/server-connection-offline-screen"
import { EMAIL_VERIFICATION_REQUIRED_MESSAGE } from "@/features/auth/services/email-verification"
import { AgentLinkedSuccessScreen } from "@/features/auth/components/agent-linked-success-screen"
import { DASHBOARD_PATH } from "@/features/auth/services/navigation"

type CardView = "login" | "request"

type LoginPane =
  | "main"
  | "trouble-menu"
  | "forgot-email"
  | "forgot-password"
  | "forgot-work-mail"
  | "work-email"
  | "work-email-code"

const AuthPage: React.FC = () => {
  const { isDark } = useTheme()
  const router = useRouter()
  const {
    initError,
    retryConnection,
    clearAuthError,
    resetAuthGateMessages,
    signInWithGoogle,
    signInWithApple,
    signInWithEmailPassword,
    registerWithEmailPassword,
    sendWorkEmailLink,
    sendPasswordReset,
    verificationGate,
    clearVerificationGate,
    resendVerificationEmail,
    verificationGateMessage,
    verificationGateError,
  } = useAuth()
  const u = getAuthStyles(isDark)
  const { policy: passwordPolicy } = usePasswordPolicy()

  const [cardView, setCardView] = useComponentState<CardView>("login")
  const [loginPane, setLoginPane] = useComponentState<LoginPane>("main")
  const [identifier, setIdentifier] = useComponentState("")
  const [passcode, setPasscode] = useComponentState("")
  const [confirmPasscode, setConfirmPasscode] = useComponentState("")
  const [isRegisterMode, setIsRegisterMode] = useComponentState(false)
  const [registerFirstName, setRegisterFirstName] = useComponentState("")
  const [registerLastName, setRegisterLastName] = useComponentState("")
  const [registerPhone, setRegisterPhone] = useComponentState("")
  const [rememberMe, setRememberMe] = useComponentState(true)
  const [actionBusy, setActionBusy] = useComponentState(false)
  const [workLinkSent, setWorkLinkSent] = useComponentState(false)

  const [recoveryPhone, setRecoveryPhone] = useComponentState("")
  const [recoveryEmail, setRecoveryEmail] = useComponentState("")
  const [recoverSubmitting, setRecoverSubmitting] = useComponentState(false)
  const [recoverNotice, setRecoverNotice] = useComponentState(false)
  const [recoverError, setRecoverError] = useComponentState<string | null>(null)

  const [workEmail, setWorkEmail] = useComponentState("")
  const [workSubmitting, setWorkSubmitting] = useComponentState(false)
  const [loginFormError, setLoginFormError] = useComponentState<string | null>(null)
  const [registerSuccessNotice, setRegisterSuccessNotice] = useComponentState<string | null>(null)
  const [agentLinkedFullPage, setAgentLinkedFullPage] = useComponentState(false)
  const searchParams = useSearchParams()

  useEffect(() => {
    if (searchParams.get("passwordUpdated") !== "1") return
    setRegisterSuccessNotice("Password updated successfully. Sign in with your new password.")
    const url = new URL(window.location.href)
    url.searchParams.delete("passwordUpdated")
    const next = url.pathname + (url.search ? url.search : "")
    window.history.replaceState({}, document.title, next)
  }, [searchParams])

  useEffect(() => {
    if (searchParams.get("signedUp") !== "1") return
    setRegisterSuccessNotice("Account created successfully. Sign in with your email and password.")
    const url = new URL(window.location.href)
    url.searchParams.delete("signedUp")
    const next = url.pathname + (url.search ? url.search : "")
    window.history.replaceState({}, document.title, next)
  }, [searchParams])

  useEffect(() => {
    if (searchParams.get("emailVerified") !== "1") return
    setRegisterSuccessNotice("Email verified successfully. Sign in with your email and password.")
    const url = new URL(window.location.href)
    url.searchParams.delete("emailVerified")
    const next = url.pathname + (url.search ? url.search : "")
    window.history.replaceState({}, document.title, next)
  }, [searchParams])

  // Desktop-agent Google sign-in lands back here from Auth-Backend's
  // /api/auth/google/callback (server-side OAuth flow — see google-oauth.js),
  // not from this page's own sign-in form. Success takes over the whole page
  // (AgentLinkedSuccessScreen) instead of a banner - that screen owns firing
  // the virtualtracker:// deep link and auto-closing this tab.
  useEffect(() => {
    const linked = searchParams.get("agentLinked")
    const linkError = searchParams.get("agentLinkError")
    if (linked !== "1" && !linkError) return
    const url = new URL(window.location.href)
    url.searchParams.delete("agentLinked")
    url.searchParams.delete("agentLinkError")
    window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ""))
    if (linked === "1") {
      setAgentLinkedFullPage(true)
    } else {
      setLoginFormError(
        linkError === "cancelled"
          ? "Google sign-in was cancelled. In the desktop agent, click Sign In and try again."
          : "Could not link the desktop agent. In the desktop agent, click Sign In and try again.",
      )
    }
  }, [searchParams])

  // Desktop-agent deep link (?mode=signup|forgot-password): jump straight to
  // that pane instead of always landing on plain sign-in.
  useEffect(() => {
    const mode = searchParams.get("mode")
    if (mode !== "signup" && mode !== "forgot-password") return
    const url = new URL(window.location.href)
    url.searchParams.delete("mode")
    window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ""))
    if (mode === "signup") {
      setIsRegisterMode(true)
    } else {
      setLoginPane("forgot-password")
    }
  }, [searchParams])

  // Desktop-agent deep link (?provider=google|apple): auto-run that
  // provider's sign-in instead of making the user click it again.
  useEffect(() => {
    const provider = searchParams.get("provider")
    if (provider !== "google" && provider !== "apple") return
    const url = new URL(window.location.href)
    url.searchParams.delete("provider")
    window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ""))
    clearAuthError()
    setActionBusy(true)
    void (async () => {
      try {
        if (provider === "google") {
          await signInWithGoogle(rememberMe)
        } else {
          await signInWithApple(rememberMe)
        }
      } catch {
        // context sets authError
      } finally {
        setActionBusy(false)
      }
    })()
  }, [searchParams])
  const [showPasswordPanel, setShowPasswordPanel] = useComponentState(false)
  const registerEmailAvailability = useRegisterEmailAvailability(identifier, isRegisterMode)

  const showLeftEmailHelper =
    cardView === "login" &&
    loginPane === "main" &&
    isRegisterMode &&
    registerEmailAvailability !== "idle"
  const showLeftPasswordTip =
    cardView === "login" && loginPane === "main" && isRegisterMode && showPasswordPanel
  const showRightVerificationPanel =
    cardView === "login" && loginPane === "main" && !isRegisterMode && Boolean(verificationGate)
  const showVerificationWarning =
    showRightVerificationPanel && !registerSuccessNotice
  const showRightPasswordPanel =
    cardView === "login" && loginPane === "main" && isRegisterMode && showPasswordPanel && !showRightVerificationPanel

  const displayedFormError = loginFormError

  const emailHelperAvailability =
    registerEmailAvailability === "checking"
      ? "checking"
      : registerEmailAvailability === "available"
        ? "available"
        : registerEmailAvailability === "taken"
          ? "taken"
          : "idle"

  async function handleSignIn(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const email = identifier.trim()
    if (!email || !passcode) return
    if (!isValidEmail(email)) {
      setLoginFormError("Enter a valid email address.")
      return
    }
    if (isRegisterMode) {
      if (!registerFirstName.trim()) {
        setLoginFormError("First name is required.")
        return
      }
      if (!registerLastName.trim()) {
        setLoginFormError("Last name is required.")
        return
      }
      const nameValidation =
        validateNamePart(registerFirstName, "First name") ?? validateNamePart(registerLastName, "Last name")
      if (nameValidation) {
        setLoginFormError(nameValidation)
        return
      }
      const phoneValidation = validatePhoneField(registerPhone, { required: true, label: "Phone number" })
      if (phoneValidation) {
        setLoginFormError(phoneValidation)
        return
      }
      const passwordError = validatePassword(passcode, {
        confirmPassword: confirmPasscode,
        requireConfirm: true,
        policy: passwordPolicy.passwordPolicy,
      })
      if (passwordError) {
        setLoginFormError(passwordError)
        return
      }
    }
    setLoginFormError(null)
    setRegisterSuccessNotice(null)
    setActionBusy(true)
    resetAuthGateMessages()
    try {
      if (isRegisterMode) {
        await registerWithEmailPassword(identifier.trim(), passcode, {
          firstName: registerFirstName.trim(),
          lastName: registerLastName.trim(),
          phone: registerPhone.trim(),
          rememberMe,
        })
        setIsRegisterMode(false)
        setShowPasswordPanel(false)
        setRegisterFirstName("")
        setRegisterLastName("")
        setRegisterPhone("")
        setPasscode("")
        setConfirmPasscode("")
        setRegisterSuccessNotice(
          `Account created. We sent a verification email to ${email}. Verify your email, then sign in.`,
        )
      } else {
        await signInWithEmailPassword(identifier.trim(), passcode, rememberMe)
      }
    } catch {
      // authError is set in context
    } finally {
      setActionBusy(false)
    }
  }

  function openRequestAccess(): void {
    resetLoginFlows()
    setCardView("request")
  }

  function goToLoginView(): void {
    setCardView("login")
    resetLoginFlows()
  }

  function resetLoginFlows(): void {
    setLoginPane("main")
    setRecoveryPhone("")
    setRecoveryEmail("")
    setRecoverNotice(false)
    setRecoverError(null)
    setRecoverSubmitting(false)
    setWorkEmail("")
    setWorkSubmitting(false)
    setWorkLinkSent(false)
    setRegisterFirstName("")
    setRegisterLastName("")
    setRegisterPhone("")
    setConfirmPasscode("")
    setLoginFormError(null)
    setRegisterSuccessNotice(null)
  }

  useEffect(() => {
    if (verificationGate && identifier.trim() !== verificationGate.email) {
      clearVerificationGate()
    }
  }, [identifier, verificationGate, clearVerificationGate])

  async function handleRecoverySubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (loginPane === "forgot-password") {
      const email = recoveryEmail.trim()
      if (!email) return
      if (!isValidEmail(email)) {
        setRecoverError("Enter a valid email address.")
        setRecoverNotice(false)
        return
      }
      setRecoverError(null)
      setRecoverNotice(false)
      clearAuthError()
      setRecoverSubmitting(true)
      try {
        await sendPasswordReset(email)
        setRecoverNotice(true)
      } catch (err) {
        setRecoverError(err instanceof Error ? err.message : "Something went wrong. Please try again later.")
      } finally {
        setRecoverSubmitting(false)
      }
      return
    }
    setRecoverSubmitting(true)
    setRecoverNotice(false)
    setTimeout(() => {
      setRecoverSubmitting(false)
      setRecoverNotice(true)
    }, 400)
  }

  async function handleWorkEmailContinue(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const email = workEmail.trim()
    if (!email) return
    if (!isValidEmail(email)) {
      setLoginFormError("Enter a valid work email address.")
      return
    }
    setLoginFormError(null)
    setWorkSubmitting(true)
    clearAuthError()
    try {
      await sendWorkEmailLink(workEmail.trim(), rememberMe)
      setWorkLinkSent(true)
      setLoginPane("work-email-code")
    } catch {
      // context sets authError
    } finally {
      setWorkSubmitting(false)
    }
  }

  if (initError) {
    return <ServerConnectionOfflineScreen error={initError} onRetry={retryConnection} />
  }

  if (agentLinkedFullPage) {
    return <AgentLinkedSuccessScreen onGoToDashboard={() => router.replace(DASHBOARD_PATH)} />
  }

  return (
    <AuthViewportShell
      header={<AuthHeader isDark={isDark} onRequestAccess={openRequestAccess} />}
      mainClassName="px-5 sm:px-6"
    >
        <div className="relative my-auto py-2">
          <AuthSidePanel side="left" visible={cardView === "login" && loginPane === "main" && (showLeftEmailHelper || showLeftPasswordTip)}>
            {showLeftPasswordTip ? (
              <AuthPasswordTipPanel isDark={isDark} styles={u} />
            ) : showLeftEmailHelper ? (
              <AuthEmailHelperPanel isDark={isDark} styles={u} availability={emailHelperAvailability} />
            ) : null}
          </AuthSidePanel>

          <section className="flex w-[452px] max-w-full shrink-0 flex-col">
            <div className={cn("flex w-full flex-col rounded-2xl px-6 pb-5 pt-6 transition-all duration-300 sm:px-7", u.card)}>
              <AuthAlertBanner show={Boolean(registerSuccessNotice)} className="mb-3 overflow-hidden">
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                  {registerSuccessNotice}
                </p>
              </AuthAlertBanner>
              <AuthAlertBanner show={showVerificationWarning} className="mb-3 overflow-hidden">
                <div
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                  role="alert"
                >
                  <p className="font-semibold">Email verification required</p>
                  <p className="mt-1">
                    {verificationGateMessage ?? EMAIL_VERIFICATION_REQUIRED_MESSAGE}
                  </p>
                  {verificationGate?.email ? (
                    <p className="mt-1 font-medium">{verificationGate.email}</p>
                  ) : null}
                  {verificationGateError ? (
                    <p className="mt-1 text-red-700 dark:text-red-400">{verificationGateError}</p>
                  ) : null}
                </div>
              </AuthAlertBanner>
              <AuthAlertBanner show={Boolean(displayedFormError)} className="mb-3 overflow-hidden">
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {displayedFormError}
                </p>
              </AuthAlertBanner>
              <div className="grid grid-cols-1 grid-rows-1">
                <AuthMotionPane isActive={cardView === "login"}>
                  <div className="grid grid-cols-1 grid-rows-1">
                    <LoginMainPane
                      isDark={isDark}
                      isActive={loginPane === "main"}
                        identifier={identifier}
                        setIdentifier={setIdentifier}
                        passcode={passcode}
                        setPasscode={setPasscode}
                        confirmPasscode={confirmPasscode}
                        setConfirmPasscode={setConfirmPasscode}
                        rememberMe={rememberMe}
                        setRememberMe={setRememberMe}
                        isRegisterMode={isRegisterMode}
                        setIsRegisterMode={setIsRegisterMode}
                        registerFirstName={registerFirstName}
                        setRegisterFirstName={setRegisterFirstName}
                        registerLastName={registerLastName}
                        setRegisterLastName={setRegisterLastName}
                        registerPhone={registerPhone}
                        setRegisterPhone={setRegisterPhone}
                        onSelectTrouble={() => setLoginPane("trouble-menu")}
                        onSelectWorkEmail={() => {
                          clearAuthError()
                          setWorkLinkSent(false)
                          setLoginPane("work-email")
                        }}
                        onRequestAccess={openRequestAccess}
                        onSubmit={handleSignIn}
                        actionBusy={actionBusy}
                        clearAuthError={clearAuthError}
                        onGoogleSignIn={() => {
                          clearAuthError()
                          void (async () => {
                            setActionBusy(true)
                            try {
                              await signInWithGoogle(rememberMe)
                            } catch {
                              // context sets error
                            } finally {
                              setActionBusy(false)
                            }
                          })()
                        }}
                        onAppleSignIn={() => {
                          clearAuthError()
                          void (async () => {
                            setActionBusy(true)
                            try {
                              await signInWithApple(rememberMe)
                            } catch {
                              // context sets error
                            } finally {
                              setActionBusy(false)
                            }
                          })()
                        }}
                        registerEmailAvailability={registerEmailAvailability}
                        showPasswordPanel={showPasswordPanel}
                        onPasswordPanelChange={setShowPasswordPanel}
                      />

                      {/* Trouble options menu pane */}
                      <LoginTroublePane
                        isDark={isDark}
                        isActive={loginPane === "trouble-menu"}
                        onSelectOption={(opt) => {
                          setRecoverNotice(false)
                          setRecoverError(null)
                          setLoginPane(opt)
                        }}
                        onBackToSignIn={() => setLoginPane("main")}
                      />

                      {/* Recovery input form pane */}
                      <LoginRecoveryPane
                        isDark={isDark}
                        isActive={
                          loginPane === "forgot-email" ||
                          loginPane === "forgot-password" ||
                          loginPane === "forgot-work-mail"
                        }
                        pane={
                          loginPane === "forgot-email" || loginPane === "forgot-password"
                            ? loginPane
                            : "forgot-work-mail"
                        }
                        recoveryPhone={recoveryPhone}
                        setRecoveryPhone={setRecoveryPhone}
                        recoveryEmail={recoveryEmail}
                        setRecoveryEmail={setRecoveryEmail}
                        onSubmit={handleRecoverySubmit}
                        recoverSubmitting={recoverSubmitting}
                        recoverNotice={recoverNotice}
                        recoverError={recoverError}
                        onBack={() => {
                          setRecoverNotice(false)
                          setRecoverError(null)
                          setLoginPane("trouble-menu")
                        }}
                        clearAuthError={clearAuthError}
                      />

                      {/* Work email input form pane */}
                      <LoginWorkEmailPane
                        isDark={isDark}
                        isActive={
                          loginPane === "work-email" ||
                          loginPane === "work-email-code"
                        }
                        pane={loginPane === "work-email" ? "work-email" : "work-email-code"}
                        workEmail={workEmail}
                        setWorkEmail={setWorkEmail}
                        rememberMe={rememberMe}
                        setRememberMe={setRememberMe}
                        onSubmit={handleWorkEmailContinue}
                        workSubmitting={workSubmitting}
                        workLinkSent={workLinkSent}
                        onResend={() => {
                          void (async () => {
                            if (!workEmail.trim()) return
                            setWorkSubmitting(true)
                            clearAuthError()
                            try {
                              await sendWorkEmailLink(workEmail.trim(), rememberMe)
                              setWorkLinkSent(true)
                            } finally {
                              setWorkSubmitting(false)
                            }
                          })()
                        }}
                        onChangeEmail={() => {
                          clearAuthError()
                          setWorkLinkSent(false)
                          setLoginPane("work-email")
                        }}
                        onBackToSignIn={() => setLoginPane("main")}
                        clearAuthError={clearAuthError}
                      />

                  </div>
                </AuthMotionPane>

                {/* Request Access Card view */}
                <RequestAccessCard
                  isDark={isDark}
                  isActive={cardView === "request"}
                  onBackToLogin={goToLoginView}
                />
              </div>

              <AuthMobileHelperStrip visible={cardView === "login" && loginPane === "main" && showLeftEmailHelper}>
                <AuthEmailHelperPanel isDark={isDark} styles={u} availability={emailHelperAvailability} />
              </AuthMobileHelperStrip>
              <AuthMobileHelperStrip visible={cardView === "login" && loginPane === "main" && showLeftPasswordTip}>
                <AuthPasswordTipPanel isDark={isDark} styles={u} />
              </AuthMobileHelperStrip>
              <AuthMobileHelperStrip visible={showRightVerificationPanel}>
                <EmailVerificationSidePanel
                  isDark={isDark}
                  styles={u}
                  email={verificationGate?.email ?? ""}
                  message={verificationGateMessage}
                  error={verificationGateError}
                  onResend={resendVerificationEmail}
                />
              </AuthMobileHelperStrip>
              <AuthMobileHelperStrip visible={showRightPasswordPanel}>
                <div className={cn("rounded-xl border p-4", u.card)}>
                  <PasswordStrengthPanel
                    password={passcode}
                    confirmPassword={confirmPasscode}
                    visible
                    isDark={isDark}
                    styles={u}
                    compact
                    variant="side"
                  />
                </div>
              </AuthMobileHelperStrip>
            </div>
          </section>

          <AuthSidePanel side="right" visible={showRightVerificationPanel}>
            <EmailVerificationSidePanel
              isDark={isDark}
              styles={u}
              email={verificationGate?.email ?? ""}
              message={verificationGateMessage}
              error={verificationGateError}
              onResend={resendVerificationEmail}
            />
          </AuthSidePanel>

          <AuthSidePanel side="right" visible={showRightPasswordPanel}>
            <div className={cn("rounded-xl border p-4 shadow-lg", u.card, isDark ? "border-[#3d4a3d]/30" : "border-slate-200/80")}>
              <PasswordStrengthPanel
                password={passcode}
                confirmPassword={confirmPasscode}
                visible
                isDark={isDark}
                styles={u}
                compact
                variant="side"
              />
            </div>
          </AuthSidePanel>
        </div>
    </AuthViewportShell>
  )
}

export default AuthPage
