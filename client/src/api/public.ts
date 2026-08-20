import { getClientId } from "../clientId";
import type { Centre, Club, DiscoverFeed, DiscoverItem, LocalMomentumSignal, MyBooking, MyProgramEnrollment, MyRegistration, Program, Review, SearchParsed, SearchResult } from "../types";
import { request } from "./core";

// Guest-facing browsing + transactions — no account needed. Centres/clubs,
// availability, bookings/registrations, pricing/coupons, search, discovery
// feeds, reviews, uploads. Split out of the original single api.ts (see
// CLAUDE.md).

export function fetchCentres(county?: string): Promise<Centre[]> {
  const qs = county && county !== "All" ? `?county=${encodeURIComponent(county)}` : "";
  return request(`/centres${qs}`);
}

export function fetchCentre(id: string): Promise<Centre> {
  return request(`/centres/${id}`);
}

export function fetchClubs(county?: string, sport?: string): Promise<Club[]> {
  const params = new URLSearchParams();
  if (county && county !== "All") params.set("county", county);
  if (sport && sport !== "All") params.set("sport", sport);
  const qs = params.toString();
  return request(`/clubs${qs ? `?${qs}` : ""}`);
}

export function fetchClub(id: string): Promise<Club> {
  return request(`/clubs/${id}`);
}

/** `centreId` disambiguates `roomId` — rooms.id is only unique per-centre
 * (schema's own PRIMARY KEY (centre_id, id)), so a room_id-only lookup can
 * silently resolve a different centre's room sharing the same short id. */
export function fetchAvailability(centreId: string, roomId: string, date: string, duration = 1): Promise<{ slots: string[]; bookedTimes: string[]; closed: boolean }> {
  return request(`/availability?centreId=${encodeURIComponent(centreId)}&roomId=${encodeURIComponent(roomId)}&date=${encodeURIComponent(date)}&duration=${duration}`);
}

export function fetchAvailabilityRange(centreId: string, roomId: string, from: string, days = 60): Promise<{ closedDates: string[] }> {
  return request(`/availability/range?centreId=${encodeURIComponent(centreId)}&roomId=${encodeURIComponent(roomId)}&from=${encodeURIComponent(from)}&days=${days}`);
}

export interface CreateBookingInput {
  centreId: string;
  roomId: string;
  date: string;
  time: string;
  duration: number;
  eventType: string;
  guests: number;
  name: string;
  email: string;
  phone: string;
  notes?: string;
  couponCode?: string;
  /** Open Booking (Phase 3) — how many additional spots to open to other
   * residents once this booking is confirmed. Requires being signed in. */
  openSpots?: number;
}

/** Creates a pending booking + a Stripe Checkout session — the caller
 * should redirect the browser to `url`. The booking is only confirmed once
 * Stripe's webhook fires; nothing is finalized by this call alone. */
export function createBookingCheckout(input: CreateBookingInput): Promise<{ ref: string; url?: string; totalEuro: number }> {
  return request(`/bookings/checkout`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchBookingStatus(ref: string): Promise<{ ref: string; paymentStatus: string; totalCents: number }> {
  return request(`/bookings/status/${encodeURIComponent(ref)}`);
}

// --- Make It Happen (implementation plan Phase 10) --------------------------
// "Pick activity/time/place/participant-count/budget → HelloCircle finds a
// facility, prices it, proposes it, recruits participants, confirms once
// viable." Functionally Open Booking + Minimum Participation started from a
// blank search instead of an existing reservation — see makeItHappen.ts.

export interface MakeItHappenSearchInput {
  activityLabel: string;
  county?: string;
  date: string;
  time: string;
  duration: number;
  partySize: number;
  maxBudgetPerPersonCents?: number;
}

export interface MakeItHappenCandidate {
  centreId: string;
  centreName: string;
  area: string;
  county: string;
  roomId: string;
  roomName: string;
  capacity: number;
  perPersonCents: number;
  totalCents: number;
  paymentMethod: "online" | "cash";
}

/** Read-only — finds up to 3 ranked candidate venues/slots, cheapest per
 * person first. Nothing is booked until confirmMakeItHappen(). */
export function searchMakeItHappen(input: MakeItHappenSearchInput): Promise<MakeItHappenCandidate[]> {
  return request(`/make-it-happen/search`, { method: "POST", body: JSON.stringify(input) });
}

export interface MakeItHappenConfirmInput extends MakeItHappenSearchInput {
  centreId: string;
  roomId: string;
  name: string;
  email: string;
  phone: string;
  notes?: string;
}

/** Books the chosen candidate — same behavior as createBookingCheckout
 * (redirect to `url` if present), but requires a signed-in resident since
 * the recruiting game needs a host. */
export function confirmMakeItHappen(input: MakeItHappenConfirmInput): Promise<{ ref: string; url?: string; totalEuro: number }> {
  return request(`/make-it-happen/confirm`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchMyBookings(): Promise<MyBooking[]> {
  return request(`/bookings`);
}

/** Recovers a booking made on another device/browser — proven by ref +
 * the email used at checkout, not the usual X-Client-Id. */
export function lookupBooking(ref: string, email: string): Promise<MyBooking> {
  return request(`/bookings/lookup`, { method: "POST", body: JSON.stringify({ ref, email }) });
}

/** `email` is only needed when cancelling a booking recovered via
 * lookupBooking (no matching X-Client-Id on this device) — omit it for a
 * normal same-device cancel. */
export function cancelBooking(ref: string, email?: string): Promise<{ ok: boolean }> {
  return request(`/bookings/${encodeURIComponent(ref)}/cancel`, {
    method: "POST",
    body: email ? JSON.stringify({ email }) : undefined,
  });
}

export function rescheduleBooking(ref: string, date: string, time: string, email?: string): Promise<{ ok: boolean }> {
  return request(`/bookings/${encodeURIComponent(ref)}/reschedule`, { method: "POST", body: JSON.stringify({ date, time, email }) });
}

export interface CreateRegistrationInput {
  clubId: string;
  team: string;
  childFirst: string;
  childLast: string;
  dob: string;
  gFirst: string;
  gLast: string;
  email: string;
  phone: string;
  address: string;
  ecName: string;
  ecPhone: string;
  ecRel: string;
  medical?: string;
  consent: boolean;
  trial: boolean;
  couponCode?: string;
  sessionId?: string;
  passId?: number;
}

/** Free trial registrations are confirmed immediately (no `url` returned).
 * Paid registrations behave like createBookingCheckout — redirect to `url`. */
export function createRegistrationCheckout(
  input: CreateRegistrationInput
): Promise<{ ref: string; url?: string; totalEuro: number; trial: boolean }> {
  return request(`/registrations/checkout`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchRegistrationStatus(ref: string): Promise<{ ref: string; paymentStatus: string; totalCents: number }> {
  return request(`/registrations/status/${encodeURIComponent(ref)}`);
}

export function fetchMyRegistrations(): Promise<MyRegistration[]> {
  return request(`/registrations`);
}

/** Recovers a registration made on another device/browser — proven by ref +
 * the email used at signup, not the usual X-Client-Id. */
export function lookupRegistration(ref: string, email: string): Promise<MyRegistration> {
  return request(`/registrations/lookup`, { method: "POST", body: JSON.stringify({ ref, email }) });
}

/** `email` is only needed when cancelling a registration recovered via
 * lookupRegistration (no matching X-Client-Id on this device) — omit it for
 * a normal same-device cancel. */
export function cancelRegistration(ref: string, email?: string): Promise<{ ok: boolean }> {
  return request(`/registrations/${encodeURIComponent(ref)}/cancel`, {
    method: "POST",
    body: email ? JSON.stringify({ email }) : undefined,
  });
}

// --- pricing / coupons ---------------------------------------------------

export const VAT_RATE = 0.23;
export const PLATFORM_FEE_RATE = 0.05;

export function validateCoupon(code: string, subtotalCents: number): Promise<{ code: string; discountCents: number }> {
  return request(`/coupons/validate`, { method: "POST", body: JSON.stringify({ code, subtotalCents }) });
}

// --- search (FUTURE, best-effort) -------------------------------------------

export function search(q: string): Promise<SearchResult> {
  return request(`/search?q=${encodeURIComponent(q)}`);
}

// --- Ask HelloCircle (implementation plan Phase 12) -------------------------
// Rule-based, not an LLM (this app has no AI API key/SDK configured) — a
// conversational framing over the exact same structured search above, via
// the server's shared runStructuredSearch(). Never invents availability;
// every result is a real DB row.

export interface AskHelloCircleResponse {
  reply: string;
  parsed: SearchParsed | null;
  centres: Centre[];
  clubs: Club[];
  activities: DiscoverItem[];
  totalCentres: number;
  totalClubs: number;
  totalActivities: number;
}

export function askHelloCircle(message: string): Promise<AskHelloCircleResponse> {
  return request(`/ask`, { method: "POST", body: JSON.stringify({ message }) });
}

// --- homepage discovery feeds (Phase 5) ---------------------------------

export function fetchDiscover(county?: string): Promise<DiscoverFeed> {
  return request(`/discover${county ? `?county=${encodeURIComponent(county)}` : ""}`);
}

/** "Picking up near you" (Phase 7) — the resident-facing counterpart to
 * getDemandSignals(), which is vendor/admin-only. */
export function fetchLocalMomentum(county?: string): Promise<LocalMomentumSignal[]> {
  return request(`/discover/momentum${county ? `?county=${encodeURIComponent(county)}` : ""}`);
}

/** Free Time Mode (Phase 9) — duration → distance → mood → 3 options,
 * ranked by the exact same logic as fetchDiscover(); this is only a
 * narrower, filtered front door onto that same pool. */
export function fetchFreeTimeOptions(opts: { county?: string; maxMinutes?: number; mood?: string; lat?: number; lng?: number; radiusKm?: number }): Promise<DiscoverItem[]> {
  const params = new URLSearchParams();
  if (opts.county) params.set("county", opts.county);
  if (opts.maxMinutes !== undefined) params.set("maxMinutes", String(opts.maxMinutes));
  if (opts.mood) params.set("mood", opts.mood);
  if (opts.lat !== undefined) params.set("lat", String(opts.lat));
  if (opts.lng !== undefined) params.set("lng", String(opts.lng));
  if (opts.radiusKm !== undefined) params.set("radiusKm", String(opts.radiusKm));
  return request(`/discover/free-time?${params.toString()}`);
}

// --- reviews -------------------------------------------------------------

export function fetchReviews(listingType: "centre" | "club", listingId: string): Promise<Review[]> {
  return request(`/reviews?listingType=${listingType}&listingId=${encodeURIComponent(listingId)}`);
}

export function submitReview(input: {
  listingType: "centre" | "club";
  listingId: string;
  name: string;
  rating: number;
  comment?: string;
}): Promise<Review> {
  return request(`/reviews`, { method: "POST", body: JSON.stringify(input) });
}

export function hideReview(id: number): Promise<{ ok: boolean }> {
  return request(`/reviews/${id}`, { method: "DELETE" });
}

export function checkReviewEligibility(listingType: "centre" | "club", listingId: string): Promise<{ eligible: boolean }> {
  return request(`/reviews/eligible?listingType=${listingType}&listingId=${encodeURIComponent(listingId)}`);
}

// --- uploads -----------------------------------------------------------

export async function uploadImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/uploads`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Client-Id": getClientId() },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

// --- Programs / Sessions (guest-facing browsing + enrollment) -------------

export function fetchPrograms(listingType: "centre" | "club", listingId: string): Promise<Program[]> {
  return request(`/programs?listingType=${listingType}&listingId=${encodeURIComponent(listingId)}`);
}

export function fetchProgram(id: string): Promise<Program> {
  return request(`/programs/${id}`);
}

export function enrollInProgram(
  id: string,
  input: { participantName: string; participantDob?: string; email: string; phone?: string }
): Promise<{ ref: string; url?: string; totalEuro: number }> {
  return request(`/programs/${id}/enroll`, { method: "POST", body: JSON.stringify(input) });
}

/** Every program enrollment under this device's client_id or (if signed
 * in) this resident — same guest-or-resident ownership model as
 * fetchMyBookings/fetchMyRegistrations above. */
export function fetchMyProgramEnrollments(): Promise<MyProgramEnrollment[]> {
  return request(`/programs/enrollments/mine`);
}
