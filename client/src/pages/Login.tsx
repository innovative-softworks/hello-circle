import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { googleLogin, login } from "../api";
import { useAuth } from "../AuthContext";
import { safeReturnTo } from "../authRedirect";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { AuthFormError, FieldIcon, OAuthDivider, OAuthNotice, useFocusOnError, useOAuthNotice } from "../components/AuthForms";
import { ArrowRightIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon } from "../components/icons";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { useGoogleSignIn } from "../googleSignIn";
import { colors } from "../theme";

// Vendor/admin sign-in — editorial shell (Form System Audit follow-up:
// bring /login and /signin into the same visual language as My Life and
// the For Venues landing page, replacing the older split-screen AuthShell).
// The eyebrow text below deliberately echoes VendorHero.tsx's own "For
// venues & hosts" eyebrow, since this is exactly where that page's CTA
// lands for an already-registered vendor. Stays single-mode (email +
// password, no magic link, no signup-in-place) since vendor accounts are
// approved by an admin after the listing intake form on /vendor/signup,
// not created here.
//
// Auth UX audit (§5): heading/copy standardized to "Manage your HelloCircle
// business", Google labeled "Continue with Google" here specifically (the
// resident forms keep their shorter default), and — unlike before — this
// screen now reads/honours ?returnTo= the same way SignIn.tsx does, so a
// vendor bounced here by an expired session (see SessionExpiryBanner.tsx) or
// a cold deep link into /vendor lands back where they were, not always the
// dashboard's default tab.

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useFocusOnError(error);
  const [submitting, setSubmitting] = useState(false);
  const { notice, trigger: triggerApple } = useOAuthNotice();

  const destinationFor = (role: "vendor" | "admin") => safeReturnTo(searchParams.get("returnTo"), role === "admin" ? "/admin" : "/vendor");

  // Login only — a Google account with no matching HelloCircle vendor/admin
  // record gets ApiError's server message ("No HelloCircle account found
  // for that Google account…") surfaced here the same way any other failed
  // login would be; see server/src/routes/auth.ts's POST /google.
  const { busy: googleBusy, error: googleError, trigger: triggerGoogle } = useGoogleSignIn(async (idToken) => {
    const { user } = await googleLogin(idToken);
    await refresh();
    navigate(destinationFor(user.role));
  });

  const submit = async () => {
    if (submitting || googleBusy) return;
    if (!email || !password) return;
    setError(null);
    setSubmitting(true);
    try {
      const { user } = await login({ email, password });
      await refresh();
      navigate(destinationFor(user.role));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log in");
    } finally {
      setSubmitting(false);
    }
  };

  const describedBy = error ? "vendor-login-error" : undefined;

  return (
    <AuthEditorialShell
      heroImage={{
        src: "https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=1920&q=75&auto=format&fit=crop",
        alt: "A local five-a-side football match in progress on an outdoor pitch",
      }}
      caption={{
        heading: <>Fill your rooms.<br />Grow your community.<br />Run it your way.</>,
        avatarCaption: "Join hundreds of venues and clubs already listed.",
        avatarSeedPrefix: "hc-vendor-avatar",
      }}
    >
      <AuthEditorialHeader
        eyebrow="For venues & hosts"
        accent="orange"
        headline="Manage your HelloCircle business"
        subtitle="Sign in to manage your venues, activities and bookings."
      />

      <form onSubmit={(e: FormEvent) => { e.preventDefault(); submit(); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label htmlFor="login-email" style={labelStyle}>Email</label>
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
          <label htmlFor="login-password" style={labelStyle}>Password</label>
          <div style={{ position: "relative" }}>
            <FieldIcon><LockIcon size={16} /></FieldIcon>
            <input
              id="login-password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              aria-invalid={!!error}
              aria-describedby={describedBy}
              style={{ ...inputStyle, paddingLeft: 38, paddingRight: 40 }}
            />
            <button
              type="button"
              className="auth-plain-btn"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 4, color: colors.mutedLight, cursor: "pointer", display: "flex" }}
            >
              {showPassword ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
            </button>
          </div>
          <Link
            to="/forgot-password"
            className="link-accent"
            style={{ display: "inline-block", marginTop: 8, fontSize: 13, fontWeight: 700, color: colors.text, textDecoration: "none" }}
          >
            Forgot password?
          </Link>
        </div>

        {error && <AuthFormError id="vendor-login-error" innerRef={errorRef} message={error} />}

        <Button type="submit" variant="orange" full disabled={submitting || googleBusy || !email || !password}>
          {submitting ? "Logging in…" : "Sign in →"}
        </Button>
      </form>

      <OAuthDivider onGoogle={triggerGoogle} googleBusy={googleBusy} onApple={triggerApple} googleLabel="Continue with Google" dividerText="or sign in with email" />
      {/* Explains the existing-account requirement up front (auth UX audit
          §5/§6) — Google here only ever matches an already-registered
          vendor/admin (server/src/routes/auth.ts's POST /google is
          login-only); this makes that explicit before someone without an
          account clicks it and gets a generic error. */}
      <p style={{ margin: "10px 0 0", fontSize: 12, color: colors.muted, textAlign: "center" }}>
        Continue with Google works for an existing HelloCircle business account only.
      </p>
      {googleError && <div style={{ marginTop: 14 }}><AuthFormError message={googleError} /></div>}
      <OAuthNotice notice={notice} />

      <p style={{ textAlign: "center", color: colors.muted, fontSize: 14, marginTop: 24 }}>
        New to HelloCircle as an organiser?{" "}
        <Link to="/vendor/signup" className="link-accent" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5, color: colors.orange, fontWeight: 700 }}>
          Create a business account <ArrowRightIcon size={14} />
        </Link>
      </p>
    </AuthEditorialShell>
  );
}
