import { getClientId } from "./clientId";
import type {
  AdminOrganisation,
  AdminStats,
  AuditEntry,
  AuthUser,
  Centre,
  CentreHoursRow,
  Circle,
  Club,
  ClubSession,
  DemandRow,
  Favourite,
  FeatureFlag,
  Game,
  HouseholdMember,
  ModerationReport,
  MyBooking,
  MyRegistration,
  OrgProfile,
  Participant,
  Pass,
  PlatformDashboardStats,
  Program,
  Receipt,
  Resident,
  ResidentFull,
  ResidentNotification,
  Review,
  Role,
  RoomBlock,
  ScheduleEntry,
  SearchResult,
  TenantSummary,
  VendorInsights,
  VendorListingSummary,
  VendorNotification,
  VendorPayments,
  VendorProgramSummary,
  VendorStats,
  WaitlistEntry,
  WaitlistOfferStatus,
  WaitlistPosition,
} from "./types";

/** Thrown instead of a plain Error so callers that need more than the
 * message (e.g. registrations.ts's `{ error, full: true }` on a capacity
 * conflict) can inspect the parsed response body without a second fetch. */
export class ApiError extends Error {
  body: Record<string, unknown>;
  constructor(message: string, body: Record<string, unknown>) {
    super(message);
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": getClientId(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || `Request failed: ${res.status}`, body);
  }
  return res.json() as Promise<T>;
}

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

export function fetchAvailability(roomId: string, date: string, duration = 1): Promise<{ slots: string[]; bookedTimes: string[]; closed: boolean }> {
  return request(`/availability?roomId=${encodeURIComponent(roomId)}&date=${encodeURIComponent(date)}&duration=${duration}`);
}

export function fetchAvailabilityRange(roomId: string, from: string, days = 60): Promise<{ closedDates: string[] }> {
  return request(`/availability/range?roomId=${encodeURIComponent(roomId)}&from=${encodeURIComponent(from)}&days=${days}`);
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

// --- auth --------------------------------------------------------------

export function signup(input: {
  email: string;
  password: string;
  name: string;
  vendorType: "community" | "sports";
  businessName: string;
  address: string;
  county: string;
  mobile: string;
  landline?: string;
  description: string;
}): Promise<{ user: AuthUser }> {
  return request(`/auth/signup`, { method: "POST", body: JSON.stringify(input) });
}

export function login(input: { email: string; password: string }): Promise<{ user: AuthUser }> {
  return request(`/auth/login`, { method: "POST", body: JSON.stringify(input) });
}

export function logout(): Promise<{ ok: boolean }> {
  return request(`/auth/logout`, { method: "POST" });
}

export function fetchMe(): Promise<{ user: AuthUser | null }> {
  return request(`/auth/me`);
}

// --- guest magic-link session ---------------------------------------------

/** Always resolves the same way regardless of whether that email has any
 * bookings — see server/src/routes/guestAuth.ts. */
export function requestGuestLink(email: string): Promise<{ ok: boolean }> {
  return request(`/guest/request-link`, { method: "POST", body: JSON.stringify({ email }) });
}

export function verifyGuestLink(token: string): Promise<{ email: string }> {
  return request(`/guest/verify`, { method: "POST", body: JSON.stringify({ token }) });
}

export function guestLogout(): Promise<{ ok: boolean }> {
  return request(`/guest/logout`, { method: "POST" });
}

export function fetchGuestSession(): Promise<{ email: string | null }> {
  return request(`/guest/me`);
}

// --- resident identity (MVP) -----------------------------------------------

export function fetchResidentMe(): Promise<{ resident: Resident | null }> {
  return request(`/residents/me`);
}

export function updateResidentMe(input: { name?: string; homeCounty?: string }): Promise<{ ok: boolean }> {
  return request(`/residents/me`, { method: "PUT", body: JSON.stringify(input) });
}

export function fetchResidentNotifications(): Promise<ResidentNotification[]> {
  return request(`/residents/me/notifications`);
}

export function markResidentNotificationRead(id: number): Promise<{ ok: boolean }> {
  return request(`/residents/me/notifications/${id}/read`, { method: "POST" });
}

// --- household (MVP) ---------------------------------------------------

export function fetchHousehold(): Promise<HouseholdMember[]> {
  return request(`/household`);
}

export function addHouseholdMember(input: { firstName: string; lastName: string; dob?: string; notes?: string }): Promise<{ id: number }> {
  return request(`/household`, { method: "POST", body: JSON.stringify(input) });
}

export function updateHouseholdMember(id: number, input: Partial<{ firstName: string; lastName: string; dob: string; notes: string }>): Promise<{ ok: boolean }> {
  return request(`/household/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteHouseholdMember(id: number): Promise<{ ok: boolean }> {
  return request(`/household/${id}`, { method: "DELETE" });
}

// --- favourites (MVP) ---------------------------------------------------

export function fetchFavourites(): Promise<Favourite[]> {
  return request(`/favourites`);
}

export function addFavourite(listingType: "centre" | "club", listingId: string): Promise<{ ok: boolean }> {
  return request(`/favourites`, { method: "POST", body: JSON.stringify({ listingType, listingId }) });
}

export function removeFavourite(listingType: "centre" | "club", listingId: string): Promise<{ ok: boolean }> {
  return request(`/favourites`, { method: "DELETE", body: JSON.stringify({ listingType, listingId }) });
}

// --- club waitlist (MVP) -------------------------------------------------

export function fetchWaitlistPosition(clubId: string): Promise<WaitlistPosition> {
  return request(`/clubs/${clubId}/waitlist/position`);
}

export function joinClubWaitlist(clubId: string, input: { name?: string; email?: string }): Promise<{ ok: boolean }> {
  return request(`/clubs/${clubId}/waitlist`, { method: "POST", body: JSON.stringify(input) });
}

export function leaveClubWaitlist(clubId: string): Promise<{ ok: boolean }> {
  return request(`/clubs/${clubId}/waitlist`, { method: "DELETE" });
}

// --- Join a Game (MVP) / paid games (NEXT) ----------------------------------

export function fetchGames(county?: string): Promise<Game[]> {
  return request(`/games${county ? `?county=${encodeURIComponent(county)}` : ""}`);
}

export function fetchGame(id: string): Promise<Game> {
  return request(`/games/${id}`);
}

export interface CreateGameInput {
  activityLabel: string;
  centreId?: string;
  locationText?: string;
  date: string;
  time: string;
  skillLevel?: string;
  capacity: number;
  priceCents?: number;
  visibility?: "public" | "circle" | "invite";
}

export function createGame(input: CreateGameInput): Promise<Game> {
  return request(`/games`, { method: "POST", body: JSON.stringify(input) });
}

/** Free/cash games resolve `{ ok: true }` immediately; a priced game
 * (NEXT) instead returns a Stripe `url` to redirect to. */
export function joinGame(id: string): Promise<{ ok?: boolean; ref?: string; url?: string; totalEuro?: number }> {
  return request(`/games/${id}/join`, { method: "POST" });
}

export function leaveGame(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/join`, { method: "DELETE" });
}

export function cancelGame(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/cancel`, { method: "POST" });
}

export function joinGameWaitlist(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/waitlist`, { method: "POST" });
}

export function leaveGameWaitlist(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/waitlist`, { method: "DELETE" });
}

// --- Circles (NEXT) ----------------------------------------------------

export function fetchCircles(county?: string): Promise<Circle[]> {
  return request(`/circles${county ? `?county=${encodeURIComponent(county)}` : ""}`);
}

export function fetchCircle(id: string): Promise<Circle> {
  return request(`/circles/${id}`);
}

export function fetchCircleUpcoming(id: string): Promise<{ id: string; activityLabel: string; date: string; time: string }[]> {
  return request(`/circles/${id}/upcoming`);
}

export function createCircle(input: { name: string; activityLabel?: string; area?: string; county?: string; about?: string; centreId?: string }): Promise<{ id: string }> {
  return request(`/circles`, { method: "POST", body: JSON.stringify(input) });
}

export function joinCircle(id: string): Promise<{ ok: boolean }> {
  return request(`/circles/${id}/join`, { method: "POST" });
}

export function leaveCircle(id: string): Promise<{ ok: boolean }> {
  return request(`/circles/${id}/join`, { method: "DELETE" });
}

export function fetchCircleMembership(id: string): Promise<{ member: boolean; role: string | null }> {
  return request(`/circles/${id}/membership`);
}

// --- recurring club sessions (NEXT) -----------------------------------------

export function fetchClubSessions(clubId: string): Promise<ClubSession[]> {
  return request(`/club-sessions?clubId=${encodeURIComponent(clubId)}`);
}

export function createClubSession(input: { clubId: string; dayOfWeek: number; time: string; capacity?: number; label?: string }): Promise<{ id: string }> {
  return request(`/club-sessions`, { method: "POST", body: JSON.stringify(input) });
}

export function deleteClubSession(id: string): Promise<{ ok: boolean }> {
  return request(`/club-sessions/${id}`, { method: "DELETE" });
}

// --- passes (NEXT) -----------------------------------------------------

export function fetchMyPasses(): Promise<Pass[]> {
  return request(`/passes/me`);
}

export function createPassCheckout(input: { listingId: string; creditsTotal: number }): Promise<{ ref: string; url?: string; totalEuro: number }> {
  return request(`/passes/checkout`, { method: "POST", body: JSON.stringify({ listingType: "club", ...input }) });
}

// --- search (FUTURE, best-effort) -------------------------------------------

export function search(q: string): Promise<SearchResult> {
  return request(`/search?q=${encodeURIComponent(q)}`);
}

export function fetchVendorClubWaitlist(clubId: string): Promise<WaitlistEntry[]> {
  return request(`/vendor/clubs/${clubId}/waitlist`);
}

// --- vendor: messages / demand / check-in (NEXT / FUTURE) ------------------

export function sendVendorMessage(input: { listingType: "centre" | "club"; listingId: string; subject: string; body: string }): Promise<{ ok: boolean; recipientCount: number }> {
  return request(`/vendor/messages`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchVendorMessages(): Promise<{ id: number; listingType: string; listingId: string; subject: string; body: string; createdAt: string }[]> {
  return request(`/vendor/messages`);
}

export function fetchVendorDemand(): Promise<DemandRow[]> {
  return request(`/vendor/demand`);
}

export function checkInBooking(kind: "booking" | "registration", ref: string): Promise<{ ok: boolean }> {
  return request(`/vendor/checkin/${kind}/${encodeURIComponent(ref)}`, { method: "POST" });
}

export function fetchCheckInStatus(kind: "booking" | "registration", ref: string): Promise<{ checkedIn: boolean; checkedInAt: string | null }> {
  return request(`/vendor/checkin/${kind}/${encodeURIComponent(ref)}`);
}

// --- admin: organisations / RBAC / provider tier / demand (FUTURE) ---------

export function fetchAdminOrganisations(): Promise<AdminOrganisation[]> {
  return request(`/admin/organisations`);
}

export function createAdminOrganisation(input: { name: string; kind?: string }): Promise<{ id: string }> {
  return request(`/admin/organisations`, { method: "POST", body: JSON.stringify(input) });
}

export function setCentreOrganisation(id: string, organisationId: string | null): Promise<{ ok: boolean }> {
  return request(`/admin/centres/${id}/organisation`, { method: "PUT", body: JSON.stringify({ organisationId }) });
}

export function setClubOrganisation(id: string, organisationId: string | null): Promise<{ ok: boolean }> {
  return request(`/admin/clubs/${id}/organisation`, { method: "PUT", body: JSON.stringify({ organisationId }) });
}

export function setVendorPlatformRole(id: string, platformRole: string | null): Promise<{ ok: boolean }> {
  return request(`/admin/vendors/${id}/platform-role`, { method: "PUT", body: JSON.stringify({ platformRole }) });
}

export function setVendorProviderTier(id: string, providerTier: "standard" | "verified" | "featured"): Promise<{ ok: boolean }> {
  return request(`/admin/vendors/${id}/provider-tier`, { method: "PUT", body: JSON.stringify({ providerTier }) });
}

export function fetchAdminDemand(): Promise<DemandRow[]> {
  return request(`/admin/demand`);
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

// --- vendor dashboard ----------------------------------------------------

export interface CentreInput {
  name: string;
  area: string;
  county: string;
  capacity: number;
  from: number;
  managedBy: string;
  image?: string;
  images?: string[];
  blurb: string;
  amenities?: string[];
  opensAt?: string;
  closesAt?: string;
  paymentMethod?: "online" | "cash";
  isOpen?: boolean;
  mapUrl?: string;
}

export interface ClubInput {
  name: string;
  sport: string;
  area: string;
  county: string;
  ages: string;
  price: number;
  unit: string;
  trial?: boolean;
  image?: string;
  images?: string[];
  blurb: string;
  includes?: string[];
  paymentMethod?: "online" | "cash";
  mapUrl?: string;
  /** Nullable = unlimited (MVP — see clubs.capacity / waitlist). */
  capacity?: number | null;
}

export function fetchVendorListings(): Promise<{ centres: VendorListingSummary[]; clubs: VendorListingSummary[] }> {
  return request(`/vendor/listings`);
}

export function fetchVendorStats(): Promise<VendorStats> {
  return request(`/vendor/stats`);
}

/** Requests ownership of a listing that has no vendor yet (vendor_id IS
 * NULL) — an admin approves/rejects it, see setClaimStatus. */
export function submitClaim(listingType: "centre" | "club", listingId: string, message?: string): Promise<{ ok: boolean }> {
  return request(`/vendor/claims`, { method: "POST", body: JSON.stringify({ listingType, listingId, message }) });
}

export function fetchVendorCentre(id: string): Promise<Centre> {
  return request(`/vendor/centres/${id}`);
}

export function fetchVendorClub(id: string): Promise<Club> {
  return request(`/vendor/clubs/${id}`);
}

export function createVendorCentre(input: CentreInput): Promise<Centre> {
  return request(`/vendor/centres`, { method: "POST", body: JSON.stringify(input) });
}

export function updateVendorCentre(id: string, input: Partial<CentreInput>): Promise<Centre> {
  return request(`/vendor/centres/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteVendorCentre(id: string): Promise<{ ok: boolean }> {
  return request(`/vendor/centres/${id}`, { method: "DELETE" });
}

export interface BlockInput {
  date: string;
  reason?: string;
}

export function fetchVendorBlocks(centreId: string): Promise<RoomBlock[]> {
  return request(`/vendor/centres/${centreId}/blocks`);
}

export function createVendorBlock(centreId: string, input: BlockInput): Promise<{ id: number }> {
  return request(`/vendor/centres/${centreId}/blocks`, { method: "POST", body: JSON.stringify(input) });
}

export function deleteVendorBlock(centreId: string, blockId: number): Promise<{ ok: boolean }> {
  return request(`/vendor/centres/${centreId}/blocks/${blockId}`, { method: "DELETE" });
}

export function createVendorClub(input: ClubInput): Promise<Club> {
  return request(`/vendor/clubs`, { method: "POST", body: JSON.stringify(input) });
}

export function updateVendorClub(id: string, input: Partial<ClubInput>): Promise<Club> {
  return request(`/vendor/clubs/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteVendorClub(id: string): Promise<{ ok: boolean }> {
  return request(`/vendor/clubs/${id}`, { method: "DELETE" });
}

export function fetchVendorBookings(): Promise<(MyBooking & { name: string; email: string; phone: string })[]> {
  return request(`/vendor/bookings`);
}

export function fetchVendorRegistrations(): Promise<(MyRegistration & { email: string; phone: string })[]> {
  return request(`/vendor/registrations`);
}

export function fetchVendorNotifications(): Promise<VendorNotification[]> {
  return request(`/vendor/notifications`);
}

export function markVendorNotificationRead(id: number): Promise<{ ok: boolean }> {
  return request(`/vendor/notifications/${id}/read`, { method: "POST" });
}

// --- admin dashboard -------------------------------------------------------

export interface AdminVendor {
  id: string;
  email: string;
  name: string;
  status: "pending" | "approved" | "suspended";
  createdAt: string;
  centreCount: number;
  clubCount: number;
  vendorType: "community" | "sports" | null;
  businessName: string;
  address: string;
  county: string;
  mobile: string;
  landline: string;
  description: string;
}

export interface AdminListingSummary {
  id: string;
  name: string;
  status: string;
  area: string;
  county: string;
  ph: string;
  image: string;
  blurb: string;
  vendorEmail: string | null;
  vendorName?: string | null;
  vendorStatus?: "pending" | "approved" | "suspended" | null;
  // centre-only
  capacity?: number;
  from?: number;
  managedBy?: string;
  // club-only
  sport?: string;
  ages?: string;
  price?: number;
  unit?: string;
}

export function fetchAdminVendors(): Promise<AdminVendor[]> {
  return request(`/admin/vendors`);
}

export function fetchAdminStats(): Promise<AdminStats> {
  return request(`/admin/stats`);
}

export function setVendorStatus(id: string, status: "pending" | "approved" | "suspended"): Promise<{ ok: boolean }> {
  return request(`/admin/vendors/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function fetchAdminPendingListings(): Promise<{ centres: AdminListingSummary[]; clubs: AdminListingSummary[] }> {
  return request(`/admin/listings/pending`);
}

export function fetchAdminListings(): Promise<{ centres: AdminListingSummary[]; clubs: AdminListingSummary[] }> {
  return request(`/admin/listings`);
}

export interface ClaimSummary {
  id: number;
  listingType: "centre" | "club";
  listingId: string;
  listingName: string;
  message: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  vendorId: string;
  vendorName: string;
  vendorEmail: string;
  vendorStatus: "pending" | "approved" | "suspended";
}

export function fetchClaims(): Promise<ClaimSummary[]> {
  return request(`/admin/claims`);
}

export function setClaimStatus(id: number, status: "approved" | "rejected"): Promise<{ ok: boolean }> {
  return request(`/admin/claims/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function setCentreStatus(id: string, status: string): Promise<Centre> {
  return request(`/admin/centres/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function setClubStatus(id: string, status: string): Promise<Club> {
  return request(`/admin/clubs/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function adminUpdateCentre(id: string, input: Partial<CentreInput>): Promise<Centre> {
  return request(`/admin/centres/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function adminDeleteCentre(id: string): Promise<{ ok: boolean }> {
  return request(`/admin/centres/${id}`, { method: "DELETE" });
}

export function adminUpdateClub(id: string, input: Partial<ClubInput>): Promise<Club> {
  return request(`/admin/clubs/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function adminDeleteClub(id: string): Promise<{ ok: boolean }> {
  return request(`/admin/clubs/${id}`, { method: "DELETE" });
}

export function fetchAdminReviews(): Promise<(Review & { hidden: number })[]> {
  return request(`/admin/reviews`);
}

export function unhideReview(id: number): Promise<{ ok: boolean }> {
  return request(`/admin/reviews/${id}/unhide`, { method: "PUT" });
}

// --- admin coupons -----------------------------------------------------

export interface AdminCoupon {
  id: number;
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  active: number;
  createdAt: string;
}

export interface CouponInput {
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses?: number | null;
  expiresAt?: string | null;
}

export function fetchAdminCoupons(): Promise<AdminCoupon[]> {
  return request(`/admin/coupons`);
}

export function createAdminCoupon(input: CouponInput): Promise<{ ok: boolean }> {
  return request(`/admin/coupons`, { method: "POST", body: JSON.stringify(input) });
}

export function setAdminCouponActive(id: number, active: boolean): Promise<{ ok: boolean }> {
  return request(`/admin/coupons/${id}/active`, { method: "PUT", body: JSON.stringify({ active }) });
}

export function deleteAdminCoupon(id: number): Promise<{ ok: boolean }> {
  return request(`/admin/coupons/${id}`, { method: "DELETE" });
}

// --- Phase A: onboarding, preferences, receipts, feedback -----------------

export function fetchResidentFull(): Promise<{ resident: ResidentFull | null }> {
  return request(`/residents/me`);
}

export function saveOnboarding(input: { homeCounty?: string; searchRadiusKm?: number; interests?: string[]; availability?: string[] }): Promise<{ ok: boolean }> {
  return request(`/residents/me/onboarding`, { method: "PUT", body: JSON.stringify(input) });
}

export function skipOnboarding(): Promise<{ ok: boolean }> {
  return request(`/residents/me/onboarding/skip`, { method: "POST" });
}

export function saveNotificationPrefs(prefs: Record<string, boolean>): Promise<{ ok: boolean }> {
  return request(`/residents/me/notification-prefs`, { method: "PUT", body: JSON.stringify(prefs) });
}

export function saveAccessibilityPrefs(prefs: string[]): Promise<{ ok: boolean }> {
  return request(`/residents/me/accessibility-prefs`, { method: "PUT", body: JSON.stringify({ prefs }) });
}

export function fetchReceipts(): Promise<Receipt[]> {
  return request(`/residents/me/receipts`);
}

export function requestPasswordReset(email: string): Promise<{ ok: boolean }> {
  return request(`/auth/request-reset`, { method: "POST", body: JSON.stringify({ email }) });
}

export function resetPassword(token: string, password: string): Promise<{ ok: boolean }> {
  return request(`/auth/reset-password`, { method: "POST", body: JSON.stringify({ token, password }) });
}

export function rescheduleBooking(ref: string, date: string, time: string, email?: string): Promise<{ ok: boolean }> {
  return request(`/bookings/${encodeURIComponent(ref)}/reschedule`, { method: "POST", body: JSON.stringify({ date, time, email }) });
}

export function fetchWaitlistOfferStatus(clubId: string): Promise<WaitlistOfferStatus> {
  return request(`/clubs/${clubId}/waitlist/position`);
}

export function submitFeedback(kind: string, ref: string, response: "yes" | "maybe" | "no"): Promise<{ ok: boolean }> {
  return request(`/feedback`, { method: "POST", body: JSON.stringify({ kind, ref, response }) });
}

export function fetchFeedbackStatus(kind: string, ref: string): Promise<{ response: string | null }> {
  return request(`/feedback/status?kind=${kind}&ref=${encodeURIComponent(ref)}`);
}

export function submitReport(targetType: string, targetId: string, reason: string): Promise<{ ok: boolean }> {
  return request(`/reports`, { method: "POST", body: JSON.stringify({ targetType, targetId, reason }) });
}

// --- Phase B: Programs / Sessions -----------------------------------------

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

export function fetchVendorPrograms(): Promise<VendorProgramSummary[]> {
  return request(`/vendor/programs`);
}

export interface ProgramInput {
  listingType: "centre" | "club";
  listingId: string;
  title: string;
  description: string;
  ageRange?: string;
  imageUrl?: string;
  priceCents?: number;
  capacity?: number | null;
}

export function createVendorProgram(input: ProgramInput): Promise<{ id: string }> {
  return request(`/vendor/programs`, { method: "POST", body: JSON.stringify(input) });
}

export function updateVendorProgram(id: string, input: Partial<ProgramInput> & { status?: string }): Promise<{ ok: boolean }> {
  return request(`/vendor/programs/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteVendorProgram(id: string): Promise<{ ok: boolean }> {
  return request(`/vendor/programs/${id}`, { method: "DELETE" });
}

export function addProgramSession(programId: string, input: { date: string; time: string; durationMinutes?: number; capacity?: number }): Promise<{ id: string }> {
  return request(`/vendor/programs/${programId}/sessions`, { method: "POST", body: JSON.stringify(input) });
}

export function removeProgramSession(programId: string, sessionId: string): Promise<{ ok: boolean }> {
  return request(`/vendor/programs/${programId}/sessions/${sessionId}`, { method: "DELETE" });
}

export interface ProgramEnrollment {
  id: number;
  ref: string;
  participantName: string;
  participantDob: string;
  email: string;
  phone: string;
  totalCents: number;
  createdAt: string;
  status: string;
}

export function fetchProgramEnrollments(programId: string): Promise<ProgramEnrollment[]> {
  return request(`/vendor/programs/${programId}/enrollments`);
}

export function markSessionAttendance(sessionId: string, enrollmentId: number): Promise<{ ok: boolean }> {
  return request(`/vendor/program-sessions/${sessionId}/attendance/${enrollmentId}`, { method: "POST" });
}

export function fetchSessionAttendance(programId: string, sessionId: string): Promise<string[]> {
  return request(`/vendor/programs/${programId}/sessions/${sessionId}/attendance`);
}

export function fetchVendorSchedule(from?: string, days?: number): Promise<ScheduleEntry[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (days) params.set("days", String(days));
  const qs = params.toString();
  return request(`/vendor/schedule${qs ? `?${qs}` : ""}`);
}

export function fetchCentreHours(centreId: string): Promise<CentreHoursRow[]> {
  return request(`/vendor/centres/${centreId}/hours`);
}

export function saveCentreHours(centreId: string, days: CentreHoursRow[]): Promise<{ ok: boolean }> {
  return request(`/vendor/centres/${centreId}/hours`, { method: "PUT", body: JSON.stringify({ days }) });
}

// --- Phase C: Organisation / Staff / RBAC / Insights ------------------

export function fetchOrgProfile(): Promise<OrgProfile> {
  return request(`/vendor/org`);
}

export function updateOrgProfile(input: { name?: string; kind?: string }): Promise<{ ok: boolean }> {
  return request(`/vendor/org`, { method: "PUT", body: JSON.stringify(input) });
}

export function updateOrgPolicies(input: { cancellationHours?: number; bookingWindowDays?: number }): Promise<{ ok: boolean }> {
  return request(`/vendor/org/policies`, { method: "PUT", body: JSON.stringify(input) });
}

export function inviteStaff(email: string, platformRole: string): Promise<{ ok: boolean }> {
  return request(`/vendor/org/staff/invite`, { method: "POST", body: JSON.stringify({ email, platformRole }) });
}

export function revokeInvite(token: string): Promise<{ ok: boolean }> {
  return request(`/vendor/org/staff/invite/${token}`, { method: "DELETE" });
}

export function fetchInviteDetails(token: string): Promise<{ email: string; platformRole: string; orgName: string }> {
  return request(`/invites/${token}`);
}

export function acceptInvite(input: { token: string; name: string; password: string }): Promise<{ user: AuthUser }> {
  return request(`/auth/accept-invite`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchParticipants(q?: string): Promise<Participant[]> {
  return request(`/vendor/participants${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

export function fetchVendorInsights(): Promise<VendorInsights> {
  return request(`/vendor/insights`);
}

export function fetchVendorPayments(): Promise<VendorPayments> {
  return request(`/vendor/payments`);
}

export function bookingsReportCsvUrl(): string {
  return `/api/vendor/reports/bookings.csv`;
}

// --- Phase D: Platform Admin (best-effort) -----------------------------

export function fetchPlatformDashboard(): Promise<PlatformDashboardStats> {
  return request(`/platform-admin/dashboard`);
}

export function fetchTenants(): Promise<TenantSummary[]> {
  return request(`/platform-admin/tenants`);
}

export function fetchTenantDetail(id: string): Promise<{ org: TenantSummary; staff: unknown[]; flags: FeatureFlag[] }> {
  return request(`/platform-admin/tenants/${id}`);
}

export function fetchPlatformUsers(): Promise<{ id: string; email: string; name: string; role: string; status: string; orgId: string | null; platformRole: string | null; createdAt: string }[]> {
  return request(`/platform-admin/users`);
}

export function fetchFeatureFlags(orgId: string): Promise<FeatureFlag[]> {
  return request(`/platform-admin/feature-flags/${orgId}`);
}

export function setFeatureFlag(orgId: string, flagKey: string, enabled: boolean): Promise<{ ok: boolean }> {
  return request(`/platform-admin/feature-flags/${orgId}`, { method: "PUT", body: JSON.stringify({ flagKey, enabled }) });
}

export function fetchModerationReports(): Promise<ModerationReport[]> {
  return request(`/platform-admin/moderation/reports`);
}

export function resolveReport(id: number, status: "dismissed" | "actioned"): Promise<{ ok: boolean }> {
  return request(`/platform-admin/moderation/reports/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function fetchAuditLog(actorUserId?: string): Promise<AuditEntry[]> {
  return request(`/platform-admin/audit${actorUserId ? `?actorUserId=${actorUserId}` : ""}`);
}

export function supportSearch(q: string): Promise<{ bookings: unknown[]; registrations: unknown[]; users: unknown[] }> {
  return request(`/platform-admin/support/search?q=${encodeURIComponent(q)}`);
}

export function fetchSystemStatus(): Promise<{ database: string; stripeConfigured: boolean; smtpConfigured: boolean }> {
  return request(`/platform-admin/status`);
}

export type { Role };
