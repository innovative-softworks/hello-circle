import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchResidentFull, requestResidentPasswordReset, resetResidentPassword } from "../api";
import { readAuthIntentContext, safeReturnTo } from "../authRedirect";
import { LoginForm, PasswordField } from "../components/AuthForms";
import { AuthContextCard, AuthPhotoPanel, AuthShell } from "../components/AuthShell";
import { PinIcon, ShieldIcon, UsersIcon } from "../components/icons";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors } from "../theme";

// Dedicated resident LOGIN screen — one purpose per screen, no tabs
// (per the auth redesign brief's explicit "do not combine these into
// tabs" rule). Its siblings are separate routes: /signin/create
// (SignUp.tsx) and /signin/email-link (EmailLinkSignIn.tsx). All three
// share the AuthShell split-screen chrome and forward ?returnTo= between
// each other so intent survives switching screens, not just switching
// tabs within one. Login.tsx (/login) is vendor/admin-only and a
// completely separate identity system (req.user, password-only).

const TRUST_ITEMS = [
  { icon: ShieldIcon, title: "Trusted by locals", body: "Real people. Real communities." },
  { icon: UsersIcon, title: "Safe & welcoming", body: "We prioritise your safety." },
  { icon: PinIcon, title: "Always local", body: "Discover what's happening near you." },
];

function TrustRow() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginTop: 36, maxWidth: 400 }}>
      {TRUST_ITEMS.map(({ icon: Icon, title, body }) => (
        <div key={title} style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: "1 1 150px" }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: colors.greenBg, color: colors.greenText, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <Icon size={15} />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.text }}>{title}</div>
            <div style={{ fontSize: 11.5, color: colors.faint, lineHeight: 1.35 }}>{body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
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
      <button onClick={onBack} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.mutedLight, cursor: "pointer", marginBottom: 16 }}>
        ← Back to login
      </button>
      {sent ? (
        <>
          <h1 style={{ fontFamily: "inherit", fontWeight: 800, fontSize: 22, margin: "0 0 8px" }}>Check your email</h1>
          <p style={{ margin: 0, fontSize: 14, color: colors.mutedLight, lineHeight: 1.5 }}>
            If an account exists for <strong>{email.trim()}</strong>, we've sent password reset instructions. The link expires in 30 minutes.
          </p>
        </>
      ) : (
        <>
          <h1 style={{ fontWeight: 800, fontSize: "clamp(24px,2.8vw,30px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Reset your password</h1>
          <p style={{ margin: "0 0 20px", fontSize: 15, color: colors.mutedLight }}>Enter your email address and we'll send you a password reset link.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 340 }}>
            <div>
              <label htmlFor="forgot-email" style={labelStyle}>Email address</label>
              <input id="forgot-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.ie" autoFocus autoComplete="email" style={inputStyle} />
            </div>
            <Button onClick={submit} disabled={busy || !email.trim()} full>{busy ? "Sending…" : "Send reset link →"}</Button>
          </div>
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
  const [done, setDone] = useState(false);

  const submit = async () => {
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
        <h1 style={{ fontWeight: 800, fontSize: 22, margin: "0 0 6px" }}>Password updated ✓</h1>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: colors.mutedLight }}>You're signed in with your new password.</p>
        <Button full onClick={onSuccess}>Continue</Button>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontWeight: 800, fontSize: "clamp(24px,2.8vw,30px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Create a new password</h1>
      <p style={{ margin: "0 0 20px", fontSize: 15, color: colors.mutedLight }}>Choose a new password for your HelloCircle account.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 340 }}>
        <PasswordField id="reset-new-password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Enter new password" />
        <PasswordField id="reset-confirm-password" label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Enter again" />
        <Button full onClick={submit} disabled={busy || !password || !confirm}>{busy ? "…" : "Set password →"}</Button>
      </div>
      {error && <div style={{ color: colors.danger, fontSize: 13, marginTop: 10 }}>{error}</div>}
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

  // Real bug caught by tracing the URL timeline: without this guard, a
  // fresh signup/login raced two independent navigations — this effect
  // (firing the instant `resident` changes from refresh() below) and
  // handleSuccess's own onboarding-aware navigate a beat later — so a brand
  // new account visibly flashed through /bookings before correcting to
  // /onboarding ~35ms after. ownSuccessRef makes handleSuccess the single
  // source of truth for "just signed in on this page": it's set before
  // refresh() runs, so the resulting re-render's effect sees it and skips
  // its own navigate, leaving only handleSuccess's explicit one. The effect
  // still does its real job — bouncing someone already signed in (from an
  // earlier session) who lands on /signin directly.
  const ownSuccessRef = useRef(false);

  useEffect(() => {
    if (!loading && resident && !resetToken && !ownSuccessRef.current) navigate(destination, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, resident, resetToken]);

  const handleSuccess = async () => {
    ownSuccessRef.current = true;
    await refresh();
    // Same "send new/incomplete accounts through onboarding first" behaviour
    // the magic-link verify flow already has (see MyBookings.tsx).
    const full = await fetchResidentFull().catch(() => null);
    navigate(full?.resident && !full.resident.onboardingCompleted ? "/onboarding" : destination);
  };

  const siblingSearch = window.location.search;

  return (
    <AuthShell
      photo={
        <AuthPhotoPanel
          imageSeed="hellocircle-signin-login"
          heading={<>Local communities.<br />Real connections.<br />Things worth doing.</>}
          avatarCaption="Join thousands of people finding their thing, together."
          avatarSeedPrefix="hc-avatar"
        />
      }
    >
      {resetToken ? (
        <ResetPasswordForm token={resetToken} onSuccess={handleSuccess} />
      ) : forgotMode ? (
        <ForgotPasswordForm onBack={() => setForgotMode(false)} />
      ) : (
        <>
          {intentContext && <AuthContextCard context={intentContext} />}
          <h1 style={{ fontWeight: 800, fontSize: "clamp(26px,3vw,32px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>
            Welcome back
          </h1>
          <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 28px" }}>
            {intentContext ? "Log in to continue." : "Log in to continue to your plans, Circles and the things you keep coming back to."}
          </p>
          <LoginForm onSuccess={handleSuccess} onForgotPassword={() => setForgotMode(true)} />

          <p style={{ margin: "20px 0 0", fontSize: 14 }}>
            Don't have an account?{" "}
            <Link to={`/signin/create${siblingSearch}`} style={{ color: colors.green, fontWeight: 700, textDecoration: "none" }}>Create account</Link>
          </p>
          <p style={{ margin: "10px 0 0", fontSize: 14 }}>
            Prefer not to use a password?{" "}
            <Link to={`/signin/email-link${siblingSearch}`} style={{ color: colors.text, fontWeight: 700, textDecoration: "none" }}>Email me a sign-in link →</Link>
          </p>

          <TrustRow />
        </>
      )}
    </AuthShell>
  );
}
