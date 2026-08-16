import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db/index.js";

export interface Resident {
  id: string;
  email: string;
  name: string;
  homeCounty: string;
  createdAt: string;
}

interface ResidentRow {
  id: string;
  email: string;
  name: string;
  home_county: string;
  created_at: string;
}

function rowToResident(row: ResidentRow): Resident {
  return { id: row.id, email: row.email, name: row.name, homeCounty: row.home_county, createdAt: row.created_at };
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
  return { id, email: normalized, name: "", homeCounty: "", createdAt: new Date().toISOString() };
}

export async function updateResident(id: string, fields: { name?: string; homeCounty?: string }): Promise<void> {
  await db
    .prepare(`UPDATE residents SET name = COALESCE(?, name), home_county = COALESCE(?, home_county) WHERE id = ?`)
    .run(fields.name, fields.homeCounty, id);
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
