// Placeholder acquisition-event hook for the /for-venues page. No real
// analytics provider is wired into this codebase yet (the only existing
// event logging, api/public.ts's logReferralLand/logReferralShare, is
// backed by a real `referrals` DB table for a different, narrower purpose)
// — this just gives every call site a stable name/shape to call now, so a
// real provider can be dropped in behind this one function later without
// touching the page/section components again.
export function trackVendorEvent(event: string, props?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug(`[vendor-analytics] ${event}`, props ?? {});
  }
}
