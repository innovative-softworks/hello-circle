import { useEffect, useState, type FormEvent } from "react";
import { completeMagicLinkSignup } from "../api";
import { AnalyticsEvent, trackTypedEvent } from "../analyticsEvents";
import { AuthFormError, CheckboxField, FieldIcon, useFocusOnError } from "./AuthForms";
import { PersonIcon } from "./icons";
import { Button, inputStyle, labelStyle } from "./ui";
import { colors, fonts } from "../theme";

// Onboarding audit (consent pass) — the magic-link equivalent of
// AuthForms.tsx's GoogleCompleteSignup: shown inline on /bookings (see
// MyBookings.tsx) the moment POST /guest/verify reports a brand-new email
// ("needs_completion"). Opening the emailed link only proves inbox access,
// never agreement to Terms — this is what actually captures that, same
// required-Terms/optional-marketing shape every other signup path already
// uses. Name is optional here, matching password signup's own behaviour
// (SignupForm in AuthForms.tsx), not Google's — Google always has a name to
// prefill, this path doesn't.
export function MagicLinkCompleteAccount({
  email,
  completionToken,
  onSuccess,
}: {
  email: string;
  completionToken: string;
  onSuccess: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useFocusOnError(error);

  useEffect(() => {
    trackTypedEvent(AnalyticsEvent.ResidentAccountCompletionRequired, { method: "magic_link" });
  }, []);

  const submit = async () => {
    if (busy) return;
    if (!termsAccepted) {
      setError("Please accept the Terms to continue");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await completeMagicLinkSignup(completionToken, { name: name.trim(), termsAccepted, marketingConsent });
      trackTypedEvent(AnalyticsEvent.ResidentAccountCompletionCompleted, { method: "magic_link" });
      await onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't complete your account — this link may have expired");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: "56px 24px" }}>
      <h1 style={{ fontFamily: fonts.display, fontSize: 22, fontWeight: 800, margin: "0 0 6px" }}>Complete your HelloCircle account</h1>
      <p style={{ margin: "0 0 22px", fontSize: 14, color: colors.mutedLight, lineHeight: 1.5 }}>
        Signed in as <strong>{email}</strong>. One more step before you continue.
      </p>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div>
          <label htmlFor="magic-link-complete-name" style={labelStyle}>
            Display name (optional)
          </label>
          <div style={{ position: "relative" }}>
            <FieldIcon>
              <PersonIcon size={16} />
            </FieldIcon>
            <input
              id="magic-link-complete-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
              autoComplete="name"
              style={{ ...inputStyle, paddingLeft: 38 }}
            />
          </div>
        </div>
        <CheckboxField id="magic-link-complete-terms" checked={termsAccepted} onChange={setTermsAccepted}>
          I agree to HelloCircle's{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: colors.text, fontWeight: 700 }}>
            Privacy Policy
          </a>{" "}
          and Terms.
        </CheckboxField>
        <CheckboxField id="magic-link-complete-marketing" checked={marketingConsent} onChange={setMarketingConsent}>
          Send me occasional emails about new features and things happening locally (optional).
        </CheckboxField>
        {error && <AuthFormError id="magic-link-complete-error" innerRef={errorRef} message={error} />}
        <Button type="submit" disabled={busy || !termsAccepted} full>
          {busy ? "Creating account…" : "Continue →"}
        </Button>
      </form>
    </div>
  );
}
