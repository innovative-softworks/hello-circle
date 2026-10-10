import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { acceptPolicy, acknowledgePolicy, fetchPendingPolicies, type PendingPolicy } from "../api";
import { useAuth } from "../AuthContext";
import { useGuest } from "../GuestContext";
import { colors, fonts, radius } from "../theme";
import { Button, Modal } from "./ui";

// Revenue & Connect Stage 4 — acceptance and re-acceptance. When a policy
// aimed at the signed-in partner or resident is published for the first
// time, or republished as a material change, they're asked to accept it
// before carrying on. Policy pages, complaints and the cookie/privacy pages
// stay reachable so the text can be read first. Nothing shows until a
// version has actually been published (so before legal sign-off this is
// invisible).
//
// Stage 5c — two different things, never one checkbox: contract terms are
// *accepted*; the privacy notice is only *acknowledged* as read (it is not
// consent, and accepting the terms doesn't count as reading it).

const EXEMPT = /^\/(policies|privacy|cookies|complaints)(\/|$)/;

export function PolicyAcceptanceGate() {
  const { user } = useAuth();
  const { resident } = useGuest();
  const { pathname } = useLocation();
  const [pending, setPending] = useState<{ as: "user" | "resident"; p: PendingPolicy }[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Closing hides the prompt for this page only — it returns on the next navigation.
  const [dismissedOn, setDismissedOn] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!user && !resident) return setPending([]);
    fetchPendingPolicies()
      .then((r) => setPending([...r.user.map((p) => ({ as: "user" as const, p })), ...r.resident.map((p) => ({ as: "resident" as const, p }))]))
      .catch(() => setPending([]));
  }, [user, resident]);
  useEffect(load, [load]);

  if (!pending.length || EXEMPT.test(pathname) || dismissedOn === pathname) return null;
  const changed = pending.some((x) => x.p.version > 1);
  const toAccept = pending.filter((x) => x.p.kind !== "acknowledge");
  const toAcknowledge = pending.filter((x) => x.p.kind === "acknowledge");
  const ready = (toAccept.length === 0 || agreed) && (toAcknowledge.length === 0 || acknowledged);

  return (
    <Modal
      open
      onClose={() => setDismissedOn(pathname)}
      title={changed ? "We've updated our terms" : "Please review our terms"}
      subtitle="To keep using HelloCircle, please review the following."
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                for (const x of toAccept) await acceptPolicy(x.p.docKey, x.p.version, x.as);
                for (const x of toAcknowledge) await acknowledgePolicy(x.p.docKey, x.p.version, x.as);
                setAgreed(false);
                setAcknowledged(false);
                load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't record your acceptance");
                load();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Continue"}
          </Button>
        </div>
      }
    >
      {toAccept.length > 0 && (
        <section aria-labelledby="gate-accept">
          <h3 id="gate-accept" style={{ fontSize: 14, margin: "0 0 6px" }}>Terms to accept</h3>
          <ul style={{ paddingLeft: 18, margin: "0 0 10px", lineHeight: 1.7 }}>
            {toAccept.map((x) => (
              <li key={`${x.as}-${x.p.docKey}`}>
                <Link to={`/policies/${x.p.docKey}`} target="_blank" style={{ color: colors.greenText, fontWeight: 600 }}>{x.p.title}</Link>
                <span style={{ fontSize: 12.5, color: colors.mutedLight }}> · version {x.p.version}{x.p.changeSummary ? ` — ${x.p.changeSummary}` : ""}</span>
              </li>
            ))}
          </ul>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, fontFamily: fonts.body, marginBottom: 14 }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I accept {toAccept.length === 1 ? "these terms" : "all of these terms"}.</span>
          </label>
        </section>
      )}
      {toAcknowledge.length > 0 && (
        <section aria-labelledby="gate-ack">
          <h3 id="gate-ack" style={{ fontSize: 14, margin: "0 0 6px" }}>Privacy notice</h3>
          <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 6px" }}>How we use your personal data. This is information for you to read — it isn't something you consent to, and it doesn't sign you up for marketing.</p>
          <ul style={{ paddingLeft: 18, margin: "0 0 10px", lineHeight: 1.7 }}>
            {toAcknowledge.map((x) => (
              <li key={`${x.as}-${x.p.docKey}`}>
                <Link to={`/policies/${x.p.docKey}`} target="_blank" style={{ color: colors.greenText, fontWeight: 600 }}>{x.p.title}</Link>
                <span style={{ fontSize: 12.5, color: colors.mutedLight }}> · version {x.p.version}</span>
              </li>
            ))}
          </ul>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, fontFamily: fonts.body }}>
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I have read the privacy notice.</span>
          </label>
        </section>
      )}
      {error && <p role="alert" style={{ color: colors.danger, background: colors.dangerBg, padding: "8px 12px", borderRadius: radius.control, fontSize: 13 }}>{error}</p>}
    </Modal>
  );
}
