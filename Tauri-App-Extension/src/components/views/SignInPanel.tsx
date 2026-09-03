import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AuthView, ForgotState, SignUpFields, SignUpState, ThemePreference } from "../../types";
import { TitleBar } from "../common/TitleBar";
import { Icon } from "../common/Icon";

const UPPERCASE_RE = /[A-Z]/;
const LOWERCASE_RE = /[a-z]/;
const NUMBER_RE = /[0-9]/;
const SPECIAL_RE = /[^A-Za-z0-9]/;

const SEQUENTIAL_PATTERNS = [
  "abcdefghijklmnopqrstuvwxyz",
  "zyxwvutsrqponmlkjihgfedcba",
  "0123456789",
  "9876543210",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
];

function hasSimplePattern(password: string): boolean {
  if (!password) return false;
  const lower = password.toLowerCase();
  for (const seq of SEQUENTIAL_PATTERNS) {
    const minChunk = Math.min(6, seq.length);
    for (let len = seq.length; len >= minChunk; len--) {
      for (let i = 0; i <= seq.length - len; i++) {
        const chunk = seq.slice(i, i + len);
        if (chunk.length >= 4 && lower.includes(chunk)) {
          return true;
        }
      }
    }
  }
  if (/(.)\1{5,}/.test(password)) return true;
  if (password.length >= 4 && /^(.)\1+$/.test(password)) return true;
  return false;
}

export function SignInPanel({
  busy,
  actionError,
  signInEmail,
  signInPassword,
  linkPending,
  authView,
  signUp,
  forgot,
  onEmailChange,
  onPasswordChange,
  onPasswordSignIn,
  onSignIn,
  onAuthViewChange,
  onSignUpFieldChange,
  onSignUpSubmit,
  onForgotEmailChange,
  onForgotSubmit,
  onCheckUpdate,
  checkingUpdate,
  theme,
  onCycleTheme,
}: {
  busy: boolean;
  actionError: string | null;
  signInEmail: string;
  signInPassword: string;
  linkPending: boolean;
  authView: AuthView;
  signUp: SignUpState;
  forgot: ForgotState;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onPasswordSignIn: () => void;
  onSignIn: (hint?: string) => void;
  onAuthViewChange: (view: AuthView) => void;
  onSignUpFieldChange: (field: keyof SignUpFields, value: string) => void;
  onSignUpSubmit: () => void;
  onForgotEmailChange: (value: string) => void;
  onForgotSubmit: () => void;
  onCheckUpdate: () => void;
  checkingUpdate: boolean;
  theme?: ThemePreference;
  onCycleTheme?: (next: ThemePreference) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

  const isMinLengthValid = signUp.password.length >= 10;
  const isUppercaseValid = UPPERCASE_RE.test(signUp.password);
  const isLowercaseValid = LOWERCASE_RE.test(signUp.password);
  const isNumberValid = NUMBER_RE.test(signUp.password);
  const isSpecialValid = SPECIAL_RE.test(signUp.password);
  const isNotSimplePatternValid = signUp.password.length > 0 && !hasSimplePattern(signUp.password);
  const isMatchValid = Boolean(
    signUp.password && signUp.confirmPassword && signUp.password === signUp.confirmPassword
  );

  const metCount = [
    isMinLengthValid,
    isUppercaseValid,
    isLowercaseValid,
    isNumberValid,
    isSpecialValid,
    isNotSimplePatternValid,
    isMatchValid,
  ].filter(Boolean).length;
  const strengthTone = metCount <= 3 ? "bad" : metCount < 7 ? "warn" : "good";
  const strengthWord = metCount <= 3 ? "Weak" : metCount < 7 ? "Almost there" : "Strong";

  return (
    <main className="agent-tray view-home">
      <TitleBar
        showBrand={false}
        onClose={() => void invoke("close_window")}
        onCheckUpdate={onCheckUpdate}
        checkingUpdate={checkingUpdate}
        theme={theme}
        onCycleTheme={onCycleTheme}
      />
      <div className="app-body auth-split">
        <section className="auth-brand" aria-hidden="true" data-tauri-drag-region>
          <div className="auth-brand-mark" data-tauri-drag-region>
            <img src="/app-icon.ico" width={36} height={36} alt="" draggable={false} />
            <span data-tauri-drag-region>Virtual Tracker</span>
          </div>

          <div className="auth-brand-copy">
            <h2>Time tracking that stays out of your way.</h2>
            <p>Sign in to link this desktop agent to your account and start tracking your work.</p>

            <div className="auth-brand-features">
              <div className="auth-feature-item">
                <span className="auth-feature-icon">
                  <Icon name="bolt" />
                </span>
                <div>
                  <strong>Instant sync</strong>
                  <p>Real-time sync with the dashboard and your assigned tasks.</p>
                </div>
              </div>
              <div className="auth-feature-item">
                <span className="auth-feature-icon">
                  <Icon name="lock" />
                </span>
                <div>
                  <strong>Private by design</strong>
                  <p>Encrypted device authentication and secure tokens.</p>
                </div>
              </div>
              <div className="auth-feature-item">
                <span className="auth-feature-icon">
                  <Icon name="clock" />
                </span>
                <div>
                  <strong>Counts what's real</strong>
                  <p>Idle time is detected and discounted, never billed.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="auth-brand-viz">
            {Array.from({ length: 16 }, (_, i) => (
              <span key={i} className="auth-brand-bar" style={{ animationDelay: `${i * 0.09}s` }} />
            ))}
          </div>
        </section>

        <section className="auth-form-panel">
          <div className="auth-form-card">
            {authView === "signup" ? (
              <div key="signup" className="auth-form-view">
                <div className="auth-form-head">
                  <h1>Create account</h1>
                  <p>Set up a new Virtual Tracker account</p>
                </div>
                <form
                  className="signin-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSignUpSubmit();
                  }}
                >
                  <div className="auth-back-row">
                    <button className="link-btn" type="button" onClick={() => onAuthViewChange("signin")}>
                      ← Back to sign in
                    </button>
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-first-name">
                      First name
                    </label>
                    <input
                      id="signup-first-name"
                      className="text-input"
                      type="text"
                      autoComplete="given-name"
                      value={signUp.firstName}
                      disabled={signUp.busy}
                      onChange={(e) => onSignUpFieldChange("firstName", e.target.value)}
                    />
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-last-name">
                      Last name
                    </label>
                    <input
                      id="signup-last-name"
                      className="text-input"
                      type="text"
                      autoComplete="family-name"
                      value={signUp.lastName}
                      disabled={signUp.busy}
                      onChange={(e) => onSignUpFieldChange("lastName", e.target.value)}
                    />
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-phone">
                      Phone number
                    </label>
                    <input
                      id="signup-phone"
                      className="text-input"
                      type="tel"
                      autoComplete="tel"
                      value={signUp.phone}
                      disabled={signUp.busy}
                      onChange={(e) => onSignUpFieldChange("phone", e.target.value)}
                    />
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-email">
                      Email address
                    </label>
                    <input
                      id="signup-email"
                      className="text-input"
                      type="email"
                      placeholder="name@company.com"
                      autoComplete="username"
                      spellCheck={false}
                      value={signUp.email}
                      disabled={signUp.busy}
                      onChange={(e) => onSignUpFieldChange("email", e.target.value)}
                    />
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-password">
                      Password
                    </label>
                    <div className="input-wrapper">
                      <input
                        id="signup-password"
                        className="text-input"
                        type={showSignUpPassword ? "text" : "password"}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        value={signUp.password}
                        disabled={signUp.busy}
                        onChange={(e) => onSignUpFieldChange("password", e.target.value)}
                      />
                      <button
                        type="button"
                        className="input-eye-btn"
                        title={showSignUpPassword ? "Hide password" : "Show password"}
                        aria-label={showSignUpPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowSignUpPassword(!showSignUpPassword)}
                      >
                        {showSignUpPassword ? (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signup-confirm-password">
                      Confirm password
                    </label>
                    <input
                      id="signup-confirm-password"
                      className="text-input"
                      type={showSignUpPassword ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      value={signUp.confirmPassword}
                      disabled={signUp.busy}
                      onChange={(e) => onSignUpFieldChange("confirmPassword", e.target.value)}
                    />
                  </div>


                  <div className="pw-rules">
                    <div className="pw-strength">
                      <div className="pw-strength-track">
                        <div
                          className={`pw-strength-fill ${strengthTone}`}
                          style={{ width: `${(metCount / 7) * 100}%` }}
                        />
                      </div>
                      <span className={`pw-strength-word ${strengthTone}`}>{strengthWord}</span>
                    </div>
                    <ul className="pw-rule-list">
                      {[
                        { ok: isMinLengthValid, label: "At least 10 characters" },
                        { ok: isUppercaseValid, label: "An uppercase letter" },
                        { ok: isLowercaseValid, label: "A lowercase letter" },
                        { ok: isNumberValid, label: "A number" },
                        { ok: isSpecialValid, label: "A special character" },
                        { ok: isNotSimplePatternValid, label: "Not a simple pattern" },
                        { ok: isMatchValid, label: "Passwords match" },
                      ].map((r) => (
                        <li key={r.label} className={r.ok ? "ok" : undefined}>
                          <Icon name={r.ok ? "check-filled" : "circle"} />
                          {r.label}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {signUp.error ? (
                    <div className="auth-error-banner">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{signUp.error}</span>
                    </div>
                  ) : null}

                  {signUp.success ? (
                    <div className="auth-success-banner">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span>{signUp.success}</span>
                    </div>
                  ) : null}

                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={
                      signUp.busy ||
                      !signUp.firstName ||
                      !signUp.lastName ||
                      !signUp.phone ||
                      !signUp.email ||
                      !signUp.password ||
                      !signUp.confirmPassword
                    }
                  >
                    {signUp.busy ? "Creating account…" : "Create account"}
                  </button>
                </form>
              </div>
            ) : authView === "forgot" ? (
              <div key="forgot" className="auth-form-view">
                <div className="auth-form-head">
                  <h1>Reset your password</h1>
                  <p>Enter your email and we'll send you a reset link</p>
                </div>
                <form
                  className="signin-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onForgotSubmit();
                  }}
                >
                  <div className="auth-back-row">
                    <button className="link-btn" type="button" onClick={() => onAuthViewChange("signin")}>
                      ← Back to sign in
                    </button>
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="forgot-email">
                      Email address
                    </label>
                    <input
                      id="forgot-email"
                      className="text-input"
                      type="email"
                      placeholder="name@company.com"
                      autoComplete="username"
                      spellCheck={false}
                      value={forgot.email}
                      disabled={forgot.busy}
                      onChange={(e) => onForgotEmailChange(e.target.value)}
                    />
                  </div>

                  {forgot.error ? (
                    <div className="auth-error-banner">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{forgot.error}</span>
                    </div>
                  ) : null}

                  {forgot.success ? (
                    <div className="auth-success-banner">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span>{forgot.success}</span>
                    </div>
                  ) : null}

                  <button className="btn btn-primary" type="submit" disabled={forgot.busy || !forgot.email}>
                    {forgot.busy ? "Sending…" : "Send reset link"}
                  </button>
                </form>
              </div>
            ) : (
              <div key="signin" className="auth-form-view">
                <div className="auth-form-head">
                  <h1>Welcome Back</h1>
                  <p>Sign in to your account to get started</p>
                </div>

                <form
                  className="signin-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onPasswordSignIn();
                  }}
                >
                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signin-email">
                      Email address
                    </label>
                    <input
                      id="signin-email"
                      className="text-input"
                      type="email"
                      placeholder="name@company.com"
                      autoComplete="username"
                      spellCheck={false}
                      value={signInEmail}
                      disabled={busy}
                      onChange={(e) => onEmailChange(e.target.value)}
                    />
                  </div>

                  <div className="input-field-group">
                    <label className="input-field-label" htmlFor="signin-password">
                      Password
                    </label>
                    <div className="input-wrapper">
                      <input
                        id="signin-password"
                        className="text-input"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        value={signInPassword}
                        disabled={busy}
                        onChange={(e) => onPasswordChange(e.target.value)}
                      />
                      <button
                        type="button"
                        className="input-eye-btn"
                        title={showPassword ? "Hide password" : "Show password"}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {actionError ? (
                    <div className="auth-error-banner">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{actionError}</span>
                    </div>
                  ) : null}

                  <button className="btn btn-primary" type="submit" disabled={busy || !signInEmail || !signInPassword}>
                    {busy ? "Signing in…" : "Sign in"}
                  </button>

                  <div className="signin-divider">
                    <span>or continue with</span>
                  </div>

                  <div className="social-row">
                    <button
                      className="btn-icon-social"
                      type="button"
                      title="Continue with Google"
                      aria-label="Continue with Google"
                      disabled={busy}
                      onClick={() => onSignIn("provider=google")}
                    >
                      <svg viewBox="0 0 18 18" aria-hidden="true" width="18" height="18">
                        <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.71v2.25h2.91c1.7-1.56 2.69-3.87 2.69-6.61Z" />
                        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.25c-.8.54-1.83.86-3.05.86-2.35 0-4.34-1.59-5.05-3.73H.95v2.33C2.43 15.98 5.48 18 9 18Z" />
                        <path fill="#FBBC05" d="M3.95 10.7a5.41 5.41 0 0 1 0-3.4V4.97H.95a9 9 0 0 0 0 8.06l3-2.33Z" />
                        <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
                      </svg>
                      Google
                    </button>

                    <button
                      className="btn-icon-social"
                      type="button"
                      title="Continue with Apple"
                      aria-label="Continue with Apple"
                      disabled={busy}
                      onClick={() => onSignIn("provider=apple")}
                    >
                      <svg viewBox="0 0 17 20" aria-hidden="true" width="16" height="19">
                        <path
                          fill="currentColor"
                          d="M13.94 10.6c-.02-2.1 1.72-3.1 1.8-3.15-.98-1.44-2.5-1.63-3.04-1.65-1.3-.13-2.53.76-3.19.76-.66 0-1.68-.75-2.76-.73-1.42.02-2.73.83-3.46 2.1-1.47 2.56-.38 6.35 1.06 8.42.7 1.02 1.53 2.15 2.63 2.11 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.75.66 1.14-.02 1.86-1.03 2.55-2.06.8-1.18 1.13-2.32 1.15-2.38-.03-.01-2.19-.84-2.21-3.4ZM11.86 4.36c.58-.7.97-1.68.86-2.65-.83.03-1.85.56-2.45 1.25-.54.6-1.01 1.6-.88 2.55.93.07 1.88-.47 2.47-1.15Z"
                        />
                      </svg>
                      Apple
                    </button>
                  </div>

                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => onSignIn()}
                  >
                    {linkPending ? "Open link page" : "Link account via browser"}
                  </button>

                  <div className="signin-links">
                    <button className="link-btn" type="button" onClick={() => onAuthViewChange("signup")}>
                      Create account
                    </button>
                    <button className="link-btn" type="button" onClick={() => onAuthViewChange("forgot")}>
                      Forgot password?
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
