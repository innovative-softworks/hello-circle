import { useState } from "react";
import { requestResidentPasswordReset } from "../api";
import { EmailLinkForm, LoginForm, SignupForm } from "./AuthForms";
import { Button, inputStyle, labelStyle } from "./ui";
import { colors } from "../theme";

// Contextual sign-in panel — embedded inline in the JoinAuthModal overlay
// (Games.tsx) for "sign in to join this game" moments. Unlike the full-page
// /signin, /signin/create, /signin/email-link trio (which are real routes,
// since those are addressable top-level journeys), this is a modal over an
// existing page, so there's nowhere to navigate to — mode-switching happens
// via plain text links, never a tab bar/underline strip, keeping the "no
// tabs" rule's spirit while still being one reusable component. Composes
// the same LoginForm/SignupForm/EmailLinkForm every full-page screen uses,
// so there's exactly one implementation of each form, not four.

type Mode = "login" | "signup" | "link" | "forgot";

function ForgotPasswordPanel({ onBack }: { onBack: () => void }) {
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
        ← Back to log in
      </button>
      {sent ? (
        <>
          <h2 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 8px" }}>Check your email</h2>
          <p style={{ margin: 0, fontSize: 14, color: colors.mutedLight, lineHeight: 1.5 }}>
            If an account exists for <strong>{email.trim()}</strong>, we've sent password reset instructions.
          </p>
        </>
      ) : (
        <>
          <h2 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 6px" }}>Reset your password</h2>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: colors.mutedLight }}>Enter your email and we'll send you a link to reset your password.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 340 }}>
            <div>
              <label htmlFor="modal-forgot-email" style={labelStyle}>Email address</label>
              <input id="modal-forgot-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.ie" autoComplete="email" style={inputStyle} />
            </div>
            <Button onClick={submit} disabled={busy || !email.trim()} full>{busy ? "Sending…" : "Send reset link"}</Button>
          </div>
        </>
      )}
    </div>
  );
}

export function SignInPanel({ onSuccess }: { onSuccess: () => void | Promise<void> }) {
  const [mode, setMode] = useState<Mode>("login");

  if (mode === "forgot") {
    return <ForgotPasswordPanel onBack={() => setMode("login")} />;
  }

  if (mode === "signup") {
    return (
      <div>
        <SignupForm onSuccess={onSuccess} />
        <p style={{ margin: "16px 0 0", fontSize: 13 }}>
          Already have an account?{" "}
          <button onClick={() => setMode("login")} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: colors.green, cursor: "pointer" }}>Log in</button>
        </p>
      </div>
    );
  }

  if (mode === "link") {
    return (
      <div>
        <EmailLinkForm />
        <p style={{ margin: "16px 0 0", fontSize: 13 }}>
          Prefer a password?{" "}
          <button onClick={() => setMode("login")} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: colors.text, cursor: "pointer" }}>Log in</button>
        </p>
      </div>
    );
  }

  return (
    <div>
      <LoginForm onSuccess={onSuccess} onForgotPassword={() => setMode("forgot")} />
      <p style={{ margin: "16px 0 0", fontSize: 13 }}>
        Don't have an account?{" "}
        <button onClick={() => setMode("signup")} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: colors.green, cursor: "pointer" }}>Create account</button>
      </p>
      <p style={{ margin: "6px 0 0", fontSize: 13 }}>
        Prefer not to use a password?{" "}
        <button onClick={() => setMode("link")} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: colors.text, cursor: "pointer" }}>Email me a link</button>
      </p>
    </div>
  );
}
