import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cancelSpotAlert, createSpotAlert, fetchMySpotAlerts } from "../../api";
import { signInHref } from "../../authRedirect";
import { useExperienceFeatures } from "../../circleFeatures";
import { useGuest } from "../../GuestContext";
import { BellIcon } from "../icons";

// Experience 3.0 — "Tell me if a place opens" on a full experience/adventure
// departure (experience.spot_alerts, owner decision D4). It never holds a
// place: when one opens we tell everyone waiting once, and the first to book
// gets it. The copy says so.

let mine: Promise<Set<string>> | null = null;
function mySessions(): Promise<Set<string>> {
  if (!mine) mine = fetchMySpotAlerts().then((rows) => new Set(rows.filter((r) => !r.notifiedAt).map((r) => r.sessionId))).catch(() => new Set<string>());
  return mine;
}

export function SpotAlertButton({ experienceId, sessionId, label }: { experienceId: string; sessionId: string; label?: string }) {
  const on = useExperienceFeatures()["experience.spot_alerts"];
  const { resident } = useGuest();
  const navigate = useNavigate();
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!on || !resident) return;
    let live = true;
    mySessions().then((s) => live && setSubscribed(s.has(sessionId)));
    return () => {
      live = false;
    };
  }, [on, resident, sessionId]);
  if (!on) return null;
  const toggle = async () => {
    if (!resident) return navigate(signInHref());
    setBusy(true);
    setMessage(null);
    try {
      if (subscribed) await cancelSpotAlert(experienceId, sessionId);
      else await createSpotAlert(experienceId, sessionId);
      mine = null;
      setSubscribed(!subscribed);
      setMessage(subscribed ? "Alert removed." : "We'll tell you if a place opens. It won't be held, so book soon when you hear.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button type="button" className="ce-link" onClick={toggle} disabled={busy} aria-pressed={subscribed} style={{ display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
        <BellIcon size={14} /> {busy ? "…" : subscribed ? "Alert on — stop alerts" : label ?? (resident ? "Tell me if a place opens" : "Sign in to be told if a place opens")}
      </button>
      {message && (
        <span role="status" style={{ fontSize: 12.5, color: "var(--color-muted-light)" }}>
          {message}
        </span>
      )}
    </div>
  );
}
