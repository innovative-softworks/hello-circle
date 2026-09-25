import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { acceptInvite, fetchInviteDetails } from "../api";
import { AnalyticsEvent, trackTypedEvent } from "../analyticsEvents";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { AuthFormError, CheckboxField, FieldIcon, PasswordField, useFocusOnError } from "../components/AuthForms";
import { PersonIcon } from "../components/icons";
import { Button, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { colors } from "../theme";

// Staff invite acceptance (Phase C) — reached via the link org.ts's
// staff/invite route emails. Password-only by design, unlike every other
// invite-shaped resident surface: the invited person's email is fixed by the
// invite token itself (org.ts's staff/invite route, not chosen here), so
// there's no "which Google account" ambiguity to resolve, and this creates a
// vendor/admin (`req.user`) account, not a resident one — Google sign-in for
// that identity system is deliberately login-only everywhere (see
// server/src/routes/auth.ts's POST /google) with no signup-via-invite path.
// Flagged by the auth UX audit as worth a deliberate decision rather than an
// apparent oversight; left as-is for this pass per that decision.

export function AcceptInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [invite, setInvite] = useState<{ email: string; platformRole: string; orgName: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  // Onboarding audit (consent pass) — this screen previously had no Terms
  // acceptance at all, the one signup path in the app that didn't; same
  // required-Terms/optional-marketing shape as every other signup form now,
  // enforced server-side too (see routes/auth.ts's POST /accept-invite).
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useFocusOnError(error);
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
    if (submitting) return;
    setError(null);
    if (!name.trim() || password.length < 8) {
      setError("Name and a password of at least 8 characters are required");
      return;
    }
    if (!termsAccepted) {
      setError("Please accept the Terms to continue");
      return;
    }
    setSubmitting(true);
    try {
      await acceptInvite({ token, name: name.trim(), password, termsAccepted, marketingConsent });
      trackTypedEvent(AnalyticsEvent.InvitationAccepted, { platformRole: invite?.platformRole ?? "unknown" });
      navigate("/vendor");
    } catch (e) {
      trackTypedEvent(AnalyticsEvent.InvitationAcceptError, { reason: "server" });
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
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); submit(); }}>
            <label htmlFor="invite-name" style={labelStyle}>Your name</label>
            <div style={{ position: "relative", marginBottom: 14 }}>
              <FieldIcon><PersonIcon size={16} /></FieldIcon>
              <input
                id="invite-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                autoComplete="name"
                placeholder="Your full name"
                aria-invalid={!!error}
                aria-describedby={error ? "accept-invite-error" : undefined}
                style={{ ...inputStyle, paddingLeft: 38 }}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <PasswordField
                id="invite-password"
                label="Set a password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                placeholder="Create a password"
                invalid={!!error}
                describedBy={error ? "accept-invite-error" : undefined}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
              <CheckboxField id="invite-terms" checked={termsAccepted} onChange={setTermsAccepted}>
                I agree to HelloCircle's{" "}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: colors.text, fontWeight: 700 }}>Privacy Policy</a> and Terms.
              </CheckboxField>
              <CheckboxField id="invite-marketing" checked={marketingConsent} onChange={setMarketingConsent}>
                Send me occasional emails about new features and vendor tips (optional).
              </CheckboxField>
            </div>
            {error && <div style={{ marginBottom: 14 }}><AuthFormError id="accept-invite-error" innerRef={errorRef} message={error} /></div>}
            <Button type="submit" variant="orange" full disabled={submitting || !termsAccepted}>
              {submitting ? "Joining…" : "Accept & join →"}
            </Button>
          </form>
        </>
      )}
    </AuthEditorialShell>
  );
}
