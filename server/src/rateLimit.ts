import type { NextFunction, Request, Response } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

/** Minimal in-memory per-IP rate limit — no external dependency, no
 * persistence across restarts. There's no other brute-force protection
 * anywhere in this app; this is scoped to the handful of routes that let a
 * client repeatedly guess a (ref, email) pair (booking/registration lookup
 * and cancel-by-email).
 *
 * Keyed by req.ip, which collapses to a single bucket behind a reverse
 * proxy unless `app.set('trust proxy', ...)` is configured — index.ts does
 * this when the TRUST_PROXY_HOPS env var is set to the real hop count. */
export function simpleRateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();
  // Entries were previously only ever overwritten on a visiting IP's next
  // request, never deleted — an IP that hits a limited route once and never
  // returns left a permanent entry, so the Map grew without bound over the
  // life of the process. A lazy sweep (piggybacked on normal traffic,
  // amortized, no extra timer) evicts anything whose window has expired.
  let lastSweep = Date.now();
  const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();

    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = now;
      for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
    }

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= max) {
      return res.status(429).json({ error: "Too many attempts — please try again later" });
    }
    bucket.count++;
    next();
  };
}

/** Shared across booking/registration lookup-by-ref+email and
 * cancel-by-email — one combined guess-budget per IP across both surfaces. */
export const lookupLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

/** Guards POST /api/guest/request-link. Lower max than lookupLimiter — the
 * concern here isn't guessing a secret (nothing to guess, any email is
 * accepted), it's spamming an inbox with unwanted sign-in emails. */
export const magicLinkLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

/** Guards password login/signup/change — an actual secret worth guarding
 * against brute force, unlike the magic-link routes above. */
export const passwordLoginLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

/** Guards POST /guest/google and /auth/google. A different risk shape than
 * password login — a Firebase ID token isn't a guessable secret, so this
 * isn't a brute-force concern — but it's still worth a generous cap against
 * scripted abuse, kept separate from passwordLoginLimiter's tighter budget
 * so a real user isn't blocked from Google sign-in just because they (or
 * this app's own resident/vendor screens on one shared IP) recently hit the
 * password-login limiter too. */
export const googleAuthLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
