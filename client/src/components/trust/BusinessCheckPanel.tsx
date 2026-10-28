import { useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { answerBusinessCheck, fetchMyBusinessChecks, requestBusinessCheck, type VerificationCheck } from "../../api";
import { Button } from "../ui";
import { Box, ErrorMessage } from "../admin/adminUi";
import "./trust.css";

// Trust & Retention batch 1 — the partner's side of a business-details check.
// The owner gives the registered business name, number and address; HelloCircle
// checks them against an official or public record and the public profile
// shows "Business details checked" only while the check holds. Staff can read
// the status. Nothing here asks for or stores documents.

const STATUS: Record<VerificationCheck["status"], string> = {
  pending: "HelloCircle is checking your details.",
  more_info: "HelloCircle needs a little more information.",
  approved: "Checked. Your public profile shows “Business details checked”.",
  rejected: "We couldn't confirm your details.",
  revoked: "The check was withdrawn.",
  expired: "The check has expired.",
};

const DATE = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });

export function BusinessCheckPanel() {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchMyBusinessChecks>> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const load = () => {
    setError(null);
    fetchMyBusinessChecks()
      .then(setData)
      .catch(setError);
  };
  useEffect(load, []);

  if (error && !data) return <ErrorMessage error={error} onRetry={load} title="Couldn't load your business check" />;
  if (!data) return null;
  const current = data.checks[0];
  const canAsk = data.canRequest && (!current || ["rejected", "revoked", "expired"].includes(current.status));
  const waitingForUs = current?.status === "more_info";

  const submit = async () => {
    setFormError(null);
    if (details.trim().length < 20) return setFormError("Give the registered business name, company or charity number and registered address.");
    setBusy(true);
    try {
      if (waitingForUs) await answerBusinessCheck(current.id, details.trim());
      else await requestBusinessCheck(details.trim());
      setDetails("");
      setSent(waitingForUs ? "Thanks — HelloCircle will pick your check back up." : "Sent. HelloCircle will check your details and let you know.");
      load();
    } catch (e) {
      setFormError(e instanceof Error && e.message ? e.message : "Couldn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box title="Business check" icon={BadgeCheck}>
      <p className="tr-note" style={{ marginBottom: 14 }}>
        HelloCircle can check your registered business details against an official or public record (for example the Companies Registration Office or the Charities Register). Once checked, your public profile shows “Business details checked”, with a note that it doesn't cover staff, safeguarding or every activity. It isn't linked to any plan or payment.
      </p>
      {current && (
        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12, marginBottom: 14 }} role="status">
          <p style={{ margin: 0, fontWeight: 700 }}>{STATUS[current.status]}</p>
          <p className="tr-note" style={{ marginTop: 4 }}>
            Asked {DATE.format(new Date(current.createdAt))}
            {current.decidedAt ? ` · decided ${DATE.format(new Date(current.decidedAt))}` : ""}
            {current.expiresAt && current.status === "approved" ? ` · valid until ${DATE.format(new Date(current.expiresAt))}` : ""}
          </p>
          {waitingForUs && current.infoRequest && <p style={{ margin: "10px 0 0" }}>“{current.infoRequest}”</p>}
          {current.decisionReason && (current.status === "rejected" || current.status === "revoked") && <p style={{ margin: "10px 0 0" }}>Reason: {current.decisionReason}</p>}
        </div>
      )}
      {!data.canRequest && !current && <p className="tr-note">Only your organisation's owner can ask for a business check.</p>}
      {(canAsk || (waitingForUs && data.canRequest)) && (
        <form
          className="tr-form"
          style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <label className="tr-label" htmlFor="business-check-details">
              {waitingForUs ? "Your answer" : "Registered name, number and address"} <span aria-hidden="true">*</span>
            </label>
            <textarea id="business-check-details" className="tr-input" rows={4} maxLength={4000} value={details} onChange={(e) => setDetails(e.target.value)} aria-describedby="business-check-help" aria-required="true" />
            <p id="business-check-help" className="tr-note" style={{ marginTop: 6 }}>
              Don't upload or paste identity documents — HelloCircle doesn't need them for this check.
            </p>
          </div>
          <div aria-live="assertive">{formError && <p className="tr-alert">{formError}</p>}</div>
          <div aria-live="polite">{sent && <p className="tr-ok">{sent}</p>}</div>
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : waitingForUs ? "Send answer" : "Ask for a business check"}
            </Button>
          </div>
        </form>
      )}
    </Box>
  );
}
