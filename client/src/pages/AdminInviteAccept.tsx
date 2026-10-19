import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { acceptAdminInvite, describeAdminInvite } from "../api";
import { useAuth } from "../AuthContext";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { AuthFormError, FieldIcon, PasswordField, useFocusOnError } from "../components/AuthForms";
import { PersonIcon } from "../components/icons";
import { Button, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { colors } from "../theme";

// OG-06 — the link a super admin's invitation emails. The email and role are
// fixed by the invitation; the person chooses a name and a password (12+
// characters), and is then taken to the admin workspace, which first asks
// them to set up two-step sign-in (OG-07).

const ROLE_LABEL: Record<string, string> = { super: "super admin", finance: "finance admin", support: "support admin", legal: "legal admin" };

export function AdminInviteAccept() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [invite, setInvite] = useState<{ email: string; adminRole: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorRef = useFocusOnError(error);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("This link is incomplete. Open the link from your invitation email.");
      setLoading(false);
      return;
    }
    describeAdminInvite(token)
      .then(setInvite)
      .catch((e) => setError(e instanceof Error ? e.message : "This invitation is no longer valid"))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    if (submitting) return;
    setError(null);
    if (!name.trim()) return setError("Enter your name");
    if (password.length < 12) return setError("Use a password of at least 12 characters");
    if (password !== confirm) return setError("The two passwords don't match");
    setSubmitting(true);
    try {
      await acceptAdminInvite({ token, name: name.trim(), password });
      await refresh();
      navigate("/admin");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't accept this invitation");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <AuthEditorialShell
      heroImage={{ src: "https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=1920&q=75&auto=format&fit=crop", alt: "A local five-a-side football match in progress on an outdoor pitch" }}
      caption={{ heading: <>Run the platform<br />people meet on.</>, avatarCaption: "The HelloCircle admin team.", avatarSeedPrefix: "hc-admin-avatar" }}
    >
      {!invite ? (
        <AuthEditorialHeader eyebrow="Admin invitation" accent="orange" headline="Invitation not found." subtitle={error ?? "This invitation is no longer valid."} />
      ) : (
        <>
          <AuthEditorialHeader
            eyebrow="Admin invitation"
            accent="orange"
            headline={<>Join the<br /><span style={{ color: colors.orangeDark }}>HelloCircle admin team.</span></>}
            subtitle={
              <>
                You've been invited as a <strong>{ROLE_LABEL[invite.adminRole] ?? invite.adminRole}</strong>, signing in as {invite.email}. Next you'll set up two-step sign-in with an authenticator app.
              </>
            }
          />
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor="admin-invite-name" style={labelStyle}>
              Your name
            </label>
            <div style={{ position: "relative", marginBottom: 14 }}>
              <FieldIcon>
                <PersonIcon size={16} />
              </FieldIcon>
              <input id="admin-invite-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="name" style={{ ...inputStyle, paddingLeft: 38 }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <PasswordField id="admin-invite-password" label="Set a password (12+ characters)" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Create a password" invalid={!!error} describedBy={error ? "admin-invite-error" : undefined} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <PasswordField id="admin-invite-confirm" label="Type it again" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Repeat the password" invalid={!!error} describedBy={error ? "admin-invite-error" : undefined} />
            </div>
            {error && <AuthFormError id="admin-invite-error" innerRef={errorRef} message={error} />}
            <Button type="submit" disabled={submitting} style={{ width: "100%" }}>
              {submitting ? "Creating your account…" : "Create admin account"}
            </Button>
          </form>
        </>
      )}
    </AuthEditorialShell>
  );
}
