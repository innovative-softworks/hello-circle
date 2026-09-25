import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db/index.js";
import { TERMS_VERSION } from "./terms.js";

export interface Resident {
  id: string;
  email: string;
  name: string;
  homeCounty: string;
  homeLat: number | null;
  homeLng: number | null;
  createdAt: string;
  avatarUrl: string | null;
}

interface ResidentRow {
  id: string;
  email: string;
  name: string;
  home_county: string;
  home_lat: number | null;
  home_lng: number | null;
  created_at: string;
  avatar_url: string | null;
}

function rowToResident(row: ResidentRow): Resident {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    homeCounty: row.home_county,
    homeLat: row.home_lat,
    homeLng: row.home_lng,
    createdAt: row.created_at,
    avatarUrl: row.avatar_url,
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      resident?: Resident;
    }
  }
}

export async function getResidentByEmail(email: string): Promise<Resident | null> {
  const row = (await db.prepare(`SELECT * FROM residents WHERE email = ?`).get(email.toLowerCase().trim())) as ResidentRow | undefined;
  return row ? rowToResident(row) : null;
}

/** Creates the resident row the first time a guest verifies a magic link
 * (see routes/guestAuth.ts) — idempotent, since a verified email that
 * already has a resident row just returns it unchanged. Guests who never
 * sign in keep using the anonymous X-Client-Id flow with no resident row at
 * all; this never runs for them. */
export async function findOrCreateResident(email: string): Promise<Resident> {
  const normalized = email.toLowerCase().trim();
  const existing = await getResidentByEmail(normalized);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO residents (id, email) VALUES (?, ?)`).run(id, normalized);
  return { id, email: normalized, name: "", homeCounty: "", homeLat: null, homeLng: null, createdAt: new Date().toISOString(), avatarUrl: null };
}

// --- Google sign-in (Firebase Authentication verifies the identity server-
// side in googleAuth.ts; these functions resolve that verified identity to
// the same resident row the magic-link/password flows above already use —
// same guest_sessions cookie, same req.resident, nothing downstream needs
// to know which way someone signed in). -------------------------------------

export async function getResidentByGoogleUid(uid: string): Promise<Resident | null> {
  const row = (await db.prepare(`SELECT * FROM residents WHERE google_uid = ?`).get(uid)) as ResidentRow | undefined;
  return row ? rowToResident(row) : null;
}

/** Account-linking audit finding (see routes/guestAuth.ts's POST /google for
 * the full writeup): this used to auto-link a verified Google email onto
 * any existing resident with a matching email, on the theory that a
 * verified email was proof enough. That was **custom application logic**,
 * not anything Firebase itself does — Firebase Authentication's own
 * documented behaviour here (with this project's default "one account per
 * email" setting) is the opposite: it refuses to silently attach a second
 * provider to an existing identity and surfaces
 * `auth/account-exists-with-different-credential` instead, expecting the
 * app to run an explicit, verified linking step. Silently merging on email
 * match alone means anyone who once had transient control of an inbox
 * (a former employee on a shared alias, a role account) could later
 * register that email with Google and inherit the resident account behind
 * it. Fixed: sign-in no longer auto-links — see
 * createResidentFromGoogle/linkResidentGoogleUid below for the two
 * replacement paths (new-account creation, and explicit linking from an
 * already-authenticated session). */
export type GoogleSignInLookup =
  | { kind: "existing"; resident: Resident }
  | { kind: "new" }
  | { kind: "email_taken" };

/** Read-only resolution used by POST /google — never creates or links
 * anything by itself, just tells the caller which of the three cases
 * applies so it can respond appropriately (log in / show the "complete your
 * account" screen / reject with "sign in normally, then link from your
 * account"). This is a best-effort read for deciding what to *show* the
 * user, not the authoritative check — a concurrent request can always make
 * it stale between this read and whatever happens next, which is exactly
 * why createResidentFromGoogle below never trusts a prior call to this
 * function and re-derives its own answer atomically via the INSERT
 * itself. */
export async function resolveGoogleSignIn(uid: string, email: string): Promise<GoogleSignInLookup> {
  const byUid = await getResidentByGoogleUid(uid);
  if (byUid) return { kind: "existing", resident: byUid };
  const byEmail = await getResidentByEmail(email);
  if (byEmail) return { kind: "email_taken" };
  return { kind: "new" };
}

/** Thrown by createResidentFromGoogle when the email is already claimed by
 * a *different* identity — the route turns this into a 409, same shape as
 * resolveGoogleSignIn's "email_taken" case. */
export class ResidentEmailTakenError extends Error {}

/** Creates (or, for a concurrent completion of the same identity, resolves
 * to) the resident behind a verified Google identity — only ever called
 * from POST /guest/google/complete, after the person has seen and
 * confirmed the "Complete your HelloCircle account" screen (name, terms,
 * optional marketing consent).
 *
 * Deliberately does NOT speculatively check "does this email already
 * exist?" before inserting — any such read-then-write check has a race
 * window a concurrent completion of the exact same identity (double click,
 * two tabs) can land in, incorrectly turning a legitimate concurrent
 * success into a rejected "email already exists" error (a real bug this
 * fixed: two near-simultaneous completions of a brand-new identity could
 * intermittently reject one of them). The email's UNIQUE constraint is the
 * one thing that's actually atomic here, so it's the only thing this
 * relies on: attempt the insert, and only on a real conflict, re-check by
 * uid to tell "a concurrent request for this same identity just won" (not
 * an error — return that row) apart from "a genuinely different account
 * already has this email" (a real error). */
export async function createResidentFromGoogle(
  uid: string,
  email: string,
  name: string,
  picture: string | null,
  marketingConsent: boolean
): Promise<Resident> {
  const byUid = await getResidentByGoogleUid(uid);
  if (byUid) return byUid;

  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO residents (id, email, name, google_uid, avatar_url, email_verified_at, terms_accepted_at, terms_version, marketing_consent)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW(), ?, ?)`
      )
      .run(id, email, name, uid, picture, TERMS_VERSION, marketingConsent ? 1 : 0);
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      const winner = await getResidentByGoogleUid(uid);
      if (winner) return winner;
      throw new ResidentEmailTakenError("An account with this email already exists");
    }
    throw e;
  }
  return (await getResidentByEmail(email))!;
}

/** Explicit account linking — only ever called from an authenticated
 * resident's own session (POST /residents/me/google), never during sign-in.
 * The person is already proven to control `residentId` via their existing
 * session, so no further proof-of-control step is needed to attach a
 * Google identity onto it — this is the "documented", not-email-based
 * linking path the audit above replaces auto-linking with. Rejects if this
 * Google identity is already linked to a *different* resident, rather than
 * silently stealing it. */
export async function linkResidentGoogleUid(residentId: string, uid: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await getResidentByGoogleUid(uid);
  if (existing && existing.id !== residentId) {
    return { ok: false, error: "This Google account is already linked to a different HelloCircle account" };
  }
  await db.prepare(`UPDATE residents SET google_uid = ? WHERE id = ?`).run(uid, residentId);
  return { ok: true };
}

export async function updateResident(
  id: string,
  fields: { name?: string; homeCounty?: string; homeLat?: number | null; homeLng?: number | null }
): Promise<void> {
  await db
    .prepare(
      `UPDATE residents SET name = COALESCE(?, name), home_county = COALESCE(?, home_county),
       home_lat = COALESCE(?, home_lat), home_lng = COALESCE(?, home_lng) WHERE id = ?`
    )
    .run(fields.name, fields.homeCounty, fields.homeLat, fields.homeLng, id);
}

// --- Optional password login (My Life redesign) -----------------------------
// A second, opt-in way into the exact same resident identity magic-link
// already uses — same guest_sessions cookie, same req.resident, so nothing
// downstream (favourites/circles/bookings/My Life) needs to know or care
// which way someone signed in. password_hash is deliberately never part of
// the public Resident shape above; these are the only functions that touch it.

export async function getResidentPasswordHash(email: string): Promise<{ id: string; passwordHash: string | null } | null> {
  const row = (await db.prepare(`SELECT id, password_hash FROM residents WHERE email = ?`).get(email.toLowerCase().trim())) as
    | { id: string; password_hash: string | null }
    | undefined;
  return row ? { id: row.id, passwordHash: row.password_hash } : null;
}

export async function setResidentPassword(residentId: string, passwordHash: string): Promise<void> {
  await db.prepare(`UPDATE residents SET password_hash = ? WHERE id = ?`).run(passwordHash, residentId);
}

/** Creates a new resident from a completed magic-link signup — only ever
 * called from POST /guest/verify/complete, after consuming a
 * resident_signup_token that itself proves the earlier magic-link click
 * already verified this email (see guestAuth.ts). Mirrors
 * createResidentFromGoogle's exact shape (attempt the insert, and only on a
 * real ER_DUP_ENTRY conflict re-check by email — a concurrent completion of
 * the same identity, or a race against a different signup path for the same
 * email that won first, both resolve to "return the existing row" rather
 * than a spurious error) and sets email_verified_at at creation, since the
 * original token click already proved inbox access before this ran. */
export async function createResidentFromMagicLink(email: string, name: string, marketingConsent: boolean): Promise<Resident> {
  const normalized = email.toLowerCase().trim();
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO residents (id, email, name, email_verified_at, terms_accepted_at, terms_version, marketing_consent)
         VALUES (?, ?, ?, NOW(), NOW(), ?, ?)`
      )
      .run(id, normalized, name.trim(), TERMS_VERSION, marketingConsent ? 1 : 0);
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      const existing = await getResidentByEmail(normalized);
      if (existing) return existing;
    }
    throw e;
  }
  return (await getResidentByEmail(normalized))!;
}

/** Thrown by createResidentWithPassword when two concurrent signups for the
 * same brand-new email both pass the pre-check above and race each other to
 * the INSERT — residents.email's UNIQUE constraint is what actually decides
 * the winner; this just turns the loser's resulting ER_DUP_ENTRY into a
 * normal, expected 409 instead of an uncaught rejection (which the app's
 * final error handler would otherwise turn into a bare 500 — no stack trace
 * leaks either way, but a 500 tells the person nothing useful, where a 409
 * here can point them at logging in instead). */
export class ResidentSignupRaceError extends Error {}

/** Creates a new resident with a password, or — if a resident already
 * exists for that email (e.g. from a prior magic-link sign-in) and has no
 * password yet — attaches the password to that same existing account
 * instead of erroring. Returns null only when an account already has a
 * password set, so the caller can reject as "account already exists".
 * Deliberately never overwrites the existing account's name on this path:
 * the person filling in the signup form may not even know an account
 * already exists for that email, so whatever they type here shouldn't
 * silently clobber a name that's already on file (a real bug caught here —
 * an existing "Niamh O'Brien" briefly became "Niamh" from a signup form
 * that only had room for a first name). name is only used for a genuinely
 * new row below.
 *
 * termsAccepted/marketingConsent bring this path in line with the Google
 * signup flow (createResidentFromGoogle) and vendor signup, which have
 * always recorded consent — this was the one signup path that didn't (auth
 * UX audit finding C8). The route enforces termsAccepted before calling
 * this; it's still re-checked here as the function's own invariant since
 * nothing should be able to reach this INSERT without it. */
export async function createResidentWithPassword(
  email: string,
  passwordHash: string,
  name: string,
  termsAccepted: boolean,
  marketingConsent: boolean
): Promise<Resident | null> {
  if (!termsAccepted) throw new Error("termsAccepted is required to create a resident account");
  const normalized = email.toLowerCase().trim();
  const existing = await getResidentPasswordHash(normalized);
  if (existing) {
    if (existing.passwordHash) return null;
    await setResidentPassword(existing.id, passwordHash);
    // This person just ticked the Terms box on the form — record it on the
    // pre-existing (e.g. magic-link-created, consent-less) row too, but only
    // if no acceptance is on file already: never overwrite an earlier
    // timestamp/version, and never touch their existing marketing choice.
    await db
      .prepare(`UPDATE residents SET terms_accepted_at = NOW(), terms_version = ? WHERE id = ? AND terms_accepted_at IS NULL`)
      .run(TERMS_VERSION, existing.id);
    return await getResidentByEmail(normalized);
  }
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO residents (id, email, name, password_hash, terms_accepted_at, terms_version, marketing_consent)
         VALUES (?, ?, ?, ?, NOW(), ?, ?)`
      )
      .run(id, normalized, name.trim(), passwordHash, TERMS_VERSION, marketingConsent ? 1 : 0);
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new ResidentSignupRaceError("An account already exists for this email");
    throw e;
  }
  return { id, email: normalized, name: name.trim(), homeCounty: "", homeLat: null, homeLng: null, createdAt: new Date().toISOString(), avatarUrl: null };
}

/** Resolves req.resident from req.guestEmail (set by attachGuestEmail) —
 * mount after attachGuestEmail in index.ts. Never rejects, never creates a
 * row (creation only happens on verify) — a guest who's never signed in, or
 * whose verified email has no resident row yet, simply has no req.resident. */
export async function attachResident(req: Request, _res: Response, next: NextFunction) {
  if (req.guestEmail) {
    const resident = await getResidentByEmail(req.guestEmail);
    if (resident) req.resident = resident;
  }
  next();
}

export function requireResident(req: Request, res: Response, next: NextFunction) {
  if (!req.resident) return res.status(401).json({ error: "Sign in required" });
  next();
}
