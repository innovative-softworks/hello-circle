import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "../api";
import { useAuth } from "../AuthContext";
import { FieldIcon, OAuthDivider, OAuthNotice, useOAuthNotice } from "../components/AuthForms";
import { AuthPhotoPanel, AuthShell } from "../components/AuthShell";
import { ArrowRightIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon, PinIcon, ShieldIcon, UsersIcon } from "../components/icons";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { colors, radius } from "../theme";

// Vendor/admin sign-in — same split-screen AuthShell as the resident
// /signin family (real HelloCircle logo, photography column, no header/
// footer chrome) so the two separate identity systems (req.user here vs.
// req.resident there) still feel like one product. Stays single-mode
// (email + password, no magic link, no signup-in-place) since vendor
// accounts are approved by an admin after the listing intake form on
// /vendor/signup, not created here.

const TRUST_ITEMS = [
  { icon: ShieldIcon, title: "Verified listings", body: "Every venue is reviewed before it goes live." },
  { icon: UsersIcon, title: "Built for teams", body: "Invite staff with the right level of access." },
  { icon: PinIcon, title: "Reach your area", body: "Get discovered by residents nearby." },
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
    <AuthShell
      photo={
        <AuthPhotoPanel
          imageSeed="hellocircle-vendor-login"
          heading={<>Fill your rooms.<br />Grow your community.<br />Run it your way.</>}
          avatarCaption="Join hundreds of venues and clubs already listed."
          avatarSeedPrefix="hc-vendor-avatar"
        />
      }
    >
      <h1 style={{ fontWeight: 800, fontSize: "clamp(26px,3vw,32px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>
        Welcome back
      </h1>
      <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 28px" }}>
        For vendors and admins — visitors don't need an account.
      </p>

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
          <p className="pop-in" style={{ color: colors.danger, fontSize: 14, margin: 0, background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>
            {error}
          </p>
        )}

        <Button variant="dark" full disabled={submitting || !email || !password} onClick={submit}>
          {submitting ? "Logging in…" : "Log in →"}
        </Button>
      </div>

      <OAuthDivider onClickProvider={trigger} />
      <OAuthNotice notice={notice} />

      <p style={{ textAlign: "center", color: colors.muted, fontSize: 14, marginTop: 24 }}>
        Run a community centre or sports club?{" "}
        <Link to="/vendor/signup" className="link-accent" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5, color: colors.green, fontWeight: 700 }}>
          List it on Hello Circle <ArrowRightIcon size={14} />
        </Link>
      </p>

      <TrustRow />
    </AuthShell>
  );
}
