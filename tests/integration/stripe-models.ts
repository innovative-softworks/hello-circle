import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { expect, env } from "./fixtures";
import { rows, createActivity } from "./lifecycle-fixture";
import type { Scope } from "./stage-b-fixture";
import { bookableCentre, bookableClub, bookableExperience, bookableProgram, bookingBody, experienceBody, guest, registrationBody } from "./booking-fixture";
import { stripe } from "./stripe-fixture";

// Phase 9 — one paid TEST-mode checkout per booking model, through the real
// public routes. Returns the local pending row identity + provider session.

export type Model = "hall" | "club" | "programme" | "experience" | "activity";
export const MODELS: Model[] = ["hall", "club", "programme", "experience", "activity"];
export const TABLE: Record<Model, { table: string; type: string; pending: string }> = {
  hall: { table: "bookings", type: "booking", pending: "payment_status = 'pending'" },
  club: { table: "registrations", type: "registration", pending: "payment_status = 'pending'" },
  programme: { table: "program_enrollments", type: "program", pending: "payment_status = 'pending'" },
  experience: { table: "experience_bookings", type: "experience", pending: "payment_status = 'pending'" },
  activity: { table: "game_participants", type: "game", pending: "status = 'pending_payment'" },
};

export interface Paid { model: Model; ref: string; url: string; totalEuro: number; sessionId: string; listing: string; actor: APIRequestContext }

/** Creates a capacity-1 paid resource for `model` (owned by QA_VENDOR / QA_HOST). */
export async function paidResource(f: Scope, model: Model, opts: { couponCode?: string } = {}) {
  if (model === "hall") return { model, listing: (await bookableCentre(f, { rate: 20, cap: 10, payment: "online" })) };
  if (model === "club") return { model, listing: await bookableClub(f, { price: 30, capacity: 1, payment: "online" }) };
  if (model === "programme") {
    const p = await bookableProgram(f, { price: 2500, capacity: 1 });
    await f.connection.execute("INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (UUID(), ?, DATE_ADD(CURDATE(), INTERVAL 20 DAY), '18:00', 'scheduled')", [p.id]);
    f.track("program_sessions", "program_id", p.id);
    return { model, listing: p };
  }
  if (model === "experience") return { model, listing: await bookableExperience(f, { price: 1500, capacity: 1, payment: "online" }) };
  return { model, listing: await createActivity(f, "QA_HOST", { capacity: 2, priceCents: 800 }) }; // host holds one seat → one bookable place
}

/** Real paid checkout for one participant; `who` is a guest ctx or a resident actor (activities). */
export async function checkout(model: Model, listing: any, actor: APIRequestContext, email: string, extra: Record<string, unknown> = {}) {
  const path = model === "hall" ? "/api/bookings/checkout"
    : model === "club" ? "/api/registrations/checkout"
    : model === "programme" ? `/api/programs/${listing.id}/enroll`
    : model === "experience" ? `/api/experiences/${listing.id}/sessions/${listing.session}/checkout`
    : `/api/games/${listing.id}/join`;
  const data = model === "hall" ? bookingBody(listing, email, extra)
    : model === "club" ? registrationBody(listing, email, extra)
    : model === "programme" ? { participantName: `QA ${email.slice(9, 13)}`, email, ...extra }
    : model === "experience" ? experienceBody(email, extra)
    : { ...extra };
  return actor.post(path, { data });
}

export async function localRow(f: Scope, model: Model, ref: string) {
  const [row] = await rows(f, `SELECT * FROM ${TABLE[model].table} WHERE ref = ?`, [ref]);
  return row as Record<string, any> | undefined;
}

/** Hosted-Checkout sessions this harness created since `since` (scoped by our return origin). */
export async function providerSessionsSince(since: number) {
  const list = await stripe.checkout.sessions.list({ created: { gte: since }, limit: 100 });
  return list.data.filter(s => (s.success_url ?? "").startsWith(env.CLIENT_URL ?? env.E2E_BASE_URL));
}

export async function guests(playwright: PlaywrightWorkerArgs["playwright"], opened: APIRequestContext[], n: number) {
  return Promise.all(Array.from({ length: n }, () => guest(playwright, opened)));
}
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export function expectEur(session: { currency: string | null }) { expect(session.currency).toBe("eur"); }
