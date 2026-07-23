import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signup } from "../api";
import { useAuth } from "../AuthContext";
import { CheckIcon, StarIcon } from "../components/icons";
import { Button, Card, inputStyle, labelStyle } from "../components/ui";
import { colors, fonts } from "../theme";

export function VendorSignup() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signup({ name, email, password });
      await refresh();
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create your account");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="fade-panel">
        <section className="section-pad" style={{ maxWidth: 480, margin: "0 auto", padding: "64px 24px 90px", textAlign: "center" }}>
          <div
            className="pop-in"
            style={{
              width: 78,
              height: 78,
              borderRadius: "50%",
              background: colors.greenBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 22px",
              fontSize: 36,
              color: colors.green,
              boxShadow: "0 10px 26px rgba(30,122,76,.18)",
            }}
          >
            <CheckIcon size={34} />
          </div>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px", letterSpacing: "-.02em" }}>
            Account created
          </h1>
          <p style={{ color: colors.muted, fontSize: 15, margin: "0 0 26px", lineHeight: 1.55 }}>
            Your vendor account is awaiting admin approval before you can publish listings. You can already start
            drafting your first centre or club — it'll go live once approved.
          </p>
          <Button onClick={() => navigate("/vendor")}>Go to my dashboard</Button>
        </section>
      </div>
    );
  }

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 420, margin: "0 auto", padding: "64px 24px 90px" }}>
        <div
          className="pop-in"
          style={{
            width: 52,
            height: 52,
            borderRadius: 15,
            background: colors.orange,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 24,
            margin: "0 auto 22px",
            boxShadow: "0 10px 24px rgba(232,98,42,.28)",
          }}
        >
          <StarIcon size={22} style={{ color: "#fff" }} />
        </div>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, margin: "0 0 6px", letterSpacing: "-.02em", textAlign: "center" }}>
          List your centre or club
        </h1>
        <p style={{ color: colors.muted, fontSize: 15, margin: "0 0 28px", textAlign: "center" }}>
          Create a vendor account to add and manage your own listings on Hello Circle.
        </p>

        <Card style={{ padding: 26, boxShadow: "0 10px 30px rgba(30,40,32,.05)" }}>
          <label style={labelStyle}>Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus style={{ ...inputStyle, marginBottom: 16 }} />
          <label style={labelStyle}>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.ie" style={{ ...inputStyle, marginBottom: 16 }} />
          <label style={labelStyle}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} />
          <p style={{ fontSize: 12, color: colors.faint, margin: "0 0 20px" }}>At least 8 characters.</p>
          {error && (
            <p className="pop-in" style={{ color: "#b00020", fontSize: 14, margin: "0 0 16px", background: "#FBEAEA", padding: "9px 12px", borderRadius: 10 }}>
              {error}
            </p>
          )}
          <Button variant="primary" full disabled={submitting || !name || !email || password.length < 8} onClick={submit}>
            {submitting ? "Creating account…" : "Create vendor account"}
          </Button>
        </Card>

        <p style={{ textAlign: "center", color: colors.muted, fontSize: 14, marginTop: 22 }}>
          Already have an account?{" "}
          <span className="link-accent" style={{ color: colors.green, fontWeight: 700, cursor: "pointer" }} onClick={() => navigate("/login")}>
            Log in
          </span>
        </p>
      </section>
    </div>
  );
}
