import { useState, type KeyboardEvent, type ReactNode } from "react";
import { loginWithPassword, requestGuestLink, signupWithPassword } from "../api";
import { AppleIcon, EyeIcon, EyeOffIcon, GoogleIcon, LockIcon, MailIcon, PersonIcon } from "./icons";
import { Button, inputStyle, labelStyle } from "./ui";
import { colors, radius } from "../theme";

// Shared form bodies for every resident authentication surface — the
// dedicated full-page routes (SignIn.tsx / SignUp.tsx / EmailLinkSignIn.tsx)
// and the contextual JoinAuthModal (Games.tsx, via SignInPanel). No tabs:
// each form is a single-purpose screen: log in, create account, or email
// link — never combined. Google/Apple are visual-only (no OAuth provider
// wired up server-side); clicking shows an inline notice instead of doing
// nothing silently.

// Shared error box — same dangerBg/role="alert" treatment as every other
// auth screen (Login.tsx, ForgotPassword.tsx, ResetPassword.tsx,
// AcceptInvite.tsx, GuidedFlow.tsx) — these three forms were the one place
// still showing a bare colored line instead (consistency pass).
function AuthFormError({ message }: { message: string }) {
  return (
    <p role="alert" className="pop-in" style={{ color: colors.danger, fontSize: 14, margin: 0, background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>
      {message}
    </p>
  );
}

export function FieldIcon({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: colors.mutedLight, display: "flex", pointerEvents: "none" }}>
      {children}
    </div>
  );
}

export function PasswordField({ id, label, value, onChange, autoComplete, placeholder, onKeyDown, autoFocus }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void; autoFocus?: boolean }) {
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
          onKeyDown={onKeyDown}
          autoComplete={autoComplete}
          placeholder={placeholder}
          autoFocus={autoFocus}
          style={{ ...inputStyle, paddingLeft: 38, paddingRight: 40 }}
        />
        <button
          type="button"
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

export function OAuthDivider({ onClickProvider }: { onClickProvider: (provider: "Google" | "Apple") => void }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 14px" }}>
        <div style={{ flex: 1, height: 1, background: colors.border }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: colors.faint }}>or continue with</span>
        <div style={{ flex: 1, height: 1, background: colors.border }} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={() => onClickProvider("Google")}
          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 12px", border: `1px solid ${colors.inputBorder}`, borderRadius: 11, background: colors.surface, fontSize: 13.5, fontWeight: 700, color: colors.text, cursor: "pointer" }}
        >
          <GoogleIcon size={16} /> Google
        </button>
        <button
          type="button"
          onClick={() => onClickProvider("Apple")}
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
    <div className="pop-in" style={{ marginTop: 14, fontSize: 12.5, color: colors.mutedLight, background: colors.panel, borderRadius: radius.control, padding: "9px 12px" }}>
      {notice}
    </div>
  );
}

export function useOAuthNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const trigger = (provider: "Google" | "Apple") => setNotice(`Sign-in with ${provider} is coming soon — use your email for now.`);
  return { notice, trigger };
}

// --- Log in (email + password) ----------------------------------------------

export function LoginForm({ onSuccess, onForgotPassword }: { onSuccess: () => void | Promise<void>; onForgotPassword: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { notice, trigger } = useOAuthNotice();

  const submit = async () => {
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

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label htmlFor="login-email" style={labelStyle}>Email address</label>
          <div style={{ position: "relative" }}>
            <FieldIcon><MailIcon size={16} /></FieldIcon>
            <input id="login-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.ie" autoFocus autoComplete="email" onKeyDown={(e) => e.key === "Enter" && submit()} style={{ ...inputStyle, paddingLeft: 38 }} />
          </div>
        </div>
        <div>
          <PasswordField id="login-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="Enter your password" />
          <button onClick={onForgotPassword} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer", float: "right", marginTop: 8 }}>
            Forgot password?
          </button>
        </div>
        <div style={{ clear: "both" }} />
        {error && <AuthFormError message={error} />}
        <Button onClick={submit} disabled={busy || !email.trim() || !password} full>
          {busy ? "Logging in…" : "Log in →"}
        </Button>
      </div>
      <OAuthDivider onClickProvider={trigger} />
      <OAuthNotice notice={notice} />
    </div>
  );
}

// --- Create account (name + email + password) ------------------------------

export function SignupForm({ onSuccess }: { onSuccess: () => void | Promise<void> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { notice, trigger } = useOAuthNotice();

  const submit = async () => {
    if (!email.trim() || !password) return;
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await signupWithPassword({ name: name.trim(), email: email.trim(), password });
      await onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label htmlFor="signup-name" style={labelStyle}>Full name</label>
          <div style={{ position: "relative" }}>
            <FieldIcon><PersonIcon size={16} /></FieldIcon>
            <input id="signup-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" autoFocus autoComplete="name" style={{ ...inputStyle, paddingLeft: 38 }} />
          </div>
        </div>
        <div>
          <label htmlFor="signup-email" style={labelStyle}>Email address</label>
          <div style={{ position: "relative" }}>
            <FieldIcon><MailIcon size={16} /></FieldIcon>
            <input id="signup-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.ie" autoComplete="email" style={{ ...inputStyle, paddingLeft: 38 }} />
          </div>
        </div>
        <div>
          <PasswordField id="signup-password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Create a password" />
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: colors.faint }}>Use at least 8 characters.</p>
        </div>
        {error && <AuthFormError message={error} />}
        <Button onClick={submit} disabled={busy || !email.trim() || !password} full>
          {busy ? "Creating account…" : "Create account →"}
        </Button>
      </div>
      <OAuthDivider onClickProvider={trigger} />
      <OAuthNotice notice={notice} />
      <p style={{ margin: "16px 0 0", fontSize: 12, color: colors.faint }}>
        By creating an account, you agree to HelloCircle's{" "}
        <a href="/privacy" style={{ color: colors.faint, textDecoration: "underline" }}>Privacy Policy</a>.
      </p>
    </div>
  );
}

// --- Email me a sign-in link (passwordless) ---------------------------------

export function EmailLinkForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await requestGuestLink(value);
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
          <button onClick={submit} disabled={busy} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.green, cursor: "pointer" }}>
            {busy ? "Sending…" : "Resend email"}
          </button>
          <button onClick={() => setSent(false)} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.mutedLight, cursor: "pointer" }}>
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
      <div>
        <label htmlFor="link-email" style={labelStyle}>Email address</label>
        <div style={{ position: "relative" }}>
          <FieldIcon><MailIcon size={16} /></FieldIcon>
          <input id="link-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.ie" autoFocus autoComplete="email" onKeyDown={(e) => e.key === "Enter" && submit()} style={{ ...inputStyle, paddingLeft: 38, marginBottom: 12 }} />
        </div>
        <Button onClick={submit} disabled={busy || !email.trim()} full>{busy ? "Sending…" : "Email me a sign-in link →"}</Button>
        {error && <div style={{ marginTop: 10 }}><AuthFormError message={error} /></div>}
      </div>
    </div>
  );
}
