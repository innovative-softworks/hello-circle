import { getClientId } from "./clientId";
import type {
  AdminStats,
  AuthUser,
  Centre,
  Club,
  MyBooking,
  MyRegistration,
  Review,
  Role,
  RoomBlock,
  VendorListingSummary,
  VendorNotification,
  VendorStats,
} from "./types";

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
    throw new Error(body.error || `Request failed: ${res.status}`);
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

export function cancelBooking(ref: string): Promise<{ ok: boolean }> {
  return request(`/bookings/${encodeURIComponent(ref)}/cancel`, { method: "POST" });
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

export function cancelRegistration(ref: string): Promise<{ ok: boolean }> {
  return request(`/registrations/${encodeURIComponent(ref)}/cancel`, { method: "POST" });
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
}

export function fetchVendorListings(): Promise<{ centres: VendorListingSummary[]; clubs: VendorListingSummary[] }> {
  return request(`/vendor/listings`);
}

export function fetchVendorStats(): Promise<VendorStats> {
  return request(`/vendor/stats`);
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

export type { Role };
