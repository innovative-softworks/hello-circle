import { useState } from "react";
import { requestPasswordReset } from "../api";
import { AuthPhotoPanel, AuthShell } from "../components/AuthShell";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { colors } from "../theme";

// Forgot password (Phase A) — vendor/admin only. Residents got their own
// optional password login later (My Life auth redesign); their forgot-
// password flow lives inside SignInPanel/SignIn.tsx instead of here, since
// it's a different identity system/session entirely — this page and its
// backend routes are untouched by that addition.
// Three-state flow: enter email -> email sent -> (ResetPassword.tsx handles
// the third state, reached via the emailed link).

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } finally {
      setLoading(false);
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
      {sent ? (
        <>
          <h1 style={{ fontWeight: 800, fontSize: "clamp(26px,3vw,32px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Check your email</h1>
          <p style={{ color: colors.mutedLight, fontSize: 15 }}>
            If an account exists for <strong>{email}</strong>, we've sent a link to reset your password. It expires in 30 minutes.
          </p>
        </>
      ) : (
        <>
          <h1 style={{ fontWeight: 800, fontSize: "clamp(26px,3vw,32px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Reset your password</h1>
          <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 28px" }}>Enter the email on your vendor or admin account.</p>
          <label style={labelStyle}>Email address</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ ...inputStyle, marginBottom: 16 }} />
          <Button full onClick={submit} disabled={loading || !email.trim()}>
            {loading ? "Sending…" : "Send reset link →"}
          </Button>
        </>
      )}
    </AuthShell>
  );
}
