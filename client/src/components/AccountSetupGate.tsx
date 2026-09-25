import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { fetchResidentFull } from "../api";
import { useAuth } from "../AuthContext";
import { useGuest } from "../GuestContext";
import type { ResidentFull } from "../types";

// Account setup popups (onboarding audit: G1 shorter onboarding shown as a
// popup instead of a page, and E1 renewed Terms acceptance). This file is
// the small always-loaded part — it only decides *whether* something needs
// to show; the dialogs themselves are lazy-loaded (AccountSetupDialogs.tsx)
// so an anonymous visitor never downloads them.
//
// Why a popup over the current page rather than a /onboarding route: the
// old flow redirected a new account away from what it came to do (join a
// Circle, book, host) and only got back to it, if at all, after eight
// screens. The popup opens over the intended destination and closes back
// onto it, so nothing about the original intent has to be carried through.
//
// Priority: Terms first, then onboarding — never two dialogs at once.
// Never shown on the auth pages, and never over a booking/registration/
// payment flow (an interruption there costs a booking, not just a click).

const OPEN_ONBOARDING_EVENT = "hc:open-onboarding";

/** Opens the onboarding popup on demand (My Life's "choose interests"
 * nudges) even if it was completed before — it then edits, not restarts. */
export function openOnboarding() {
  window.dispatchEvent(new Event(OPEN_ONBOARDING_EVENT));
}

const NEVER_INTERRUPT = [
  "/signin",
  "/login",
  "/accept-invite",
  "/forgot-password",
  "/reset-password",
  "/vendor/signup",
  "/coming-soon",
  "/landing",
  "/privacy",
  "/cookies",
  "/manage/link-confirm",
  "/book/",
  "/register/",
  "/payment/",
];
const STAFF_AREAS = ["/vendor", "/admin"];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

const Dialogs = lazy(() => import("./AccountSetupDialogs").then((m) => ({ default: m.AccountSetupDialogs })));

export function AccountSetupGate() {
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { resident, refresh: refreshGuest } = useGuest();
  const { user, refresh: refreshAuth } = useAuth();
  const [full, setFull] = useState<ResidentFull | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const residentId = resident?.id;

  const loadFull = useCallback(async () => {
    try {
      const { resident: r } = await fetchResidentFull();
      setFull(r);
    } catch {
      setFull(null);
    }
  }, []);

  useEffect(() => {
    if (!residentId) {
      setFull(null);
      return;
    }
    loadFull();
  }, [residentId, loadFull]);

  useEffect(() => {
    const open = () => setManualOpen(true);
    window.addEventListener(OPEN_ONBOARDING_EVENT, open);
    return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, open);
  }, []);

  const setupParam = searchParams.get("setup") === "1";
  const closeOnboarding = useCallback(() => {
    setManualOpen(false);
    if (setupParam) {
      const next = new URLSearchParams(searchParams);
      next.delete("setup");
      setSearchParams(next, { replace: true });
    }
  }, [setupParam, searchParams, setSearchParams]);

  if (matches(pathname, NEVER_INTERRUPT)) return null;

  // Strictly null, not undefined: an older /auth/me response that doesn't
  // carry the field must never look like "no acceptance on file".
  const vendorNeedsTerms = user?.role === "vendor" && user.termsAcceptedAt === null;
  const residentNeedsTerms = !!full && !full.termsAcceptedAt;
  const onStaffArea = matches(pathname, STAFF_AREAS);
  const wantsOnboarding = !!full && !onStaffArea && (!full.onboardingCompleted || manualOpen || setupParam);

  let mode: "terms-resident" | "terms-vendor" | "onboarding" | null = null;
  if (residentNeedsTerms) mode = "terms-resident";
  else if (vendorNeedsTerms) mode = "terms-vendor";
  else if (wantsOnboarding) mode = "onboarding";
  if (!mode) return null;

  return (
    <Suspense fallback={null}>
      <Dialogs
        mode={mode}
        resident={full}
        onResidentChanged={async () => {
          await loadFull();
          await refreshGuest();
        }}
        onVendorChanged={refreshAuth}
        onCloseOnboarding={closeOnboarding}
      />
    </Suspense>
  );
}
