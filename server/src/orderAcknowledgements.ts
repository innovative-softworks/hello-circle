import crypto from "node:crypto";
import type { db } from "./db/index.js";

// Booking UX Phase 4 (audit B8/B7/B9) — what a customer agreed to with an
// order, the named people in a party, and the minimum-age declaration.
//
// The booking terms version is resolved HERE, from the policy CMS, at the
// moment of the order — never taken from the client — so the record says
// which text was in force. Before Terms are published there is no version to
// point at, and the row says so (doc_version NULL) rather than inventing one.
// Every order call clears what an earlier order with the same ref left
// behind (an abandoned pending row is deleted, freeing its random ref).

type Tx = Pick<typeof db, "prepare">;

export const BOOKING_TERMS_DOC = "customer-booking-terms";

export type AckKind = "terms" | "safety";

/** A short, stable fingerprint of the exact text someone was shown. */
export function textFingerprint(text: string): string {
  return crypto.createHash("sha256").update(text.trim()).digest("hex").slice(0, 32);
}

export async function recordOrderAcknowledgements(
  tx: Tx,
  input: { sourceType: string; ref: string; clientId: string | null; residentId: string | null; terms?: boolean; safetyText?: string | null }
): Promise<void> {
  // A deleted (abandoned) pending row frees its random ref for reuse: never
  // let a later order inherit an earlier order's acknowledgements.
  await tx.prepare(`DELETE FROM order_acknowledgements WHERE source_type = ? AND source_ref = ?`).run(input.sourceType, input.ref);
  if (input.terms) {
    const current = (await tx.prepare(`SELECT version FROM policy_versions WHERE doc_key = ? AND status = 'published' LIMIT 1`).get(BOOKING_TERMS_DOC)) as { version: number } | undefined;
    await tx
      .prepare(`INSERT INTO order_acknowledgements (source_type, source_ref, kind, doc_key, doc_version, client_id, resident_id) VALUES (?, ?, 'terms', ?, ?, ?, ?)`)
      .run(input.sourceType, input.ref, BOOKING_TERMS_DOC, current ? Number(current.version) : null, input.clientId, input.residentId);
  }
  if (input.safetyText && input.safetyText.trim()) {
    await tx
      .prepare(`INSERT INTO order_acknowledgements (source_type, source_ref, kind, text_fingerprint, client_id, resident_id) VALUES (?, ?, 'safety', ?, ?, ?)`)
      .run(input.sourceType, input.ref, textFingerprint(input.safetyText), input.clientId, input.residentId);
  }
}

/** Validates optional per-seat names for a party. Returns the cleaned names,
 * null when none were sent (older clients), or an error message. */
export function cleanParticipantNames(raw: unknown, partySize: number): string[] | null | { error: string } {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length !== partySize) return { error: "Give a name for each person in the party" };
  const names = raw.map((n) => (typeof n === "string" ? n.trim().replace(/\s+/g, " ") : ""));
  if (names.some((n) => !n || n.length > 120)) return { error: "Give a name for each person in the party" };
  return names;
}

export async function recordParticipantNames(tx: Tx, ref: string, names: string[]): Promise<void> {
  // An abandoned checkout's row is deleted (not failed), so a later order can
  // reuse its random ref — never inherit or collide with its seats.
  await tx.prepare(`DELETE FROM experience_booking_participants WHERE booking_ref = ?`).run(ref);
  for (let i = 0; i < names.length; i++) {
    await tx.prepare(`INSERT INTO experience_booking_participants (booking_ref, seat, name) VALUES (?, ?, ?)`).run(ref, i + 1, names[i]);
  }
}

/** B9 — a listing with a minimum age needs the booker to confirm everyone
 * taking part meets it. There's no verified age on file for residents or
 * guests, so this is a declaration the order records, not an ID check. */
export function minAgeError(minAge: number | null | undefined, declared: unknown): string | null {
  if (!minAge || minAge <= 0) return null;
  return declared === true ? null : `Everyone taking part must be at least ${minAge} — please confirm`;
}
