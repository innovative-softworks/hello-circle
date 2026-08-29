import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api";
import { AuthPhotoPanel, AuthShell } from "../components/AuthShell";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { colors } from "../theme";

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
      {done ? (
        <>
          <h1 style={{ fontWeight: 800, fontSize: "clamp(26px,3vw,32px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Password updated</h1>
          <p style={{ color: colors.mutedLight, fontSize: 15 }}>Taking you to sign in…</p>
        </>
      ) : (
        <>
          <h1 style={{ fontWeight: 800, fontSize: "clamp(26px,3vw,32px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Set a new password</h1>
          <label style={labelStyle}>New password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ ...inputStyle, marginBottom: 8 }} />
          {error && <p style={{ color: colors.danger, fontSize: 13, margin: "0 0 12px" }}>{error}</p>}
          <Button full onClick={submit} disabled={loading || !password}>
            {loading ? "Saving…" : "Set password →"}
          </Button>
        </>
      )}
    </AuthShell>
  );
}
