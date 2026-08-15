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
