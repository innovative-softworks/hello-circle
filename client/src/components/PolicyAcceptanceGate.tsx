import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { acceptPolicy, fetchPendingPolicies, type PendingPolicy } from "../api";
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

const EXEMPT = /^\/(policies|privacy|cookies|complaints)(\/|$)/;

export function PolicyAcceptanceGate() {
  const { user } = useAuth();
  const { resident } = useGuest();
  const { pathname } = useLocation();
  const [pending, setPending] = useState<{ as: "user" | "resident"; p: PendingPolicy }[]>([]);
  const [agreed, setAgreed] = useState(false);
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

  return (
    <Modal
      open
      onClose={() => setDismissedOn(pathname)}
      title={changed ? "We've updated our terms" : "Please review our terms"}
      subtitle="To keep using HelloCircle, please read and accept the following."
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            disabled={!agreed || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                for (const x of pending) await acceptPolicy(x.p.docKey, x.p.version, x.as);
                setAgreed(false);
                load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't record your acceptance");
                load();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Accept and continue"}
          </Button>
        </div>
      }
    >
      <ul style={{ paddingLeft: 18, margin: "0 0 14px", lineHeight: 1.7 }}>
        {pending.map((x) => (
          <li key={`${x.as}-${x.p.docKey}`}>
            <Link to={`/policies/${x.p.docKey}`} target="_blank" style={{ color: colors.greenText, fontWeight: 600 }}>{x.p.title}</Link>
            <span style={{ fontSize: 12.5, color: colors.mutedLight }}> · version {x.p.version}{x.p.changeSummary ? ` — ${x.p.changeSummary}` : ""}</span>
          </li>
        ))}
      </ul>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, fontFamily: fonts.body }}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I have read and accept {pending.length === 1 ? "this document" : "these documents"}.</span>
      </label>
      {error && <p role="alert" style={{ color: colors.danger, background: colors.dangerBg, padding: "8px 12px", borderRadius: radius.control, fontSize: 13 }}>{error}</p>}
    </Modal>
  );
}
