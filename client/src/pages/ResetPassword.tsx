import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { colors, fonts } from "../theme";

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
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section style={{ maxWidth: 420, margin: "0 auto", padding: "64px 24px" }}>
        {done ? (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 26, margin: "0 0 10px" }}>Password updated</h1>
            <p style={{ color: colors.mutedLight }}>Taking you to sign in…</p>
          </>
        ) : (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 26, margin: "0 0 10px" }}>Set a new password</h1>
            <label style={labelStyle}>New password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ ...inputStyle, marginBottom: 8 }} />
            {error && <p style={{ color: "#b00020", fontSize: 13, margin: "0 0 12px" }}>{error}</p>}
            <Button full onClick={submit} disabled={loading || !password}>
              {loading ? "Saving…" : "Set password"}
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
