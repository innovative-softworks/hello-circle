import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { setSessionExpiredHandler, type SessionKind } from "../api/core";
import { signInHref, vendorLoginHref } from "../authRedirect";
import { useAuth } from "../AuthContext";
import { useGuest } from "../GuestContext";
import { colors, radius, zIndex } from "../theme";

// Centralised session-expiry recovery (implementing the auth audit's "handle
// expired sessions deliberately" requirement) — the one place in the app that
// reacts to api/core.ts's session-expired signal. Deliberately does NOT fire
// on every 401 (core.ts already filters out login/signup/verify attempts,
// which are expected failures the calling form shows inline itself) and
// deliberately does NOT auto-retry whatever request failed — it only offers
// a safe way back in.

const AUTH_PAGE_PREFIXES = ["/login", "/signin", "/accept-invite", "/forgot-password", "/reset-password", "/vendor/signup"];

function isOnAuthPage(pathname: string): boolean {
  return AUTH_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function SessionExpiryBanner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh: refreshAuth } = useAuth();
  const { refresh: refreshGuest } = useGuest();
  const [expiredKind, setExpiredKind] = useState<SessionKind | null>(null);
  // Two or more requests can fail with 401 within the same tick (e.g. a
  // dashboard firing several fetches on mount) — this collapses that burst
  // into a single recovery banner instead of one per failed request.
  const handledRef = useRef(false);

  useEffect(() => {
    setSessionExpiredHandler((kind) => {
      if (isOnAuthPage(location.pathname) || handledRef.current) return;
      handledRef.current = true;
      // Clears the stale signed-in UI (avatar menu, dashboard nav, etc.)
      // immediately rather than waiting for whatever next re-fetches it —
      // the cookie is already gone server-side, so this just brings client
      // state in line with reality, not a new privilege change.
      if (kind === "vendor") refreshAuth();
      else refreshGuest();
      setExpiredKind(kind);
    });
    return () => setSessionExpiredHandler(null);
  }, [location.pathname, refreshAuth, refreshGuest]);

  // Self-clears once the person is on an auth page by any route (clicked
  // through, or navigated there themselves) so a later, later session
  // expiry can trigger the banner again instead of staying permanently
  // silenced by the earlier handledRef guard.
  useEffect(() => {
    if (isOnAuthPage(location.pathname)) {
      setExpiredKind(null);
      handledRef.current = false;
    }
  }, [location.pathname]);

  if (!expiredKind) return null;

  const dismiss = () => {
    setExpiredKind(null);
    handledRef.current = false;
  };

  const signInNow = () => {
    const target = expiredKind === "vendor" ? vendorLoginHref() : signInHref();
    dismiss();
    navigate(target);
  };

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: "calc(12px + env(safe-area-inset-top))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: zIndex.modal,
        maxWidth: "calc(100vw - 24px)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: colors.dangerBg,
        color: colors.danger,
        padding: "11px 14px",
        borderRadius: radius.control,
        boxShadow: "0 12px 32px rgba(30,40,32,.18)",
        fontSize: 13.5,
        fontWeight: 600,
      }}
    >
      <span>Your session has expired. Sign in again to continue.</span>
      <button
        type="button"
        onClick={signInNow}
        style={{ background: "none", border: "none", padding: 0, fontWeight: 800, color: colors.danger, textDecoration: "underline", cursor: "pointer", flex: "none" }}
      >
        Sign in
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{ background: "none", border: "none", padding: 0, color: colors.danger, cursor: "pointer", flex: "none", fontSize: 16, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  );
}
