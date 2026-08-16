import { useState } from "react";
import { requestPasswordReset } from "../api";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { colors, fonts } from "../theme";

// Forgot password (Phase A) — vendor/admin only; residents are passwordless.
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
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section style={{ maxWidth: 420, margin: "0 auto", padding: "64px 24px" }}>
        {sent ? (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 26, margin: "0 0 10px" }}>Check your email</h1>
            <p style={{ color: colors.mutedLight }}>
              If an account exists for <strong>{email}</strong>, we've sent a link to reset your password. It expires in 30 minutes.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 26, margin: "0 0 10px" }}>Reset your password</h1>
            <p style={{ color: colors.mutedLight, marginBottom: 20 }}>Enter the email on your vendor or admin account.</p>
            <label style={labelStyle}>Email address</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ ...inputStyle, marginBottom: 16 }} />
            <Button full onClick={submit} disabled={loading || !email.trim()}>
              {loading ? "Sending…" : "Send reset link"}
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
