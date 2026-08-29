import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { acceptInvite, fetchInviteDetails } from "../api";
import { AuthPhotoPanel, AuthShell } from "../components/AuthShell";
import { Button, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { colors } from "../theme";

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
      {!invite ? (
        <>
          <h1 style={{ fontWeight: 800, fontSize: "clamp(26px,3vw,32px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Invite not found</h1>
          <p style={{ color: colors.danger, fontSize: 15 }}>{error ?? "This invite is no longer valid."}</p>
        </>
      ) : (
        <>
          <h1 style={{ fontWeight: 800, fontSize: "clamp(26px,3vw,32px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>Join {invite.orgName}</h1>
          <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 28px" }}>
            You've been invited as <strong>{invite.platformRole.replace(/_/g, " ")}</strong> — signing in as {invite.email}.
          </p>
          <label style={labelStyle}>Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} />
          <label style={labelStyle}>Set a password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
          {error && <p style={{ color: colors.danger, fontSize: 13, margin: "0 0 12px" }}>{error}</p>}
          <Button full onClick={submit} disabled={submitting}>
            {submitting ? "Joining…" : "Accept & join →"}
          </Button>
        </>
      )}
    </AuthShell>
  );
}
