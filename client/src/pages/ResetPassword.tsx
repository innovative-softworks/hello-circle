import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { PasswordField } from "../components/AuthForms";
import { Button } from "../components/ui";
import { colors, radius } from "../theme";

export function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That link has expired — request a new one");
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
      {done ? (
        <AuthEditorialHeader eyebrow="Reset password" accent="orange" headline="Password updated." subtitle="Taking you to sign in…" />
      ) : (
        <>
          <AuthEditorialHeader
            eyebrow="Reset password"
            accent="orange"
            headline={<>Set a new<br /><span style={{ color: colors.orange }}>password.</span></>}
            subtitle="Choose a strong password for your HelloCircle account."
          />
          <div style={{ marginBottom: 8 }}>
            <PasswordField
              id="reset-new-password"
              label="New password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              placeholder="Enter new password"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          {error && (
            <p role="alert" className="pop-in" style={{ color: colors.danger, fontSize: 14, margin: "0 0 14px", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>
              {error}
            </p>
          )}
          <Button variant="orange" full onClick={submit} disabled={loading || !password}>
            {loading ? "Saving…" : "Set password →"}
          </Button>
        </>
      )}
    </AuthEditorialShell>
  );
}
