import crypto from "node:crypto";

/** crypto.randomInt, not Math.random — refs double as a lookup key anyone
 * with the number can use (see /status/:ref), so they shouldn't be
 * guessable via a weak PRNG. */
export function generateRef(prefix: string): string {
  const n = crypto.randomInt(100000, 999999);
  return `${prefix}-${n}`;
}

export function clientIdFrom(req: { header(name: string): string | undefined }): string {
  const id = req.header("X-Client-Id");
  if (!id) throw new BadRequestError("X-Client-Id header is required");
  return id;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

/** Server-side coordinate validation (Maps cost-control follow-up pass, §6)
 * — every vendor-facing centre/club/experience create/update route runs
 * client-supplied lat/lng through this before it ever reaches a query,
 * since client-side validation alone isn't trustworthy. `undefined` for
 * both means "not supplied, leave existing value alone" (the COALESCE
 * pattern every one of these routes already uses) — that's valid, not an
 * error. `null` for both means "explicitly clearing the location" — also
 * valid. Anything else must be two finite numbers in range; a lone
 * lat-without-lng (or vice versa) is rejected rather than silently
 * geocoding half a pair. Deliberately checks `typeof === "number"` rather
 * than a truthy check — 0 is a legal (if irrelevant-for-Ireland) coordinate
 * value, not a missing one. */
export function invalidCoordinateReason(lat: unknown, lng: unknown): string | null {
  if (lat === undefined && lng === undefined) return null;
  if (lat === null && lng === null) return null;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "lat and lng must both be numbers (or both omitted/null)";
  }
  if (lat < -90 || lat > 90) return "lat must be between -90 and 90";
  if (lng < -180 || lng > 180) return "lng must be between -180 and 180";
  return null;
}

export class BadRequestError extends Error {}

/** Thrown for a 409 — the request was well-formed but conflicts with
 * current state (e.g. a booking slot that's just been taken). */
export class ConflictError extends Error {}

/** A booking of >=8h is treated as occupying the whole day (matches the
 * booking flow's "Full day" duration option) — this gives its exclusive
 * end hour, e.g. bookingEndHour(10, 3) === 13. */
export function bookingEndHour(startHour: number, duration: number): number {
  return duration >= 8 ? 24 : startHour + duration;
}

/** Half-open interval overlap: [aStart, aEnd) vs [bStart, bEnd). */
export function hoursOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
