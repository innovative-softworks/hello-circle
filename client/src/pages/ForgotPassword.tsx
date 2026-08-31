import { useState } from "react";
import { requestPasswordReset } from "../api";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { FieldIcon } from "../components/AuthForms";
import { MailIcon } from "../components/icons";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { colors, radius } from "../theme";

// Forgot password (Phase A) — vendor/admin only. Residents got their own
// optional password login later (My Life auth redesign); their forgot-
// password flow lives inside SignInPanel/SignIn.tsx instead of here, since
// it's a different identity system/session entirely — this page and its
// backend routes are untouched by that addition. Same AuthEditorialShell/
// orange accent as Login.tsx (Form System Audit follow-up).
// Three-state flow: enter email -> email sent -> (ResetPassword.tsx handles
// the third state, reached via the emailed link).

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim()) return;
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send a reset link");
    } finally {
      setLoading(false);
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
      {sent ? (
        <AuthEditorialHeader
          eyebrow="Reset password"
          accent="orange"
          headline="Check your email."
          subtitle={<>If an account exists for <strong>{email}</strong>, we've sent a link to reset your password. It expires in 30 minutes.</>}
        />
      ) : (
        <>
          <AuthEditorialHeader
            eyebrow="Reset password"
            accent="orange"
            headline={<>Forgotten something?<br /><span style={{ color: colors.orange }}>Let's get you back in.</span></>}
            subtitle="Enter the email on your vendor or admin account."
          />
          <label htmlFor="forgot-email" style={labelStyle}>Email address</label>
          <div style={{ position: "relative", marginBottom: 16 }}>
            <FieldIcon><MailIcon size={16} /></FieldIcon>
            <input
              id="forgot-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="you@email.ie"
              autoFocus
              autoComplete="email"
              style={{ ...inputStyle, paddingLeft: 38 }}
            />
          </div>
          {error && (
            <p role="alert" className="pop-in" style={{ color: colors.danger, fontSize: 14, margin: "0 0 14px", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>
              {error}
            </p>
          )}
          <Button variant="orange" full onClick={submit} disabled={loading || !email.trim()}>
            {loading ? "Sending…" : "Send reset link →"}
          </Button>
        </>
      )}
    </AuthEditorialShell>
  );
}
