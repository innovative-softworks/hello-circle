// Phase 12 (Part 14) — unsigned Stripe webhooks are FAIL-SAFE by default.
//
// Before: with no STRIPE_WEBHOOK_SECRET and NODE_ENV !== "production", the
// webhook accepted unsigned events, so a staging/dev box missing its secret
// would mark bookings paid on a forged POST. Now signature verification is
// the default everywhere; unsigned events are accepted only with an explicit
// local opt-in, and never in production or staging whatever the flag says.
export function unsignedStripeWebhooksAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS !== "true") return false;
  if (env.NODE_ENV === "production") return false;
  const appEnv = (env.APP_ENV ?? "").toLowerCase();
  if (appEnv === "production" || appEnv === "staging") return false;
  return true;
}

/** One-line startup notice (never prints a secret). */
export function stripeWebhookModeNotice(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.STRIPE_WEBHOOK_SECRET) return null;
  if (unsignedStripeWebhooksAllowed(env)) {
    return "[stripe] WARNING: ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true — accepting UNSIGNED webhook events (local development only; anyone who can reach this server can forge payments)";
  }
  if (env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS === "true") {
    return "[stripe] ALLOW_UNSIGNED_STRIPE_WEBHOOKS is ignored in production/staging — webhooks will be refused until STRIPE_WEBHOOK_SECRET is set";
  }
  return "[stripe] STRIPE_WEBHOOK_SECRET not set — webhook events will be refused (set the secret, or ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true for local development only)";
}

/** Revenue & Connect Stage 2b (brief rule 10) — a LIVE Stripe key is refused
 * everywhere except a production deployment. Production is NODE_ENV=production
 * with APP_ENV unset or "production"; staging, development and test always
 * refuse live keys, so a copied production env can never charge real cards
 * from a non-production box. Test keys are always allowed. */
export function stripeKeyRefusal(key: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!key) return null;
  const live = /^(sk|rk)_live_/.test(key);
  if (!live) return null;
  const appEnv = (env.APP_ENV ?? "").toLowerCase();
  const production = env.NODE_ENV === "production" && (appEnv === "" || appEnv === "production");
  return production ? null : "[stripe] REFUSED a live Stripe key outside production (NODE_ENV/APP_ENV) — payments are disabled; use a test-mode key";
}
