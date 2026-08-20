import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { acceptInvite, fetchInviteDetails } from "../api";
import { Button, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { colors, fonts } from "../theme";

// Staff invite acceptance (Phase C) — reached via the link org.ts's
// staff/invite route emails.

export function AcceptInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [invite, setInvite] = useState<{ email: string; platformRole: string; orgName: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    fetchInviteDetails(token)
      .then(setInvite)
      .catch((e) => setError(e instanceof Error ? e.message : "This invite is no longer valid"))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    setError(null);
    if (!name.trim() || password.length < 8) {
      setError("Name and a password of at least 8 characters are required");
      return;
    }
    setSubmitting(true);
    try {
      await acceptInvite({ token, name: name.trim(), password });
      navigate("/vendor");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't accept this invite");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section style={{ maxWidth: 440, margin: "0 auto", padding: "64px 24px" }}>
        {!invite ? (
          <p style={{ color: colors.danger }}>{error ?? "This invite is no longer valid."}</p>
        ) : (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 26, margin: "0 0 8px" }}>Join {invite.orgName}</h1>
            <p style={{ color: colors.mutedLight, marginBottom: 22 }}>
              You've been invited as <strong>{invite.platformRole.replace(/_/g, " ")}</strong> — signing in as {invite.email}.
            </p>
            <label style={labelStyle}>Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} />
            <label style={labelStyle}>Set a password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
            {error && <p style={{ color: colors.danger, fontSize: 13, margin: "0 0 12px" }}>{error}</p>}
            <Button full onClick={submit} disabled={submitting}>
              {submitting ? "Joining…" : "Accept & join"}
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
