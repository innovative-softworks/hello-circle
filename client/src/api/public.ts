import { getClientId } from "../clientId";
import type { BookingConfirmation, Centre, Club, ExperienceKind, ProgramSummary, DiscoverFeed, DiscoverItem, ForYouSection, NewHereCircle, Experience, ExperienceBookingConfirmation, ExperienceSearchResult, IntentCount, LocalMomentumSignal, MapMarker, MapMarkerType, MyBooking, MyExperienceBooking, MyIntent, MyProgramEnrollment, MyRegistration, Program, ProgramEnrollmentConfirmation, ProviderProfile, RegistrationConfirmation, Review, SearchParsed, SearchResult } from "../types";
import { downloadIcs, request } from "./core";

// Guest-facing browsing + transactions — no account needed. Centres/clubs,
// availability, bookings/registrations, pricing/coupons, search, discovery
// feeds, reviews, uploads. Split out of the original single api.ts (see
// CLAUDE.md).

// Discovery-radius filtering (master-prompt punch list #2) — radiusKm is
// strictly opt-in (omit it and every call here behaves exactly as before
// this existed); the server resolves the actual lat/lng to filter from —
// the signed-in resident's home-county centroid, no client-side geocoding.
export function fetchCentres(county?: string, radiusKm?: number): Promise<Centre[]> {
  const params = new URLSearchParams();
  if (county && county !== "All") params.set("county", county);
  if (radiusKm) params.set("radiusKm", String(radiusKm));
  const qs = params.toString();
  return request(`/centres${qs ? `?${qs}` : ""}`);
}

export function fetchCentre(id: string): Promise<Centre> {
  return request(`/centres/${id}`);
}

export function fetchClubs(county?: string, sport?: string, radiusKm?: number): Promise<Club[]> {
  const params = new URLSearchParams();
  if (county && county !== "All") params.set("county", county);
  if (sport && sport !== "All") params.set("sport", sport);
  if (radiusKm) params.set("radiusKm", String(radiusKm));
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
  /** Open-booking setup (IA spec §6) — display-only, see server's comment. */
  confirmationDeadline?: string;
  /** Minimum Participation Booking (participation-intent plan Phase 5) —
   * only meaningful alongside openSpots. See server's comment. */
  minParticipants?: number;
}

/** Creates a pending booking + a Stripe Checkout session — the caller
 * should redirect the browser to `url`. The booking is only confirmed once
 * Stripe's webhook fires; nothing is finalized by this call alone. */
export function createBookingCheckout(input: CreateBookingInput): Promise<{ ref: string; url?: string; totalEuro: number }> {
  return request(`/bookings/checkout`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchBookingStatus(ref: string): Promise<BookingConfirmation> {
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
/** Phase 11B — resident/guest self-cancel (same server rules as the vendor
 * view; refundState reflects real server state, never assumed). */
export interface SelfCancelResult { ok: boolean; status: "cancelled"; refundState: "none" | "pending" | "refunded" }

export function cancelExperienceBooking(ref: string): Promise<SelfCancelResult> {
  return request(`/experiences/bookings/${encodeURIComponent(ref)}/cancel`, { method: "POST" });
}

export function cancelProgramEnrollment(ref: string): Promise<SelfCancelResult> {
  return request(`/programs/enrollments/${encodeURIComponent(ref)}/cancel`, { method: "POST" });
}

export function cancelBooking(ref: string, email?: string): Promise<{ ok: boolean }> {
  return request(`/bookings/${encodeURIComponent(ref)}/cancel`, {
    method: "POST",
    body: email ? JSON.stringify({ email }) : undefined,
  });
}

export function rescheduleBooking(ref: string, date: string, time: string, email?: string): Promise<{ ok: boolean }> {
  return request(`/bookings/${encodeURIComponent(ref)}/reschedule`, { method: "POST", body: JSON.stringify({ date, time, email }) });
}

export function downloadBookingIcs(ref: string): Promise<void> {
  return downloadIcs(`/bookings/${encodeURIComponent(ref)}/ics`, `booking-${ref}.ics`);
}

// --- Address search (Form System Audit, Phase 4) — proxies Nominatim
// server-side (see server/src/routes/geocode.ts for why). ------------------

export interface AddressSuggestion {
  label: string;
  lat: number;
  lng: number;
  area: string;
  county: string;
}

export function searchAddress(query: string): Promise<AddressSuggestion[]> {
  return request(`/geocode/search?q=${encodeURIComponent(query)}`);
}

// --- Participation Intent (demand capture) — works for guests via the
// X-Client-Id header request() already sends on every call, no separate
// auth needed. ---------------------------------------------------------

export function fetchIntentCount(activityLabel: string, county: string): Promise<IntentCount> {
  return request(`/intents/count?activityLabel=${encodeURIComponent(activityLabel)}&county=${encodeURIComponent(county)}`);
}

export function submitIntent(input: {
  activityLabel: string;
  county: string;
  preferredDate?: string;
  preferredTimeWindow?: string;
  notes?: string;
  name?: string;
  email?: string;
  /** Release 6 — optional request details. */
  preferredDays?: string[];
  budgetMaxEuro?: number;
  radiusKm?: number;
  sourceQuery?: string;
}): Promise<{ id: string; clusterKey?: string; label?: string }> {
  return request(`/intents`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchMyIntents(): Promise<MyIntent[]> {
  return request(`/intents/mine`);
}

export function cancelIntent(id: string): Promise<{ ok: boolean }> {
  return request(`/intents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Referral attribution (best-effort, read-side only) -----------------

export function logReferralShare(input: { source: string; listingType: string; listingId: string }): Promise<{ ok: boolean }> {
  return request(`/referrals/share`, { method: "POST", body: JSON.stringify(input) });
}

export function logReferralLand(ref: string, source?: string): Promise<{ ok: boolean }> {
  return request(`/referrals/land`, { method: "POST", body: JSON.stringify({ ref, source }) });
}

export interface CreateRegistrationInput {
  clubId: string;
  /** Defaults server-side to "child" when omitted. */
  registrantType?: "child" | "adult";
  team?: string;
  childFirst: string;
  childLast: string;
  dob?: string;
  gFirst: string;
  gLast: string;
  email: string;
  phone: string;
  address: string;
  ecName?: string;
  ecPhone?: string;
  ecRel?: string;
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

export function fetchRegistrationStatus(ref: string): Promise<RegistrationConfirmation> {
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

/** `listing` lets the server check a listing-/org-scoped code the same way
 * checkout will; checkout still re-validates regardless. */
export function validateCoupon(
  code: string,
  subtotalCents: number,
  listing?: { listingType: "centre" | "club" | "program" | "experience" | "game"; listingId: string }
): Promise<{ code: string; discountCents: number }> {
  return request(`/coupons/validate`, { method: "POST", body: JSON.stringify({ code, subtotalCents, ...listing }) });
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
  experiences: ExperienceSearchResult[];
  totalCentres: number;
  totalClubs: number;
  totalActivities: number;
  totalExperiences: number;
}

export function askHelloCircle(message: string): Promise<AskHelloCircleResponse> {
  return request(`/ask`, { method: "POST", body: JSON.stringify({ message }) });
}

// --- homepage discovery feeds (Phase 5) ---------------------------------

// Discovery-radius filtering (master-prompt punch list #2) — see
// fetchCentres()'s own comment.
export function fetchDiscover(county?: string, radiusKm?: number): Promise<DiscoverFeed> {
  const params = new URLSearchParams();
  if (county) params.set("county", county);
  if (radiusKm) params.set("radiusKm", String(radiusKm));
  const qs = params.toString();
  return request(`/discover${qs ? `?${qs}` : ""}`);
}

/** Bounds-scoped map discovery (Maps & Geographic Discovery, Phase E) — not
 * yet wired to a page (DiscoveryMap.tsx today still renders whatever
 * already-filtered array its caller passes in); this is the new
 * infrastructure a future "Search this area" pass wires up. */
export interface MapMarkerFilters {
  q?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
}

export function fetchMapMarkers(
  bounds: { north: number; south: number; east: number; west: number },
  types?: MapMarkerType[],
  filters?: MapMarkerFilters
): Promise<{ markers: MapMarker[] }> {
  const params = new URLSearchParams({
    north: String(bounds.north),
    south: String(bounds.south),
    east: String(bounds.east),
    west: String(bounds.west),
  });
  if (types && types.length) params.set("types", types.join(","));
  if (filters?.q) params.set("q", filters.q);
  if (filters?.minPriceCents !== undefined) params.set("minPriceCents", String(filters.minPriceCents));
  if (filters?.maxPriceCents !== undefined) params.set("maxPriceCents", String(filters.maxPriceCents));
  return request(`/discover/map?${params.toString()}`);
}

/** "Picking up near you" (Phase 7) — the resident-facing counterpart to
 * getDemandSignals(), which is vendor/admin-only. */
export function fetchLocalMomentum(county?: string): Promise<LocalMomentumSignal[]> {
  return request(`/discover/momentum${county ? `?county=${encodeURIComponent(county)}` : ""}`);
}

export interface LocalActivityFeed {
  county: string;
  activityQuery: string;
  count: number;
  items: DiscoverItem[];
}

export function fetchLocalActivity(county: string, activity: string): Promise<LocalActivityFeed> {
  return request(`/discover/local/${encodeURIComponent(county)}/${encodeURIComponent(activity)}`);
}

export function fetchMarketCategories(county: string): Promise<Record<string, boolean>> {
  return request(`/discover/market-categories?county=${encodeURIComponent(county)}`);
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

/** "Next Best Participation" (implementation backlog #4) — one ranked list
 * blending the same scoring fetchDiscover() uses with two extra signals
 * neither it nor Free Time Mode reads: active Routines and Circle
 * membership. No mood/duration input required — proactive, not picked. */
export function fetchNextBestParticipation(): Promise<DiscoverItem[]> {
  return request(`/discover/next-best`);
}

/** Release 4 — personalised sections (empty for a signed-out visitor). */
export function fetchForYou(): Promise<{ sections: ForYouSection[] }> {
  return request(`/discover/for-you`);
}

/** Release 5 — "New here?" starter sections (empty unless signed in). */
export function fetchNewHere(): Promise<{ sections: ForYouSection[]; circles: NewHereCircle[] }> {
  return request(`/discover/new-here`);
}

// --- reviews -------------------------------------------------------------

// Host & Activity reviews (master-prompt punch list #3) — same reviews
// system, 2 more listing types. "game" needs having actually attended a
// past game; "host" needs having played in one of that resident's past
// games (see reviews.ts's isEligibleToReview()).
export type ReviewListingType = "centre" | "club" | "game" | "host" | "experience" | "program";

export function fetchReviews(listingType: ReviewListingType, listingId: string): Promise<Review[]> {
  return request(`/reviews?listingType=${listingType}&listingId=${encodeURIComponent(listingId)}`);
}

export function submitReview(input: {
  listingType: ReviewListingType;
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

export function checkReviewEligibility(listingType: ReviewListingType, listingId: string): Promise<{ eligible: boolean }> {
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

/** The /programs browse page — every published program with an upcoming session. */
export function fetchProgramBrowse(county?: string, category?: string): Promise<ProgramSummary[]> {
  const params = new URLSearchParams();
  if (county && county !== "All") params.set("county", county);
  if (category && category !== "All") params.set("category", category);
  const qs = params.toString();
  return request(`/programs${qs ? `?${qs}` : ""}`);
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

/** Polled by PaymentSuccess.tsx after a program enrollment's Stripe redirect —
 * mirrors fetchBookingStatus/fetchRegistrationStatus. */
export function fetchProgramEnrollmentStatus(ref: string): Promise<ProgramEnrollmentConfirmation> {
  return request(`/programs/enrollments/status/${encodeURIComponent(ref)}`);
}

// --- Adventures & Experiences (guest-facing browsing + booking) -----------

export function fetchExperiences(kind?: ExperienceKind, county?: string): Promise<Experience[]> {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (county && county !== "All") params.set("county", county);
  const qs = params.toString();
  return request(`/experiences${qs ? `?${qs}` : ""}`);
}

export function fetchExperience(id: string): Promise<Experience> {
  return request(`/experiences/${id}`);
}

export function bookExperienceSession(
  experienceId: string,
  sessionId: string,
  input: { participantName: string; email: string; phone?: string; partySize?: number; couponCode?: string; quoteId?: string; useCredits?: boolean }
): Promise<{ ref: string; url?: string; totalEuro: number }> {
  return request(`/experiences/${experienceId}/sessions/${sessionId}/checkout`, { method: "POST", body: JSON.stringify(input) });
}

/** Authoritative server price for a prospective experience booking (HC-QA-042) —
 * the same calculation checkout stores/charges; nothing is reserved. */
export interface BookingQuote {
  partySize: number;
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  vatCents: number;
  platformFeeCents: number;
  totalCents: number;
  couponCode: string | null;
  currency: "EUR";
  /** Commerce Engine Phase 2 — true when the published pricing rule shows one
   * VAT-inclusive price (VAT is inside totalCents, not added on top). */
  vatIncluded?: boolean;
  /** Present when the commerce engine priced this quote; sent back at
   * checkout so a price change in between is detected, not charged. */
  quoteId?: string;
  quoteExpiresAt?: string;
  /** Stage 5b — HelloCircle credit applied (engine-priced quotes only). */
  creditCents?: number;
}
export function quoteExperienceSession(experienceId: string, sessionId: string, input: { partySize: number; couponCode?: string; useCredits?: boolean }): Promise<BookingQuote> {
  return request(`/experiences/${experienceId}/sessions/${sessionId}/quote`, { method: "POST", body: JSON.stringify(input) });
}

/** HC-QA-047 — authoritative totals for a programme enrolment / paid activity join. */
export interface PriceQuote { subtotalCents: number; discountCents: number; vatCents: number; platformFeeCents: number; totalCents: number; couponCode: string | null; currency: "EUR" }
export function quoteProgram(programId: string): Promise<PriceQuote> {
  return request(`/programs/${encodeURIComponent(programId)}/quote`);
}
export function quoteGame(gameId: string, couponCode?: string | null): Promise<PriceQuote> {
  return request(`/games/${encodeURIComponent(gameId)}/quote${couponCode ? `?couponCode=${encodeURIComponent(couponCode)}` : ""}`);
}

/** Same guest-or-resident ownership model as fetchMyProgramEnrollments. */
export function fetchMyExperienceBookings(): Promise<MyExperienceBooking[]> {
  return request(`/experiences/bookings/mine`);
}

export function fetchExperienceBookingStatus(ref: string): Promise<ExperienceBookingConfirmation> {
  return request(`/experiences/bookings/status/${encodeURIComponent(ref)}`);
}

export function downloadExperienceBookingIcs(ref: string): Promise<void> {
  return downloadIcs(`/experiences/bookings/${encodeURIComponent(ref)}/ics`, `experience-booking-${ref}.ics`);
}

// --- Provider public profile (IA spec §5) ----------------------------------

export function fetchProviderProfile(vendorId: string): Promise<ProviderProfile> {
  return request(`/providers/${vendorId}`);
}

// --- Pre-launch "coming soon" email capture (pages/ComingSoon.tsx) --------

export function joinLaunchWaitlist(input: { email: string; name?: string; county?: string }): Promise<{ ok: true }> {
  return request(`/launch-signups`, { method: "POST", body: JSON.stringify(input) });
}

// --- Revenue & Connect Stage 3: public pricing + field help ----------------
// Server-authoritative (server/src/routes/pricingPublic.ts, routes/help.ts):
// the client only displays what the published rules produce.

export interface PlanTerms { successFeeBps: number; minFeeMinor: number; subscriptionMonthlyMinor: number }
export interface PublicPlans { currency: "EUR"; vatBps: number; feesExclusiveOfVat: boolean; free: PlanTerms; pro: PlanTerms; proBreakEvenMonthlyGmvMinor: number | null }

export interface EstimateInput {
  priceMinor: number;
  quantity?: number;
  planKey?: "free" | "pro";
  discounts?: { funder: "vendor" | "host" | "venue" | "helloCircle" | "shared"; amountMinor: number; platformShareBps?: number }[];
  split?: { mode: "single"; recipient: "vendor" | "host" | "venue" } | { mode: "fixed_venue"; venueMinor: number } | { mode: "fixed_host"; hostMinor: number } | { mode: "percentage"; venueBps: number };
}

export interface PriceEstimate {
  planKey: string;
  ok: boolean;
  blockedReason: string | null;
  serviceSubtotalMinor: number;
  partnerFundedDiscountMinor: number;
  helloCircleFundedDiscountMinor: number;
  feeBaseMinor: number;
  percentageFeeMinor: number;
  minimumFeeApplied: boolean;
  platformFeeNetMinor: number;
  platformFeeVatMinor: number;
  partnerPoolMinor: number;
  allocations: { recipient: "vendor" | "host" | "venue"; amountMinor: number; payoutEstimateMinor: number }[];
  customerChargeMinor: number;
  cardEstimateMinor: number;
  payoutEstimateMinor: number;
  contributionBeforeReservesMinor: number;
  contributionMinor: number;
  /** Admin simulator only — never returned by the public estimator. */
  marginWarning?: boolean;
}

export interface PlanComparison {
  monthlyGmvMinor: number;
  orders: number;
  free: { feesMinor: number; feeVatMinor: number; subscriptionMinor: number; subscriptionVatMinor: number; totalMinor: number };
  pro: { feesMinor: number; feeVatMinor: number; subscriptionMinor: number; subscriptionVatMinor: number; totalMinor: number };
  proMonthlySavingMinor: number;
  proBreakEvenMonthlyGmvMinor: number | null;
  cheaperPlan: "free" | "pro";
}

export interface FieldHelpEntry {
  helpKey: string;
  version: number;
  name: string;
  definition: string;
  formula: string;
  example: string;
  whoPays: string;
  whenCharged: string;
  refundBehaviour: string;
  policyKey: string;
}

export function fetchPricingPlans(): Promise<PublicPlans> {
  return request(`/pricing/plans`);
}

export function estimatePrice(input: EstimateInput): Promise<PriceEstimate> {
  return request(`/pricing/estimate`, { method: "POST", body: JSON.stringify(input) });
}

export function comparePlans(monthlyGmvMinor: number, orders: number): Promise<PlanComparison> {
  return request(`/pricing/compare`, { method: "POST", body: JSON.stringify({ monthlyGmvMinor, orders }) });
}

export function fetchFieldHelp(keys?: string[]): Promise<FieldHelpEntry[]> {
  return request(`/help/fields${keys?.length ? `?keys=${encodeURIComponent(keys.join(","))}` : ""}`);
}

// --- Revenue & Connect Stage 4: Policy Centre, complaints, trader info -----

export interface PolicySummary { docKey: string; title: string; audience: string; publishedVersion: number | null; publishedAt: string | null }
export interface PublishedPolicy {
  version: number;
  status: "published" | "retired";
  body: string;
  contentHash: string;
  changeSummary: string | null;
  effectiveFrom: string | null;
  publishedAt: string;
  retiredAt: string | null;
  history: { version: number; status: string; changeSummary: string | null; publishedAt: string; retiredAt: string | null }[];
}
export interface PolicyDocument { docKey: string; title: string; audience: string; published: PublishedPolicy | null }
export interface PendingPolicy { docKey: string; title: string; kind: "accept" | "acknowledge"; version: number; effectiveFrom: string | null; changeSummary: string | null }

export function fetchPolicies(): Promise<PolicySummary[]> {
  return request(`/policies`);
}
export function fetchPolicy(docKey: string, version?: number): Promise<PolicyDocument> {
  return request(`/policies/${encodeURIComponent(docKey)}${version ? `?version=${version}` : ""}`);
}
export function fetchPendingPolicies(): Promise<{ user: PendingPolicy[]; resident: PendingPolicy[] }> {
  return request(`/policies/acceptance/pending`);
}
export function acceptPolicy(docKey: string, version: number, as: "user" | "resident"): Promise<{ docKey: string; version: number }> {
  return request(`/policies/${encodeURIComponent(docKey)}/accept`, { method: "POST", body: JSON.stringify({ version, as, context: "gate" }) });
}

export type ComplaintKind = "complaint" | "notice" | "appeal";
export interface ComplaintRow { id: number; kind: ComplaintKind; subjectType: string; subjectRef: string | null; body: string; status: string; decision: string | null; statementOfReasons: string | null; decidedAt: string | null; createdAt: string }
export function submitComplaint(input: { kind: ComplaintKind; subjectType: string; subjectRef?: string; email?: string; body: string }): Promise<{ id: number; status: string }> {
  return request(`/complaints`, { method: "POST", body: JSON.stringify(input) });
}
export function fetchMyComplaints(): Promise<ComplaintRow[]> {
  return request(`/complaints/mine`);
}

export interface PublicTrader { legalName: string; tradingName: string | null; address: string; country: string; email: string; phone: string; companyNumber: string | null; vatNumber: string | null; selfCertifiedAt: string; verificationStatus: string }
export function fetchListingTrader(type: "centre" | "club" | "experience" | "game", id: string): Promise<PublicTrader | null> {
  return request(`/traders/listing/${type}/${encodeURIComponent(id)}`);
}

export interface TraderProfile {
  entityType: "individual" | "company";
  legalName: string;
  tradingName: string | null;
  address: string;
  country: string;
  email: string;
  phone: string;
  companyNumber: string | null;
  vatNumber: string | null;
  tin: string | null;
  hasTin?: boolean;
  dateOfBirth: string | null;
  insuranceExpiresAt: string | null;
  selfCertifiedAt: string | null;
  verificationStatus: string;
  verificationNote: string | null;
}
export type TraderProfileInput = Omit<TraderProfile, "selfCertifiedAt" | "verificationStatus" | "verificationNote" | "hasTin"> & { selfCertify: boolean };
/** scope "vendor" = the signed-in vendor's organisation; "host" = the signed-in resident as a host. */
export function fetchTraderProfile(scope: "vendor" | "host"): Promise<TraderProfile | null> {
  return request(`/${scope}/trader-profile`);
}
export function saveTraderProfile(scope: "vendor" | "host", input: TraderProfileInput): Promise<TraderProfile> {
  return request(`/${scope}/trader-profile`, { method: "PUT", body: JSON.stringify(input) });
}

// --- Revenue & Connect Stage 5c: separate consents ------------------------------

export function recordCookieConsent(input: { analytics: boolean; advertising: boolean; policyVersion?: number }): Promise<{ ok: boolean }> {
  return request(`/consents/cookies`, { method: "POST", body: JSON.stringify(input) });
}
export function acknowledgePolicy(docKey: string, version: number, as: "user" | "resident"): Promise<{ docKey: string; version: number }> {
  return request(`/policies/${encodeURIComponent(docKey)}/acknowledge`, { method: "POST", body: JSON.stringify({ version, as }) });
}
