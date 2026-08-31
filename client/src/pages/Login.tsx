import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "../api";
import { useAuth } from "../AuthContext";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { FieldIcon, OAuthDivider, OAuthNotice, useOAuthNotice } from "../components/AuthForms";
import { ArrowRightIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon } from "../components/icons";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { colors, radius } from "../theme";

// Vendor/admin sign-in — editorial shell (Form System Audit follow-up:
// bring /login and /signin into the same visual language as My Life and
// the For Venues landing page, replacing the older split-screen AuthShell).
// The eyebrow text below deliberately echoes VendorHero.tsx's own "For
// venues & hosts" eyebrow, since this is exactly where that page's CTA
// lands for an already-registered vendor. Stays single-mode (email +
// password, no magic link, no signup-in-place) since vendor accounts are
// approved by an admin after the listing intake form on /vendor/signup,
// not created here.

export function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { notice, trigger } = useOAuthNotice();

  const submit = async () => {
    if (!email || !password) return;
    setError(null);
    setSubmitting(true);
    try {
      const { user } = await login({ email, password });
      await refresh();
      navigate(user.role === "admin" ? "/admin" : "/vendor");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log in");
    } finally {
      setSubmitting(false);
    }
  };

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
        headline={<>Welcome back.<br /><span style={{ color: colors.orange }}>Let's fill your calendar.</span></>}
        subtitle="For vendors and admins — visitors don't need an account."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label htmlFor="login-email" style={labelStyle}>Email</label>
          <div style={{ position: "relative" }}>
            <FieldIcon><MailIcon size={16} /></FieldIcon>
            <input
              id="login-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.ie"
              autoFocus
              autoComplete="email"
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
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              autoComplete="current-password"
              style={{ ...inputStyle, paddingLeft: 38, paddingRight: 40 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 4, color: colors.mutedLight, cursor: "pointer", display: "flex" }}
            >
              {showPassword ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="pop-in" style={{ color: colors.danger, fontSize: 14, margin: 0, background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>
            {error}
          </p>
        )}

        <Button variant="orange" full disabled={submitting || !email || !password} onClick={submit}>
          {submitting ? "Logging in…" : "Log in →"}
        </Button>
      </div>

      <OAuthDivider onClickProvider={trigger} />
      <OAuthNotice notice={notice} />

      <p style={{ textAlign: "center", color: colors.muted, fontSize: 14, marginTop: 24 }}>
        Run a community centre or sports club?{" "}
        <Link to="/vendor/signup" className="link-accent" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5, color: colors.orange, fontWeight: 700 }}>
          List it on Hello Circle <ArrowRightIcon size={14} />
        </Link>
      </p>
    </AuthEditorialShell>
  );
}
