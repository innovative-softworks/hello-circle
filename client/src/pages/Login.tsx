import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api";
import { useAuth } from "../AuthContext";
import { ArrowRightIcon } from "../components/icons";
import { Button, Card, inputStyle, labelStyle } from "../components/ui";
import { colors, fonts } from "../theme";

export function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 420, margin: "0 auto", padding: "64px 24px 90px" }}>
        <div
          className="pop-in"
          style={{
            width: 52,
            height: 52,
            borderRadius: 15,
            background: colors.green,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontFamily: fonts.display,
            fontWeight: 700,
            fontSize: 26,
            margin: "0 auto 22px",
            boxShadow: "0 10px 24px rgba(30,122,76,.28)",
          }}
        >
          h
        </div>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, margin: "0 0 6px", letterSpacing: "-.02em", textAlign: "center" }}>
          Welcome back
        </h1>
        <p style={{ color: colors.muted, fontSize: 15, margin: "0 0 28px", textAlign: "center" }}>
          For vendors and admins — visitors don't need an account.
        </p>

        <Card style={{ padding: 26, boxShadow: "0 10px 30px rgba(30,40,32,.05)" }}>
          <label style={labelStyle}>Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.ie"
            autoFocus
            style={{ ...inputStyle, marginBottom: 16 }}
          />
          <label style={labelStyle}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            style={{ ...inputStyle, marginBottom: 20 }}
          />
          {error && (
            <p className="pop-in" style={{ color: colors.danger, fontSize: 14, margin: "0 0 16px", background: colors.dangerBg, padding: "9px 12px", borderRadius: 10 }}>
              {error}
            </p>
          )}
          <Button variant="dark" full disabled={submitting || !email || !password} onClick={submit}>
            {submitting ? "Logging in…" : "Log in"}
          </Button>
        </Card>

        <p style={{ textAlign: "center", color: colors.muted, fontSize: 14, marginTop: 22 }}>
          Run a community centre or sports club?{" "}
          <span className="link-accent" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: colors.green, fontWeight: 700, cursor: "pointer" }} onClick={() => navigate("/vendor/signup")}>
            List it on Hello Circle <ArrowRightIcon size={14} />
          </span>
        </p>
      </section>
    </div>
  );
}
