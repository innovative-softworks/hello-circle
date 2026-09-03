// Reuses the existing hosted Stripe Checkout Sessions via an in-app browser
// rather than a native PaymentSheet — see the Phase 3 plan's decision:
// zero PaymentIntent code exists server-side, so this needs no new Stripe
// API shape and no webhook changes, only the mobile-aware success/cancel
// URL branch in checkoutService.ts (see server/src/index.ts's
// /mobile-checkout-return route).
import * as WebBrowser from 'expo-web-browser';

import { parseDeepLink } from '@/lib/linking';

export type CheckoutOutcome = { status: 'success' | 'cancel' | 'dismiss'; ref: string; type?: string };

// openAuthSessionAsync (not openBrowserAsync) is purpose-built for exactly
// this "open a browser, resolve when it redirects to a known URL" pattern
// — one awaited promise, no separate deep-link listener needed the way
// Phase 1's magic-link flow used addLinkListener. checkout-return deep
// links are consumed entirely here; _layout.tsx's listener never sees them.
export async function openCheckoutAndAwaitReturn(url: string): Promise<CheckoutOutcome> {
  const result = await WebBrowser.openAuthSessionAsync(url, 'hellocircle://checkout-return');
  if (result.type !== 'success' || !result.url) {
    return { status: result.type === 'dismiss' ? 'dismiss' : 'cancel', ref: '' };
  }
  const parsed = parseDeepLink(result.url);
  if (!parsed || parsed.path !== 'checkout-return') return { status: 'dismiss', ref: '' };
  const status = parsed.params.status === 'success' ? 'success' : 'cancel';
  return { status, ref: parsed.params.ref ?? '', type: parsed.params.type };
}

// The webhook can lag slightly behind the browser redirect — poll a few
// times before giving up rather than either blocking indefinitely or
// showing a false failure state.
export async function pollUntilPaid<T extends { paymentStatus: string }>(
  fetchStatus: (ref: string) => Promise<T>,
  ref: string,
  { attempts = 4, delayMs = 1500 }: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  let last: T = await fetchStatus(ref);
  for (let i = 1; i < attempts && last.paymentStatus !== 'paid'; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    last = await fetchStatus(ref);
  }
  return last;
}
