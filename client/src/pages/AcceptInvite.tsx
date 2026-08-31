import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { acceptInvite, fetchInviteDetails } from "../api";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { FieldIcon, PasswordField } from "../components/AuthForms";
import { PersonIcon } from "../components/icons";
import { Button, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { colors, radius } from "../theme";

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
      {!invite ? (
        <AuthEditorialHeader
          eyebrow="Team invite"
          accent="orange"
          headline="Invite not found."
          subtitle={error ?? "This invite is no longer valid."}
        />
      ) : (
        <>
          <AuthEditorialHeader
            eyebrow="Team invite"
            accent="orange"
            headline={<>Join<br /><span style={{ color: colors.orange }}>{invite.orgName}.</span></>}
            subtitle={<>You've been invited as <strong>{invite.platformRole.replace(/_/g, " ")}</strong> — signing in as {invite.email}.</>}
          />
          <label htmlFor="invite-name" style={labelStyle}>Your name</label>
          <div style={{ position: "relative", marginBottom: 14 }}>
            <FieldIcon><PersonIcon size={16} /></FieldIcon>
            <input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="name" placeholder="Your full name" style={{ ...inputStyle, paddingLeft: 38 }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <PasswordField id="invite-password" label="Set a password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Create a password" />
          </div>
          {error && (
            <p role="alert" className="pop-in" style={{ color: colors.danger, fontSize: 14, margin: "0 0 14px", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>
              {error}
            </p>
          )}
          <Button variant="orange" full onClick={submit} disabled={submitting}>
            {submitting ? "Joining…" : "Accept & join →"}
          </Button>
        </>
      )}
    </AuthEditorialShell>
  );
}
