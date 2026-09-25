import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { completeGoogleSignup, googleSignIn, loginWithPassword, requestGuestLink, signupWithPassword } from "../api";
import { AnalyticsEvent, trackTypedEvent } from "../analyticsEvents";
import { currentLocationAsReturnTo } from "../authRedirect";
import { useGoogleSignIn } from "../googleSignIn";
import { AppleIcon, EyeIcon, EyeOffIcon, GoogleIcon, LockIcon, MailIcon, PersonIcon } from "./icons";
import { Button, inputStyle, labelStyle } from "./ui";
import { colors, radius } from "../theme";

// Native <form> semantics (auth UX repair) — every form below submits via a
// real <form onSubmit>, not a per-field onKeyDown, so Enter works from any
// field the way a browser user expects; a disabled submit button (validation
// not yet satisfied, or a request already in flight) correctly blocks
// implicit Enter-submission too, so busy-guards inside each submit()
// function are the only extra protection needed against a double-fire.

/** Focuses a form's error banner the moment it appears (validation failure
 * or a failed submit) — screen-reader and keyboard users otherwise have no
 * signal beyond the visual banner that something needs attention. Only
 * re-fires when the error text itself changes, never on every render, so it
 * doesn't repeatedly steal focus while the person is still reading it. */
export function useFocusOnError(error: string | null): RefObject<HTMLParagraphElement> {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  return ref;
}

// Shared form bodies for every resident authentication surface — the
// dedicated full-page routes (SignIn.tsx / SignUp.tsx / EmailLinkSignIn.tsx)
// and the contextual JoinAuthModal (Games.tsx, via SignInPanel). No tabs:
// each form is a single-purpose screen: log in, create account, or email
// link — never combined. Google is wired to real Firebase-verified sign-in
// (see ../googleSignIn.ts); Apple remains visual-only (no OAuth provider
// wired up server-side) — clicking it shows an inline "coming soon" notice.

// Shared error box — same dangerBg/role="alert" treatment as every other
// auth screen (Login.tsx, ForgotPassword.tsx, ResetPassword.tsx,
// AcceptInvite.tsx, GuidedFlow.tsx) — these three forms were the one place
// still showing a bare colored line instead (consistency pass).
//
// `id` lets a field's aria-describedby point back at this exact element
// (accessible form-level error, since this app's validation is per-form/
// per-step rather than per-field); `innerRef` + tabIndex=-1 let
// useFocusOnError move keyboard/screen-reader focus onto it the moment it
// appears, without making it a normal tab stop otherwise.
export function AuthFormError({ message, id, innerRef }: { message: string; id?: string; innerRef?: RefObject<HTMLParagraphElement> }) {
  return (
    <p
      id={id}
      ref={innerRef}
      tabIndex={-1}
      role="alert"
      className="pop-in"
      style={{ color: colors.danger, fontSize: 14, margin: 0, background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control, outline: "none" }}
    >
      {message}
    </p>
  );
}

/** Shared required/optional checkbox row — the "Complete your HelloCircle
 * account" screen below (required terms) and VendorSignup.tsx (required
 * terms + optional marketing consent, kept as two separate checkboxes per
 * task: "marketing consent must remain optional and separate"). */
export function CheckboxField({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label htmlFor={id} style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", fontSize: 13, color: colors.mutedLight, lineHeight: 1.45 }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, flex: "none", width: 16, height: 16, cursor: "pointer" }}
      />
      <span>{children}</span>
    </label>
  );
}

export function FieldIcon({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: colors.mutedLight, display: "flex", pointerEvents: "none" }}>
      {children}
    </div>
  );
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Set once a submit has failed — this app validates per-form rather than
   * per-field, so this just flags "the form this field belongs to currently
   * has an error", not that this specific field caused it. */
  invalid?: boolean;
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <div style={{ position: "relative" }}>
        <FieldIcon><LockIcon size={16} /></FieldIcon>
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          style={{ ...inputStyle, paddingLeft: 38, paddingRight: 40 }}
        />
        <button
          type="button"
          className="auth-plain-btn"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 4, color: colors.mutedLight, cursor: "pointer", display: "flex" }}
        >
          {visible ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
        </button>
      </div>
    </div>
  );
}

export function OAuthDivider({
  onGoogle,
  googleBusy,
  onApple,
  dividerText = "or continue with",
  googleLabel = "Google",
}: {
  onGoogle: () => void;
  googleBusy: boolean;
  onApple: () => void;
  /** Login.tsx (vendor/admin) overrides this to "or sign in with email" —
   * the shared resident forms keep the generic default. */
  dividerText?: string;
  /** Login.tsx overrides this to "Continue with Google" per the auth UX
   * brief's vendor sign-in copy; the shared resident forms keep the shorter
   * default they've always used. */
  googleLabel?: string;
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 14px" }}>
        <div style={{ flex: 1, height: 1, background: colors.border }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: colors.faint }}>{dividerText}</span>
        <div style={{ flex: 1, height: 1, background: colors.border }} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          className="auth-plain-btn"
          onClick={onGoogle}
          disabled={googleBusy}
          aria-label="Continue with Google"
          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 12px", border: `1px solid ${colors.inputBorder}`, borderRadius: 11, background: colors.surface, fontSize: 13.5, fontWeight: 700, color: colors.text, cursor: googleBusy ? "default" : "pointer", opacity: googleBusy ? 0.7 : 1 }}
        >
          <GoogleIcon size={16} /> {googleBusy ? "Signing in…" : googleLabel}
        </button>
        <button
          type="button"
          className="auth-plain-btn"
          onClick={onApple}
          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 12px", border: `1px solid ${colors.inputBorder}`, borderRadius: 11, background: colors.surface, fontSize: 13.5, fontWeight: 700, color: colors.text, cursor: "pointer" }}
        >
          <AppleIcon size={16} /> Apple
        </button>
      </div>
    </div>
  );
}

export function OAuthNotice({ notice }: { notice: string | null }) {
  if (!notice) return null;
  return (
    <div className="pop-in" role="alert" style={{ marginTop: 14, fontSize: 12.5, color: colors.mutedLight, background: colors.panel, borderRadius: radius.control, padding: "9px 12px" }}>
      {notice}
    </div>
  );
}

/** Apple only now — Google is wired to real sign-in above. */
export function useOAuthNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const trigger = () => setNotice(`Sign-in with Apple is coming soon — use your email for now.`);
  return { notice, trigger };
}

// --- Google: brand-new identity -> "Complete your HelloCircle account" -----
// Firebase has proven the identity by the time this shows; the HelloCircle
// account itself doesn't exist yet (see server/src/routes/guestAuth.ts's
// POST /google — "needs_completion" creates nothing). Cancelling here
// (onCancel) leaves no row behind, so a later attempt just lands back here
// again rather than risking a duplicate.

interface GooglePending {
  idToken: string;
  email: string;
  name: string | null;
}

/** Shared by LoginForm and SignupForm below — either screen's Google button
 * can hit a brand-new identity, and both need identical handling of the
 * three possible outcomes (signed in / needs completion / an existing
 * unlinked account, surfaced as a thrown ApiError by googleSignIn() itself). */
function useResidentGoogleSignIn(onSuccess: () => void | Promise<void>) {
  const [pending, setPending] = useState<GooglePending | null>(null);
  const google = useGoogleSignIn(async (idToken, profile) => {
    const result = await googleSignIn(idToken);
    if (result.status === "needs_completion") {
      setPending({ idToken, email: result.email, name: result.name ?? profile.name });
    } else {
      await onSuccess();
    }
  });
  return { ...google, pending, clearPending: () => setPending(null) };
}

function GoogleCompleteSignup({ pending, onCancel, onSuccess }: { pending: GooglePending; onCancel: () => void; onSuccess: () => void | Promise<void> }) {
  const [name, setName] = useState(pending.name ?? "");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useFocusOnError(error);

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) return setError("Your name is required");
    if (!termsAccepted) return setError("Please accept the Terms to continue");
    setError(null);
    setBusy(true);
    try {
      await completeGoogleSignup(pending.idToken, { name: name.trim(), termsAccepted, marketingConsent });
      trackTypedEvent(AnalyticsEvent.ResidentAccountCreated, { method: "google" });
      await onSuccess();
    } catch (e) {
      trackTypedEvent(AnalyticsEvent.ResidentSignupError, { method: "google", reason: "server" });
      setError(e instanceof Error ? e.message : "Couldn't create your account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 19, fontWeight: 800, margin: "0 0 6px" }}>Complete your HelloCircle account</h2>
      <p style={{ margin: "0 0 18px", fontSize: 13.5, color: colors.mutedLight }}>
        Signed in with Google as <strong>{pending.email}</strong>.
      </p>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); submit(); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label htmlFor="google-complete-name" style={labelStyle}>Display name</label>
          <div style={{ position: "relative" }}>
            <FieldIcon><PersonIcon size={16} /></FieldIcon>
            <input
              id="google-complete-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
              autoComplete="name"
              aria-invalid={!!error}
              aria-describedby={error ? "google-complete-error" : undefined}
              style={{ ...inputStyle, paddingLeft: 38 }}
            />
          </div>
        </div>
        <CheckboxField id="google-complete-terms" checked={termsAccepted} onChange={setTermsAccepted}>
          I agree to HelloCircle's{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: colors.text, fontWeight: 700 }}>Privacy Policy</a> and Terms.
        </CheckboxField>
        <CheckboxField id="google-complete-marketing" checked={marketingConsent} onChange={setMarketingConsent}>
          Send me occasional emails about new features and things happening locally (optional).
        </CheckboxField>
        {error && <AuthFormError id="google-complete-error" innerRef={errorRef} message={error} />}
        <Button type="submit" disabled={busy || !name.trim() || !termsAccepted} full>
          {busy ? "Creating account…" : "Continue →"}
        </Button>
        <button type="button" className="auth-plain-btn" onClick={onCancel} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.mutedLight, cursor: "pointer" }}>
          ← Use a different method
        </button>
      </form>
    </div>
  );
}

// --- Log in (email + password) ----------------------------------------------

export function LoginForm({ onSuccess, onForgotPassword }: { onSuccess: () => void | Promise<void>; onForgotPassword: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useFocusOnError(error);
  const { notice, trigger: triggerApple } = useOAuthNotice();
  const { busy: googleBusy, error: googleError, trigger: triggerGoogle, pending: googlePending, clearPending } = useResidentGoogleSignIn(onSuccess);

  if (googlePending) {
    return <GoogleCompleteSignup pending={googlePending} onCancel={clearPending} onSuccess={onSuccess} />;
  }

  const submit = async () => {
    if (busy || googleBusy) return;
    if (!email.trim() || !password) return;
    setError(null);
    setBusy(true);
    try {
      await loginWithPassword({ email: email.trim(), password });
      await onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log in");
    } finally {
      setBusy(false);
    }
  };

  const describedBy = error ? "login-error" : undefined;

  return (
    <div>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); submit(); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label htmlFor="login-email" style={labelStyle}>Email address</label>
          <div style={{ position: "relative" }}>
            <FieldIcon><MailIcon size={16} /></FieldIcon>
            <input
              id="login-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.ie"
              autoFocus
              autoComplete="email"
              aria-invalid={!!error}
              aria-describedby={describedBy}
              style={{ ...inputStyle, paddingLeft: 38 }}
            />
          </div>
        </div>
        <div>
          <PasswordField id="login-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="Enter your password" invalid={!!error} describedBy={describedBy} />
          <button type="button" className="auth-plain-btn" onClick={onForgotPassword} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer", float: "right", marginTop: 8 }}>
            Forgot password?
          </button>
        </div>
        <div style={{ clear: "both" }} />
        {error && <AuthFormError id="login-error" innerRef={errorRef} message={error} />}
        <Button type="submit" disabled={busy || googleBusy || !email.trim() || !password} full>
          {busy ? "Logging in…" : "Log in →"}
        </Button>
      </form>
      <OAuthDivider onGoogle={triggerGoogle} googleBusy={googleBusy} onApple={triggerApple} />
      {googleError && <div style={{ marginTop: 10 }}><AuthFormError message={googleError} /></div>}
      <OAuthNotice notice={notice} />
    </div>
  );
}

// --- Create account (name + email + password) ------------------------------

export function SignupForm({ onSuccess }: { onSuccess: () => void | Promise<void> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Signup acknowledgement standard (auth UX audit finding C8) — this was
  // previously the one resident signup path with no Terms checkbox at all
  // (just a passive footer line), unlike the Google-completion and vendor
  // signup forms right next to it. Same required-Terms/optional-marketing
  // shape as those two now, and the server enforces termsAccepted too (see
  // routes/guestAuth.ts's POST /guest/signup) rather than trusting this
  // checkbox alone.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useFocusOnError(error);
  const { notice, trigger: triggerApple } = useOAuthNotice();
  const { busy: googleBusy, error: googleError, trigger: triggerGoogle, pending: googlePending, clearPending } = useResidentGoogleSignIn(onSuccess);

  if (googlePending) {
    return <GoogleCompleteSignup pending={googlePending} onCancel={clearPending} onSuccess={onSuccess} />;
  }

  const submit = async () => {
    if (busy || googleBusy) return;
    if (!email.trim() || !password) return;
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (!termsAccepted) {
      setError("Please accept the Terms to continue.");
      return;
    }
    setBusy(true);
    try {
      await signupWithPassword({ name: name.trim(), email: email.trim(), password, termsAccepted, marketingConsent });
      trackTypedEvent(AnalyticsEvent.ResidentAccountCreated, { method: "password" });
      await onSuccess();
    } catch (e) {
      trackTypedEvent(AnalyticsEvent.ResidentSignupError, { method: "password", reason: "server" });
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const describedBy = error ? "signup-error" : undefined;

  return (
    <div>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); submit(); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label htmlFor="signup-name" style={labelStyle}>Full name</label>
          <div style={{ position: "relative" }}>
            <FieldIcon><PersonIcon size={16} /></FieldIcon>
            <input id="signup-name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" autoFocus autoComplete="name" style={{ ...inputStyle, paddingLeft: 38 }} />
          </div>
        </div>
        <div>
          <label htmlFor="signup-email" style={labelStyle}>Email address</label>
          <div style={{ position: "relative" }}>
            <FieldIcon><MailIcon size={16} /></FieldIcon>
            <input
              id="signup-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.ie"
              autoComplete="email"
              aria-invalid={!!error}
              aria-describedby={describedBy}
              style={{ ...inputStyle, paddingLeft: 38 }}
            />
          </div>
        </div>
        <div>
          <PasswordField id="signup-password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Create a password" invalid={!!error} describedBy={describedBy} />
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: colors.faint }}>Use at least 8 characters.</p>
        </div>
        <CheckboxField id="signup-terms" checked={termsAccepted} onChange={setTermsAccepted}>
          I agree to HelloCircle's{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: colors.text, fontWeight: 700 }}>Privacy Policy</a> and Terms.
        </CheckboxField>
        <CheckboxField id="signup-marketing" checked={marketingConsent} onChange={setMarketingConsent}>
          Send me occasional emails about new features and things happening locally (optional).
        </CheckboxField>
        {error && <AuthFormError id="signup-error" innerRef={errorRef} message={error} />}
        <Button type="submit" disabled={busy || googleBusy || !email.trim() || !password || !termsAccepted} full>
          {busy ? "Creating account…" : "Create account →"}
        </Button>
      </form>
      <OAuthDivider onGoogle={triggerGoogle} googleBusy={googleBusy} onApple={triggerApple} />
      {googleError && <div style={{ marginTop: 10 }}><AuthFormError message={googleError} /></div>}
      <OAuthNotice notice={notice} />
    </div>
  );
}

// --- Email me a sign-in link (passwordless) ---------------------------------

/** `returnTo` (onboarding audit F-1): the full-page /signin/email-link route
 * passes its own `?returnTo=` through explicitly; the modal SignInPanel
 * (Games.tsx's "sign in to join") has no such param — for that case this
 * defaults to the current page itself, since a modal never navigates away,
 * so the page underneath IS the thing to return to once the emailed link is
 * clicked from an inbox later. */
export function EmailLinkForm({ returnTo }: { returnTo?: string } = {}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useFocusOnError(error);

  const submit = async () => {
    if (busy) return;
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await requestGuestLink(value, returnTo ?? currentLocationAsReturnTo());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send a sign-in link");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: colors.greenBg, color: colors.greenText, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          <MailIcon size={20} />
        </div>
        <h2 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 8px" }}>Check your email</h2>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: colors.mutedLight, lineHeight: 1.5 }}>
          We've sent a secure sign-in link to <strong>{email.trim()}</strong>. Open it to continue to HelloCircle.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <button type="button" className="auth-plain-btn" onClick={submit} disabled={busy} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.green, cursor: "pointer" }}>
            {busy ? "Sending…" : "Resend email"}
          </button>
          <button type="button" className="auth-plain-btn" onClick={() => setSent(false)} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.mutedLight, cursor: "pointer" }}>
            Use a different email →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 20 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: colors.greenBg, color: colors.greenText, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <MailIcon size={17} />
        </div>
        <div style={{ fontSize: 13.5, color: colors.mutedLight, lineHeight: 1.5, paddingTop: 2 }}>
          We'll send a secure sign-in link straight to your email — no password needed.
        </div>
      </div>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); submit(); }}>
        <label htmlFor="link-email" style={labelStyle}>Email address</label>
        <div style={{ position: "relative" }}>
          <FieldIcon><MailIcon size={16} /></FieldIcon>
          <input
            id="link-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.ie"
            autoFocus
            autoComplete="email"
            aria-invalid={!!error}
            aria-describedby={error ? "email-link-error" : undefined}
            style={{ ...inputStyle, paddingLeft: 38, marginBottom: 12 }}
          />
        </div>
        <Button type="submit" disabled={busy || !email.trim()} full>{busy ? "Sending…" : "Email me a sign-in link →"}</Button>
        {error && <div style={{ marginTop: 10 }}><AuthFormError id="email-link-error" innerRef={errorRef} message={error} /></div>}
      </form>
    </div>
  );
}
