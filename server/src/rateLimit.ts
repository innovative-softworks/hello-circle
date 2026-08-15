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
 * proxy unless `app.set('trust proxy', ...)` is configured — acceptable for
 * this app's current deployment. */
export function simpleRateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
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
