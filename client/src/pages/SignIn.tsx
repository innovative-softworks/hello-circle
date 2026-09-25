import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { requestResidentPasswordReset, resetResidentPassword } from "../api";
import { readAuthIntentContext, safeReturnTo } from "../authRedirect";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { AuthFormError, LoginForm, PasswordField, useFocusOnError } from "../components/AuthForms";
import { AuthContextCard } from "../components/AuthShell";
import { CheckIcon } from "../components/icons";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";

// Dedicated resident LOGIN screen — one purpose per screen, no tabs
// (per the auth redesign brief's explicit "do not combine these into
// tabs" rule). Its siblings are separate routes: /signin/create
// (SignUp.tsx) and /signin/email-link (EmailLinkSignIn.tsx) — all three
// share AuthEditorialShell.tsx (Form System Audit follow-up: bring the
// whole auth family into the same visual language as My Life and the For
// Venues landing page) and forward ?returnTo= between each other so intent
// survives switching screens. Login.tsx (/login) is vendor/admin-only and
// a completely separate identity system (req.user, password-only) — now
// visually unified with this page via the same shell, just with an orange
// accent instead of green.

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (busy) return;
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    try {
      await requestResidentPasswordReset(value);
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="auth-plain-btn" onClick={onBack} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.mutedLight, cursor: "pointer", marginBottom: 16 }}>
        ← Back to login
      </button>
      {sent ? (
        <>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24, letterSpacing: "-.02em", margin: "0 0 8px" }}>Check your email</h1>
          <p style={{ margin: 0, fontSize: 14, color: colors.mutedLight, lineHeight: 1.5 }}>
            If an account exists for <strong>{email.trim()}</strong>, we've sent password reset instructions. The link expires in 30 minutes.
          </p>
        </>
      ) : (
        <>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px,2.8vw,30px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Reset your password</h1>
          <p style={{ margin: "0 0 20px", fontSize: 15, color: colors.mutedLight }}>Enter your email address and we'll send you a password reset link.</p>
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); submit(); }} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 340 }}>
            <div>
              <label htmlFor="forgot-email" style={labelStyle}>Email address</label>
              <input id="forgot-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.ie" autoFocus autoComplete="email" style={inputStyle} />
            </div>
            <Button type="submit" disabled={busy || !email.trim()} full>{busy ? "Sending…" : "Send reset link →"}</Button>
          </form>
        </>
      )}
    </div>
  );
}

function ResetPasswordForm({ token, onSuccess }: { token: string; onSuccess: () => void | Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useFocusOnError(error);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      await resetResidentPassword({ token, password });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reset your password");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24, letterSpacing: "-.02em", margin: "0 0 6px", display: "flex", alignItems: "center", gap: 8 }}>
          Password updated <CheckIcon size={19} style={{ color: colors.greenText }} />
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: colors.mutedLight }}>You're signed in with your new password.</p>
        <Button full onClick={onSuccess}>Continue</Button>
      </div>
    );
  }

  const describedBy = error ? "reset-password-error" : undefined;

  return (
    <div>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px,2.8vw,30px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Create a new password</h1>
      <p style={{ margin: "0 0 20px", fontSize: 15, color: colors.mutedLight }}>Choose a new password for your HelloCircle account.</p>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); submit(); }} style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 340 }}>
        <PasswordField id="reset-new-password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Enter new password" invalid={!!error} describedBy={describedBy} />
        <PasswordField id="reset-confirm-password" label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Enter again" invalid={!!error} describedBy={describedBy} />
        <Button type="submit" full disabled={busy || !password || !confirm}>{busy ? "…" : "Set password →"}</Button>
        {error && <AuthFormError id="reset-password-error" innerRef={errorRef} message={error} />}
      </form>
    </div>
  );
}

export function SignIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { resident, loading, refresh } = useGuest();
  const resetToken = searchParams.get("resetToken");
  const destination = safeReturnTo(searchParams.get("returnTo"));
  const intentContext = readAuthIntentContext(searchParams);
  const [forgotMode, setForgotMode] = useState(false);

  // ownSuccessRef makes handleSuccess the single source of truth for "just
  // signed in on this page": it's set before refresh() runs, so the re-render
  // that refresh() causes doesn't also fire this effect's own navigate and
  // race handleSuccess's. The effect still does its real job — bouncing
  // someone already signed in (from an earlier session) who lands on /signin
  // directly.
  const ownSuccessRef = useRef(false);

  useEffect(() => {
    if (!loading && resident && !resetToken && !ownSuccessRef.current) navigate(destination, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, resident, resetToken]);

  const handleSuccess = async () => {
    ownSuccessRef.current = true;
    await refresh();
    // Onboarding no longer redirects anywhere: AccountSetupGate opens it as a
    // popup over the intended destination, so intent needs no carrying.
    navigate(destination);
  };

  const siblingSearch = window.location.search;

  return (
    <AuthEditorialShell
      heroImage={{
        src: "https://images.unsplash.com/photo-1543269865-cbf427effbad?w=1920&q=75&auto=format&fit=crop",
        alt: "Friends meeting up over coffee",
      }}
      caption={{
        heading: <>Local communities.<br />Real connections.<br />Things worth doing.</>,
        avatarCaption: "Join thousands of people finding their thing, together.",
        avatarSeedPrefix: "hc-avatar",
      }}
    >
      {resetToken ? (
        <ResetPasswordForm token={resetToken} onSuccess={handleSuccess} />
      ) : forgotMode ? (
        <ForgotPasswordForm onBack={() => setForgotMode(false)} />
      ) : (
        <>
          {intentContext && <AuthContextCard context={intentContext} />}
          <AuthEditorialHeader
            eyebrow="Sign in"
            accent="green"
            headline={<>Welcome back.<br /><span style={{ color: colors.green }}>Your life, all in one place.</span></>}
            subtitle={intentContext ? "Log in to continue." : "Log in to continue to your plans, Circles and the things you keep coming back to."}
          />
          <LoginForm onSuccess={handleSuccess} onForgotPassword={() => setForgotMode(true)} />

          <p style={{ margin: "20px 0 0", fontSize: 14 }}>
            Don't have an account?{" "}
            <Link to={`/signin/create${siblingSearch}`} style={{ color: colors.green, fontWeight: 700, textDecoration: "none" }}>Create account</Link>
          </p>
          <p style={{ margin: "10px 0 0", fontSize: 14 }}>
            Prefer not to use a password?{" "}
            <Link to={`/signin/email-link${siblingSearch}`} style={{ color: colors.text, fontWeight: 700, textDecoration: "none" }}>Email me a sign-in link →</Link>
          </p>
        </>
      )}
    </AuthEditorialShell>
  );
}
