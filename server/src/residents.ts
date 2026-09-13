import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db/index.js";

export interface Resident {
  id: string;
  email: string;
  name: string;
  homeCounty: string;
  homeLat: number | null;
  homeLng: number | null;
  createdAt: string;
}

interface ResidentRow {
  id: string;
  email: string;
  name: string;
  home_county: string;
  home_lat: number | null;
  home_lng: number | null;
  created_at: string;
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
  return { id, email: normalized, name: "", homeCounty: "", homeLat: null, homeLng: null, createdAt: new Date().toISOString() };
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
 * new row below. */
export async function createResidentWithPassword(email: string, passwordHash: string, name: string): Promise<Resident | null> {
  const normalized = email.toLowerCase().trim();
  const existing = await getResidentPasswordHash(normalized);
  if (existing) {
    if (existing.passwordHash) return null;
    await setResidentPassword(existing.id, passwordHash);
    return await getResidentByEmail(normalized);
  }
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO residents (id, email, name, password_hash) VALUES (?, ?, ?, ?)`).run(id, normalized, name.trim(), passwordHash);
  return { id, email: normalized, name: name.trim(), homeCounty: "", homeLat: null, homeLng: null, createdAt: new Date().toISOString() };
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
