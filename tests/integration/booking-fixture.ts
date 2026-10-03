import { randomUUID } from "node:crypto";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { expect, env } from "./fixtures";
import { centreFor, clubFor, experienceFor, programFor, type Scope } from "./stage-b-fixture";
import { rows } from "./lifecycle-fixture";

// Phase 8 booking-integrity helpers. Synthetic resources owned by the QA
// vendor, made bookable through exact-ID updates on the rows THIS test
// created (approve/publish/price/capacity) — the same safe-control pattern
// earlier phases use. Payment provider stays unconfigured throughout.

export function irelandDate(daysAhead: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + daysAhead * 86400000));
}

/** An anonymous guest with its own X-Client-Id (the guest ownership key). */
export async function guest(playwright: PlaywrightWorkerArgs["playwright"], opened: APIRequestContext[]) {
  const clientId = randomUUID();
  const ctx = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL, extraHTTPHeaders: { "X-Client-Id": clientId } });
  opened.push(ctx);
  return { ctx, clientId, email: `qa_guest_${clientId.slice(0, 8)}@example.test` };
}

export async function bookableCentre(f: Scope, opts: { rate?: number; cap?: number; payment?: "cash" | "online" } = {}) {
  const centre = await centreFor(f, "QA_VENDOR");
  await f.connection.execute("UPDATE centres SET status = 'approved', is_open = 1, opens_at = '09:00', closes_at = '21:00' WHERE id = ?", [centre.id]);
  await f.connection.execute("UPDATE rooms SET cap = ?, rate = ?, payment_method = ?, active = 1 WHERE centre_id = ?", [opts.cap ?? 10, opts.rate ?? 20, opts.payment ?? "cash", centre.id]);
  f.track("notifications", "listing_id", centre.id);
  return centre;
}

export function bookingBody(centre: { id: string; room: string }, email: string, extra: Record<string, unknown> = {}) {
  return { centreId: centre.id, roomId: centre.room, date: irelandDate(14), time: "10:00", duration: 2, eventType: "QA party", guests: 5, name: "QA booker", email, phone: "000", ...extra };
}

export async function bookableClub(f: Scope, opts: { price?: number; capacity?: number | null; payment?: "cash" | "online" } = {}) {
  const id = await clubFor(f, "QA_VENDOR");
  await f.connection.execute("UPDATE clubs SET price = ?, capacity = ?, payment_method = ? WHERE id = ?", [opts.price ?? 0, opts.capacity ?? null, opts.payment ?? "online", id]);
  f.track("waitlist_entries", "listing_id", id); f.track("notifications", "listing_id", id);
  return id;
}

export function registrationBody(club: string, email: string, extra: Record<string, unknown> = {}) {
  return { clubId: club, registrantType: "adult", childFirst: "QA", childLast: `Adult${randomUUID().slice(0, 4)}`, gFirst: "QA", gLast: "Adult", email, phone: "000", address: "QA", consent: true, trial: false, ...extra };
}

export async function bookableProgram(f: Scope, opts: { price?: number; capacity?: number | null } = {}) {
  const centre = await centreFor(f, "QA_VENDOR");
  const id = await programFor(f, "QA_VENDOR", centre.id);
  await f.connection.execute("UPDATE programs SET status = 'published', price_cents = ?, capacity = ? WHERE id = ?", [opts.price ?? 0, opts.capacity ?? null, id]);
  f.track("notifications", "listing_id", centre.id);
  return { id, centre: centre.id };
}

export async function bookableExperience(f: Scope, opts: { price?: number; capacity?: number; payment?: "cash" | "online"; date?: string } = {}) {
  const id = await experienceFor(f, "QA_VENDOR");
  await f.connection.execute("UPDATE experiences SET status = 'approved', kind = 'adventure', title = ?, price_cents = ?, capacity = ?, payment_method = ? WHERE id = ?",
    [`QA adventure ${randomUUID().slice(0, 6)}`, opts.price ?? 0, opts.capacity ?? 8, opts.payment ?? "cash", id]);
  const session = randomUUID();
  await f.connection.execute("INSERT INTO experience_sessions (id, experience_id, date, time, capacity, status) VALUES (?, ?, ?, '10:00', ?, 'scheduled')", [session, id, opts.date ?? irelandDate(14), opts.capacity ?? 8]);
  f.track("notifications", "listing_id", id);
  f.track("audit_log", "object_id", session); // a vendor session cancel audits by session id
  const [row] = await rows(f, "SELECT title FROM experiences WHERE id = ?", [id]);
  return { id, session, title: row.title as string };
}

export const experienceBody = (email: string, extra: Record<string, unknown> = {}) => ({ participantName: "QA participant", email, phone: "000", partySize: 1, ...extra });

/** Expected server total for a subtotal in cents (VAT 23% + platform fee 5%, integer cents). */
export function expectedTotal(subtotalCents: number, depositCents = 0) {
  return subtotalCents + Math.round(subtotalCents * 0.23) + Math.round(subtotalCents * 0.05) + depositCents;
}

export async function outbound(actor: APIRequestContext) {
  const r = await actor.get("/api/__qa/outbound");
  expect(r.status()).toBe(200);
  return r.json() as Promise<{ blockedOutboundAttempts: number; paymentProviderConfigured: boolean }>;
}

export async function synthCoupon(f: Scope, opts: { kind: "percent" | "fixed"; amount: number; maxUses?: number | null; expires?: string | null; listingType?: string; listingId?: string }) {
  const code = `QA${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  await f.connection.execute("INSERT INTO coupons (code, kind, amount, max_uses, expires_at, active, eligible_listing_type, eligible_listing_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
    [code, opts.kind, opts.amount, opts.maxUses ?? null, opts.expires ?? null, opts.listingType ?? null, opts.listingId ?? null]);
  f.track("coupons", "code", code);
  return code;
}
