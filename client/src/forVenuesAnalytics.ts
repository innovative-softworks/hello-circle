import { trackEvent } from "./analytics";

// Vendor-recruitment-page-specific alias for the shared trackEvent() hook
// (see analytics.ts) — kept as its own export so every existing call site
// (ForVenues.tsx, BecomeAHost.tsx) is unchanged. The only existing *real*
// event logging in this codebase, api/public.ts's logReferralLand/
// logReferralShare, is backed by a real `referrals` DB table for a
// different, narrower purpose — this stays a placeholder until a real
// analytics provider is wired in.
export function trackVendorEvent(event: string, props?: Record<string, unknown>): void {
  trackEvent(event, props);
}
