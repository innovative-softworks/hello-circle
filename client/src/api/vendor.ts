import type { PayoutHistoryItem } from "../components/commerceDisplay";
import type {
  HostOpportunity,
  AttendanceStatus,
  Centre,
  CentreHoursRow,
  Club,
  ClubParticipant,
  DemandRow,
  Experience,
  ExperienceKind,
  ExperienceSessionRow,
  MyRegistration,
  OrgProfile,
  Participant,
  Program,
  Room,
  RoomBlock,
  ScheduleEntry,
  SessionAttendanceEntry,
  VendorExperienceBooking,
  VendorExperienceSummary,
  VendorInsights,
  VendorListingSummary,
  VendorNotification,
  VendorPayments,
  VendorProgramSummary,
  VendorBookingRow,
  VendorScheduleItem,
  VendorStats,
  VendorToday,
  WaitlistEntry,
} from "../types";
import { downloadJson, request } from "./core";

// Everything under the vendor dashboard — own-listing CRUD, rooms/blocks/
// hours, messages/demand/check-in, Programs (vendor side), Organisation/
// Staff/RBAC/Insights. Split out of the original single api.ts (see
// CLAUDE.md).

export interface CentreInput {
  name: string;
  area: string;
  county: string;
  /** Only meaningful at creation time, to seed the centre's starter room —
   * ignored by PUT /vendor/centres/:id. See vendor.ts's rooms CRUD to edit
   * capacity/rate/payment for an existing centre. */
  capacity?: number;
  from?: number;
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
  phone?: string;
  accessibility?: string[];
  /** From AddressSearch (Form System Audit, Phase 4) — real geocoded
   * coordinates, when set, take priority over the server's county-centroid
   * approximation. */
  lat?: number;
  lng?: number;
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
  phone?: string;
  accessibility?: string[];
  category?: string;
  audience?: "kids" | "adults" | "all";
  /** See CentreInput's identical fields — same AddressSearch flow. */
  lat?: number;
  lng?: number;
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

/** Only `name` is actually required server-side now — the Guided Flow
 * creation wizard (Form System Audit, Phase 5) creates a 'draft' row after
 * its first step with just that, then fills the rest in via
 * updateVendorCentre as later steps complete. */
export function createVendorCentre(input: Partial<CentreInput> & { name: string }): Promise<Centre> {
  return request(`/vendor/centres`, { method: "POST", body: JSON.stringify(input) });
}

export function updateVendorCentre(id: string, input: Partial<CentreInput>): Promise<Centre> {
  return request(`/vendor/centres/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

/** Vendor-triggered 'draft' → 'pending' transition (Guided Flow's final
 * "Review & Publish" step) — distinct from admin's own approve/reject. */
export function publishVendorCentre(id: string): Promise<Centre> {
  return request(`/vendor/centres/${id}/publish`, { method: "POST" });
}

export function deleteVendorCentre(id: string): Promise<{ ok: boolean }> {
  return request(`/vendor/centres/${id}`, { method: "DELETE" });
}

export function pauseVendorCentre(id: string): Promise<Centre> {
  return request(`/vendor/centres/${id}/pause`, { method: "POST" });
}

export function resumeVendorCentre(id: string): Promise<Centre> {
  return request(`/vendor/centres/${id}/resume`, { method: "POST" });
}

export function duplicateVendorCentre(id: string): Promise<Centre> {
  return request(`/vendor/centres/${id}/duplicate`, { method: "POST" });
}

export interface BlockInput {
  date: string;
  reason?: string;
  /** Omit = whole-centre block; set = only that one room. */
  roomId?: string;
  /** "HH:00" start and end (end exclusive); omit both for the whole day. */
  startTime?: string;
  endTime?: string;
}

/** A booking a closure would cover (OG-04). */
export interface ClosureAffectedBooking {
  ref: string;
  roomId: string;
  roomName: string | null;
  time: string;
  duration: number;
  name: string;
  guests: number;
  paymentStatus: string;
  totalCents: number | null;
  online: boolean;
}

export function previewVendorBlock(centreId: string, input: BlockInput): Promise<{ affected: ClosureAffectedBooking[] }> {
  return request(`/vendor/centres/${centreId}/blocks/preview`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchVendorBlocks(centreId: string): Promise<RoomBlock[]> {
  return request(`/vendor/centres/${centreId}/blocks`);
}

export function createVendorBlock(
  centreId: string,
  input: BlockInput & { expectedRefs?: string[]; resolution?: "keep" | "cancel_refund" }
): Promise<{ id: string; affected: number; cancelled: { ref: string; refund: string; refundError?: string }[] }> {
  return request(`/vendor/centres/${centreId}/blocks`, { method: "POST", body: JSON.stringify(input) });
}

export function deleteVendorBlock(centreId: string, blockId: number): Promise<{ ok: boolean }> {
  return request(`/vendor/centres/${centreId}/blocks/${blockId}`, { method: "DELETE" });
}

export interface RoomInput {
  name: string;
  cap: number;
  rate: number;
  desc?: string;
  paymentMethod?: "online" | "cash";
  active?: boolean;
}

export function fetchVendorRooms(centreId: string): Promise<Room[]> {
  return request(`/vendor/centres/${centreId}/rooms`);
}

export function createVendorRoom(centreId: string, input: RoomInput): Promise<{ id: string }> {
  return request(`/vendor/centres/${centreId}/rooms`, { method: "POST", body: JSON.stringify(input) });
}

export function updateVendorRoom(centreId: string, roomId: string, input: Partial<RoomInput>): Promise<{ ok: boolean }> {
  return request(`/vendor/centres/${centreId}/rooms/${roomId}`, { method: "PUT", body: JSON.stringify(input) });
}

export function fetchCentreHours(centreId: string): Promise<CentreHoursRow[]> {
  return request(`/vendor/centres/${centreId}/hours`);
}

export function saveCentreHours(centreId: string, days: CentreHoursRow[]): Promise<{ ok: boolean }> {
  return request(`/vendor/centres/${centreId}/hours`, { method: "PUT", body: JSON.stringify({ days }) });
}

/** Only `name` is actually required server-side now — same Guided Flow
 * creation-wizard pattern as createVendorCentre above. */
export function createVendorClub(input: Partial<ClubInput> & { name: string }): Promise<Club> {
  return request(`/vendor/clubs`, { method: "POST", body: JSON.stringify(input) });
}

export function updateVendorClub(id: string, input: Partial<ClubInput>): Promise<Club> {
  return request(`/vendor/clubs/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

/** Vendor-triggered 'draft' → 'pending' transition — see publishVendorCentre. */
export function publishVendorClub(id: string): Promise<Club> {
  return request(`/vendor/clubs/${id}/publish`, { method: "POST" });
}

export function deleteVendorClub(id: string): Promise<{ ok: boolean }> {
  return request(`/vendor/clubs/${id}`, { method: "DELETE" });
}

export function pauseVendorClub(id: string): Promise<Club> {
  return request(`/vendor/clubs/${id}/pause`, { method: "POST" });
}

export function resumeVendorClub(id: string): Promise<Club> {
  return request(`/vendor/clubs/${id}/resume`, { method: "POST" });
}

export function duplicateVendorClub(id: string): Promise<Club> {
  return request(`/vendor/clubs/${id}/duplicate`, { method: "POST" });
}

export function createClubSession(
  input: { clubId: string; dayOfWeek: number; time: string; capacity?: number; label?: string; instructorName?: string; imageUrl?: string }
): Promise<{ id: string }> {
  return request(`/club-sessions`, { method: "POST", body: JSON.stringify(input) });
}

export function updateClubSession(
  id: string,
  input: Partial<{ dayOfWeek: number; time: string; capacity: number | null; label: string; active: boolean; instructorName: string; imageUrl: string }>
): Promise<{ ok: boolean }> {
  return request(`/club-sessions/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteClubSession(id: string): Promise<{ ok: boolean }> {
  return request(`/club-sessions/${id}`, { method: "DELETE" });
}

export function fetchVendorClubWaitlist(clubId: string): Promise<WaitlistEntry[]> {
  return request(`/vendor/clubs/${clubId}/waitlist`);
}

export function offerVendorClubWaitlistEntry(clubId: string, entryId: number): Promise<{ ok: boolean }> {
  return request(`/vendor/clubs/${clubId}/waitlist/${entryId}/offer`, { method: "POST" });
}

export function fetchVendorBookings(centreId?: string): Promise<VendorBookingRow[]> {
  return request(`/vendor/bookings${centreId ? `?centreId=${encodeURIComponent(centreId)}` : ""}`);
}

/** Booking UX Phase 6 (B13) — a provider cancellation refunds a paid online order in full: `refund` says what happened. */
export type ProviderCancelResult = { ok: boolean; refund?: "none" | "refunded" | "failed"; refundError?: string };

export function cancelVendorBooking(ref: string): Promise<ProviderCancelResult> {
  return request(`/vendor/bookings/${encodeURIComponent(ref)}/cancel`, { method: "POST" });
}

export function resendBookingConfirmation(ref: string): Promise<{ ok: boolean }> {
  return request(`/vendor/bookings/${encodeURIComponent(ref)}/resend-confirmation`, { method: "POST" });
}

export function refundVendorBooking(ref: string): Promise<{ ok: boolean }> {
  return request(`/vendor/bookings/${encodeURIComponent(ref)}/refund`, { method: "POST" });
}

export function fetchVendorRegistrations(clubId?: string): Promise<(MyRegistration & { email: string; phone: string })[]> {
  return request(`/vendor/registrations${clubId ? `?clubId=${encodeURIComponent(clubId)}` : ""}`);
}

export function cancelVendorRegistration(ref: string): Promise<ProviderCancelResult> {
  return request(`/vendor/registrations/${encodeURIComponent(ref)}/cancel`, { method: "POST" });
}

export function refundVendorRegistration(ref: string): Promise<{ ok: boolean }> {
  return request(`/vendor/registrations/${encodeURIComponent(ref)}/refund`, { method: "POST" });
}

export function fetchClubParticipants(clubId: string): Promise<ClubParticipant[]> {
  return request(`/vendor/clubs/${clubId}/participants`);
}

export function resendRegistrationConfirmation(ref: string): Promise<{ ok: boolean }> {
  return request(`/vendor/registrations/${encodeURIComponent(ref)}/resend-confirmation`, { method: "POST" });
}

export function fetchVendorNotifications(): Promise<VendorNotification[]> {
  return request(`/vendor/notifications`);
}

export function markVendorNotificationRead(id: number): Promise<{ ok: boolean }> {
  return request(`/vendor/notifications/${id}/read`, { method: "POST" });
}

// --- vendor: messages / demand / check-in (NEXT / FUTURE) ------------------

export function sendVendorMessage(input: { listingType: "centre" | "club"; listingId: string; subject: string; body: string }): Promise<{ ok: boolean; recipientCount: number }> {
  return request(`/vendor/messages`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchVendorMessages(): Promise<{ id: number; listingType: string; listingId: string; subject: string; body: string; createdAt: string }[]> {
  return request(`/vendor/messages`);
}

export interface VendorReview {
  id: number;
  listingType: "centre" | "club";
  listingId: string;
  listingName: string;
  name: string;
  rating: number;
  comment: string;
  createdAt: string;
  vendorReply: string | null;
  vendorRepliedAt: string | null;
}

export function fetchVendorReviews(): Promise<VendorReview[]> {
  return request(`/vendor/reviews`);
}

export function replyToVendorReview(id: number, reply: string): Promise<{ ok: boolean }> {
  return request(`/vendor/reviews/${id}/reply`, { method: "POST", body: JSON.stringify({ reply }) });
}

export interface VendorCoupon {
  id: number;
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  active: number;
  eligibleListingType: "centre" | "club" | null;
  eligibleListingId: string | null;
}

export interface VendorCouponInput {
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses?: number;
  expiresAt?: string;
  eligibleListingType?: "centre" | "club";
  eligibleListingId?: string;
}

export function fetchVendorCoupons(): Promise<VendorCoupon[]> {
  return request(`/vendor/coupons`);
}

export function createVendorCoupon(input: VendorCouponInput): Promise<{ ok: boolean }> {
  return request(`/vendor/coupons`, { method: "POST", body: JSON.stringify(input) });
}

export function setVendorCouponActive(id: number, active: boolean): Promise<{ ok: boolean }> {
  return request(`/vendor/coupons/${id}/active`, { method: "PUT", body: JSON.stringify({ active }) });
}

export function fetchVendorDemand(scope: "own" | "all" = "own"): Promise<DemandRow[]> {
  return request(`/vendor/demand${scope === "all" ? "?scope=all" : ""}`);
}

/** Release 3 — `status` "no_show" records a no-show; default is a check-in. */
export function checkInBooking(kind: "booking" | "registration", ref: string, status: "present" | "no_show" = "present"): Promise<{ ok: boolean }> {
  return request(`/vendor/checkin/${kind}/${encodeURIComponent(ref)}`, { method: "POST", body: JSON.stringify({ status }) });
}

export function markExperienceAttendance(experienceId: string, ref: string, status: "present" | "no_show"): Promise<{ ok: boolean }> {
  return request(`/vendor/experiences/${encodeURIComponent(experienceId)}/bookings/${encodeURIComponent(ref)}/attendance`, { method: "POST", body: JSON.stringify({ status }) });
}

export function fetchCheckInStatus(kind: "booking" | "registration", ref: string): Promise<{ checkedIn: boolean; status?: string | null; checkedInAt: string | null; cancelledAt: string | null }> {
  return request(`/vendor/checkin/${kind}/${encodeURIComponent(ref)}`);
}

// --- Phase B: Programs / Sessions (vendor side) -----------------------------

export function fetchVendorPrograms(): Promise<VendorProgramSummary[]> {
  return request(`/vendor/programs`);
}

/** Unlike fetchProgram (public.ts, published-only), returns a program in
 * any status — needed to open a draft program's manage view. */
/** Release 2 — vendor "Participation experience" editor (attributes plus
 * the what-to-expect fields each type supports; see
 * server/src/routes/vendorParticipation.ts). */
export interface VendorParticipation {
  attributes: string[];
  arrivalInstructions?: string;
  accessibilityInfo?: string;
  /** Release 3 — official Circle; only one organised by someone in your org. */
  circleId?: string | null;
}

export function fetchLinkableCircles(): Promise<{ id: string; name: string; slug: string | null }[]> {
  return request(`/vendor/participation/circles`);
}

export type VendorParticipationType = "program" | "experience" | "club";

export function fetchVendorParticipation(type: VendorParticipationType, id: string): Promise<VendorParticipation> {
  return request(`/vendor/participation/${type}/${encodeURIComponent(id)}`);
}

export function saveVendorParticipation(type: VendorParticipationType, id: string, input: VendorParticipation): Promise<VendorParticipation> {
  return request(`/vendor/participation/${type}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function fetchVendorProgram(id: string): Promise<Program> {
  return request(`/vendor/programs/${id}`);
}

export interface ProgramInput {
  /** Release 6 — created from a Host Opportunity (analytics only). */
  fromDemand?: string;
  listingType: "centre" | "club";
  listingId: string;
  title: string;
  description: string;
  ageRange?: string;
  imageUrl?: string;
  priceCents?: number;
  capacity?: number | null;
  category?: string;
  skillLevel?: string;
  equipment?: string[];
  instructorName?: string;
  guardianRules?: string;
  safeguardingInfo?: string;
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

export function addProgramSession(
  programId: string,
  input: { date: string; time: string; durationMinutes?: number; capacity?: number; instructorName?: string; roomId?: string }
): Promise<{ id: string }> {
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

export function markSessionAttendance(sessionId: string, enrollmentId: number, status: AttendanceStatus): Promise<{ ok: boolean }> {
  return request(`/vendor/program-sessions/${sessionId}/attendance/${enrollmentId}`, { method: "POST", body: JSON.stringify({ status }) });
}

export function fetchSessionAttendance(programId: string, sessionId: string): Promise<SessionAttendanceEntry[]> {
  return request(`/vendor/programs/${programId}/sessions/${sessionId}/attendance`);
}

export function fetchVendorSchedule(from?: string, days?: number): Promise<ScheduleEntry[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (days) params.set("days", String(days));
  const qs = params.toString();
  return request(`/vendor/schedule${qs ? `?${qs}` : ""}`);
}

// Vendor Experience Polish — unified across Centre bookings, Club sessions,
// Program sessions and Experience sessions (see the server route's own
// comment); shared by the Overview "Next Up" section and, later, the full
// Schedule tab. Deliberately a separate endpoint from fetchVendorSchedule
// above, which stays Program-only.
export function fetchVendorScheduleItems(from?: string, days?: number): Promise<VendorScheduleItem[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (days) params.set("days", String(days));
  const qs = params.toString();
  return request(`/vendor/schedule-items${qs ? `?${qs}` : ""}`);
}

export function fetchVendorToday(): Promise<VendorToday> {
  return request(`/vendor/today`);
}

// --- Adventures & Experiences (vendor side) --------------------------------

export interface ExperienceInput {
  /** Release 6 — created from a Host Opportunity (analytics only). */
  fromDemand?: string;
  kind?: ExperienceKind;
  /** Release 5 — volunteer listings. */
  skillsRequired?: string;
  cause?: string;
  minAge?: number | null;
  title: string;
  area?: string;
  county?: string;
  lat?: number | null;
  lng?: number | null;
  meetingPoint?: string;
  blurb: string;
  description?: string;
  difficulty?: string;
  durationMinutes?: number;
  distanceKm?: number | null;
  elevationGainM?: number | null;
  terrainType?: string;
  fitnessRequirements?: string;
  itinerary?: string;
  equipmentProvided?: string;
  equipmentRequired?: string;
  transportInfo?: string;
  safetyInfo?: string;
  weatherPolicy?: string;
  eligibility?: string;
  cancellationTerms?: string;
  priceCents?: number;
  capacity?: number;
  paymentMethod?: "online" | "cash";
  images?: string[];
}

export function fetchVendorExperiences(): Promise<VendorExperienceSummary[]> {
  return request(`/vendor/experiences`);
}

export function fetchVendorExperience(id: string): Promise<Experience> {
  return request(`/vendor/experiences/${id}`);
}

/** Only `title` is actually required server-side now — same Guided Flow
 * creation-wizard pattern as createVendorCentre/createVendorClub above. */
export function createVendorExperience(input: Partial<ExperienceInput> & { title: string }): Promise<{ id: string }> {
  return request(`/vendor/experiences`, { method: "POST", body: JSON.stringify(input) });
}

export function updateVendorExperience(id: string, input: Partial<ExperienceInput>): Promise<{ ok: boolean }> {
  return request(`/vendor/experiences/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

/** Vendor-triggered 'draft' → 'pending' transition — see publishVendorCentre. */
export function publishVendorExperience(id: string): Promise<{ id: string }> {
  return request(`/vendor/experiences/${id}/publish`, { method: "POST" });
}

export function deleteVendorExperience(id: string): Promise<{ ok: boolean }> {
  return request(`/vendor/experiences/${id}`, { method: "DELETE" });
}

export function fetchVendorExperienceSessions(experienceId: string): Promise<ExperienceSessionRow[]> {
  return request(`/vendor/experiences/${experienceId}/sessions`);
}

export function addExperienceSession(experienceId: string, input: { date: string; time: string; capacity?: number; repeatWeeks?: number; salesCloseHours?: number }): Promise<{ id: string }> {
  return request(`/vendor/experiences/${experienceId}/sessions`, { method: "POST", body: JSON.stringify(input) });
}

export function removeExperienceSession(experienceId: string, sessionId: string): Promise<{ ok: boolean }> {
  return request(`/vendor/experiences/${experienceId}/sessions/${sessionId}`, { method: "DELETE" });
}

// OG-19 — one departure's capacity / booking cut-off (salesCloseAt: ISO instant, "" or null clears it).
export function updateExperienceSession(experienceId: string, sessionId: string, input: { capacity?: number; salesCloseAt?: string | null; salesCloseHours?: number | null }): Promise<{ ok: boolean }> {
  return request(`/vendor/experiences/${experienceId}/sessions/${sessionId}`, { method: "PUT", body: JSON.stringify(input) });
}

// OG-19 — move a booking to another departure; only when the customer asked (customerAsked must be true).
export function moveExperienceBooking(experienceId: string, bookingId: number, input: { sessionId: string; customerAsked: true; note?: string }): Promise<{ ok: boolean; date: string; time: string }> {
  return request(`/vendor/experiences/${experienceId}/bookings/${bookingId}/move`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchVendorExperienceBookings(experienceId: string): Promise<VendorExperienceBooking[]> {
  return request(`/vendor/experiences/${experienceId}/bookings`);
}

// --- Phase C: Organisation / Staff / RBAC / Insights ------------------

export function fetchOrgProfile(): Promise<OrgProfile> {
  return request(`/vendor/org`);
}

export function updateOrgProfile(input: {
  name?: string;
  kind?: string;
  description?: string;
  website?: string;
  socials?: { instagram?: string; facebook?: string; x?: string };
}): Promise<{ ok: boolean }> {
  return request(`/vendor/org`, { method: "PUT", body: JSON.stringify(input) });
}

export function updateVendorLogo(logo: string | null): Promise<{ ok: boolean }> {
  return request(`/vendor/org/logo`, { method: "PUT", body: JSON.stringify({ logo }) });
}

export function updateOrgPolicies(input: {
  cancellationHours?: number;
  bookingWindowDays?: number;
  refundPolicyText?: string;
  taxNumber?: string;
  businessRegistrationNumber?: string;
}): Promise<{ ok: boolean }> {
  return request(`/vendor/org/policies`, { method: "PUT", body: JSON.stringify(input) });
}

export function inviteStaff(email: string, platformRole: string): Promise<{ ok: boolean }> {
  return request(`/vendor/org/staff/invite`, { method: "POST", body: JSON.stringify({ email, platformRole }) });
}

export function revokeInvite(id: string): Promise<{ ok: boolean }> {
  return request(`/vendor/org/staff/invite/${id}`, { method: "DELETE" });
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

/** Release 6 — resident-backed demand in this org's counties. */
export function fetchVendorOpportunities(): Promise<{ opportunities: HostOpportunity[]; counties: string[] }> {
  return request(`/vendor/opportunities`);
}

// --- Revenue & Connect Stage 3: ledger-backed earnings ---------------------

export interface PartnerEarnings {
  party?: { partyType: string; partyId: string };
  pendingMinor: number;
  availableMinor: number;
  /** Settled, not yet transferred to the partner's Stripe account. */
  transferDueMinor: number;
  /** Transferred to the partner's Stripe account (bank payouts are separate). */
  transferredMinor: number;
  settlements: { id: number; runKey: string; netMinor: number; status: string; createdAt: string }[];
}

export function fetchVendorEarnings(): Promise<PartnerEarnings> {
  return request(`/vendor/earnings`);
}

/** Booking UX Phase 6 (B12) — every order on the organisation's listings, with what still needs doing. */
export interface VendorOrder {
  type: "booking" | "registration" | "program" | "experience";
  ref: string;
  listingName: string;
  customerName: string;
  email: string;
  date: string | null;
  time: string | null;
  quantity: number;
  totalCents: number;
  status: string;
  paymentStatus: string;
  paidOnline: boolean;
  depositCents: number;
  refundedCents: number;
  attention: ("refund_pending" | "deposit_due")[];
  createdAt: string;
  /** The centre, club, programme or experience the order is for (OG-13). */
  listingId?: string;
}
export function fetchVendorOrders(attentionOnly = false): Promise<VendorOrder[]> {
  return request(`/vendor/orders${attentionOnly ? "?attention=1" : ""}`);
}

/** Partial (or remaining) refund of one of the organisation's own online orders. */
export function issueVendorRefund(input: { sourceType: "booking" | "registration" | "program" | "experience"; ref: string; amountMinor?: number; reason: string }): Promise<{ refundId: number; amountMinor: number; full: boolean }> {
  return request(`/vendor/refunds`, { method: "POST", body: JSON.stringify(input) });
}

// --- Revenue & Connect Stage 5a: payout account (Stripe Connect) -------------

/** Stage 5e — the partner-facing payout-account states (wording: help entries connect_state_<state>). */
export type PayoutAccountState = "not_started" | "onboarding_incomplete" | "under_review" | "more_information_required" | "transfers_unavailable" | "payouts_unavailable" | "enabled";
export interface PayoutsOverview {
  enabled: boolean;
  state: PayoutAccountState;
  account: {
    apiModel: "v1" | "v2";
    businessType: string | null;
    detailsSubmitted: boolean;
    payoutsEnabled: boolean;
    transfersActive: boolean;
    transfersCapability: string;
    payoutsCapability: string;
    requirementsDue: string[];
    requirementsPastDue: string[];
    requirementsPending: string[];
    disabledReason: string | null;
    onboardingCompleted: boolean;
    lastSyncedAt: string | null;
  } | null;
  readiness: string[];
  /** HelloCircle → the partner's Stripe account (weekly settlement transfers). */
  transfers: { id: number; settlementId: number; amountMinor: number; reversedMinor: number; status: string; createdAt: string; bookings: number }[];
  /** The partner's Stripe account → their bank (made by Stripe, mirrored here). */
  bankPayouts: { id: string; amountMinor: number; currency: string; status: string; arrivalDate: string | null; failureMessage: string | null }[];
  openDebt: { id: number; outstandingMinor: number; openedAt: string } | null;
  /** R3A — transfers and bank payouts as one dated list (same records as above). */
  history?: PayoutHistoryItem[];
  /** R3A — the weekly minimum from this partner's settlement rule. */
  minimumPayoutCents?: number | null;
}
/** scope "vendor" = the signed-in vendor's organisation; "host" = the signed-in resident as a host. */
export function fetchPayouts(scope: "vendor" | "host"): Promise<PayoutsOverview> {
  return request(`/${scope}/payout-account`);
}
export function startPayoutOnboarding(scope: "vendor" | "host"): Promise<{ url: string; expiresAt: string | null; purpose: "onboarding" | "update" }> {
  return request(`/${scope}/payout-account/onboarding`, { method: "POST", body: JSON.stringify({ country: "IE" }) });
}
export function refreshPayoutAccount(scope: "vendor" | "host", source: "api" | "return" = "api"): Promise<PayoutsOverview> {
  return request(`/${scope}/payout-account/refresh`, { method: "POST", body: JSON.stringify({ source }) });
}

// --- Revenue & Connect Stage 5e: venue/host split agreements -----------------

export interface VenueSplitAgreement {
  id: number;
  gameId: string;
  gameTitle?: string | null;
  version: number;
  venuePartyType: string;
  venuePartyId: string;
  hostResidentId: string;
  mode: "percentage" | "fixed_venue" | "fixed_host";
  venueBps: number | null;
  venueFixedMinor: number | null;
  hostFixedMinor: number | null;
  status: "proposed" | "accepted" | "declined" | "withdrawn" | "superseded";
  proposedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
}
/** The venue's organisation: splits proposed by hosts for games at its venues. */
export function fetchVenueSplits(): Promise<VenueSplitAgreement[]> {
  return request(`/vendor/splits`);
}
export function decideVenueSplit(id: number, accept: boolean, reason?: string): Promise<VenueSplitAgreement> {
  return request(`/vendor/splits/${id}/decision`, { method: "POST", body: JSON.stringify({ accept, reason }) });
}
export function payoutDashboardLink(scope: "vendor" | "host"): Promise<{ url: string }> {
  return request(`/${scope}/payout-account/dashboard`, { method: "POST", body: "{}" });
}

// --- Revenue & Connect Stage 5b: plan (Pro on Stripe Billing) + reward points --

/** Stage 5f — server-derived plan state (the UI never infers it). */
export type PlanState = "unavailable" | "free" | "processing" | "paid_active" | "cancelling" | "payment_failed" | "reward_active" | "pro_granted";
export type RedemptionState = "available" | "not_enough" | "debt" | "paid_active" | "cancelling_active" | "disabled";
export type RewardHistoryKind = "earned" | "venue_share" | "host_share" | "refund_reversal" | "dispute_reversal" | "debt_repayment" | "redemption" | "adjustment";
export interface RewardHistoryEntry { id: string; kind: RewardHistoryKind; points: number; at: string; sourceType: string | null; sourceRef: string | null; note: string | null }
export interface PartnerPlanOverview {
  enabled: boolean;
  rewardsEnabled: boolean;
  state: PlanState;
  canManage: boolean;
  testMode: boolean;
  plan: { planKey: "free" | "pro" | "enterprise"; source: string; effectiveFrom: string | null; effectiveTo: string | null; rewardFunded: boolean };
  subscription: { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; graceUntil: string | null; graceDays: number | null; graceDaysRemaining: number | null; billingStartsAt: string | null } | null;
  pendingCheckout: boolean;
  price: { netMinor: number; vatMinor: number; grossMinor: number; vatBps: number; vatMode: string; taxLabel: string };
  graceDaysPolicy: number;
  rewards: {
    enabled: boolean;
    points: number;
    availablePoints: number;
    debtPoints: number;
    nextExpiry: string | null;
    redemptionPoints: number;
    pointsPerEuro: number;
    pendingPoints: number;
    earnedThisMonth: number;
    progressBps: number;
    recent: RewardHistoryEntry[];
    redemption: RedemptionState;
  };
}
export function fetchMyPlan(scope: "vendor" | "host"): Promise<PartnerPlanOverview> {
  return request(`/${scope}/plan`);
}
export function fetchCheckoutStatus(scope: "vendor" | "host"): Promise<{ state: PlanState; pendingCheckout: boolean }> {
  return request(`/${scope}/plan/checkout-status`);
}
export function startProCheckout(scope: "vendor" | "host", termsAccepted: boolean): Promise<{ id: string; url: string | null; reused: boolean; billingStartsAt?: string | null }> {
  return request(`/${scope}/plan/pro/checkout`, { method: "POST", body: JSON.stringify({ termsAccepted }) });
}
export function cancelProSubscription(scope: "vendor" | "host"): Promise<{ ok: boolean }> {
  return request(`/${scope}/plan/pro/cancel`, { method: "POST", body: "{}" });
}
export function resumeProSubscription(scope: "vendor" | "host"): Promise<{ ok: boolean }> {
  return request(`/${scope}/plan/pro/resume`, { method: "POST", body: "{}" });
}
export function openBillingPortal(scope: "vendor" | "host"): Promise<{ url: string }> {
  return request(`/${scope}/plan/billing-portal`, { method: "POST", body: "{}" });
}
export function fetchRewardHistory(scope: "vendor" | "host", opts: { limit?: number; before?: string; beforeId?: string } = {}): Promise<RewardHistoryEntry[]> {
  const q = new URLSearchParams();
  if (opts.limit) q.set("limit", String(opts.limit));
  if (opts.before) q.set("before", opts.before);
  if (opts.beforeId) q.set("beforeId", opts.beforeId);
  return request(`/${scope}/plan/rewards/history${q.toString() ? `?${q}` : ""}`);
}
export function redeemRewardPoints(scope: "vendor" | "host"): Promise<{ redemptionId: number; proFrom: string; proUntil: string }> {
  return request(`/${scope}/plan/rewards/redeem`, { method: "POST", body: "{}" });
}

/** D-03 — the latest moderation decision on one of your own listings (never the internal note); null for older decisions. */
export function fetchVendorListingDecision(type: "centre" | "club" | "experience", id: string): Promise<{ latest: import("./admin").PublicDecision | null }> {
  return request(`/vendor/decisions/${type}/${encodeURIComponent(id)}`);
}

/** D-01 — the organisation's existing obligations; the one partner API available while suspended. */
export function fetchVendorObligations(): Promise<import("../types").VendorObligations> {
  return request(`/vendor/obligations`);
}

/** D-08 — owner changes an accepted member's role. rowVersion from the Staff page (409 if stale). */
export function changeStaffRole(memberId: string, platformRole: string, rowVersion: number): Promise<{ ok: boolean; changed: boolean; platformRole: string; rowVersion: number }> {
  return request(`/vendor/org/staff/${encodeURIComponent(memberId)}`, { method: "PUT", body: JSON.stringify({ platformRole, rowVersion }) });
}

/** D-08 — owner removes a member from the organisation. */
export function removeStaffMember(memberId: string, rowVersion: number): Promise<{ ok: boolean }> {
  return request(`/vendor/org/staff/${encodeURIComponent(memberId)}`, { method: "DELETE", body: JSON.stringify({ rowVersion }) });
}

// --- OG-11 — proposed booking changes (the customer accepts or declines) -----

export interface BookingChangeProposal {
  id: number;
  oldDate: string;
  oldTime: string;
  proposedDate: string;
  proposedTime: string;
  message: string;
  status: "proposed" | "accepted" | "declined" | "withdrawn" | "expired";
  createdAt: string;
  respondedAt: string | null;
  responseNote: string | null;
}
export function proposeVendorBookingChange(ref: string, input: { date: string; time: string; message: string }): Promise<{ id: number }> {
  return request(`/vendor/bookings/${encodeURIComponent(ref)}/propose-change`, { method: "POST", body: JSON.stringify(input) });
}
export function fetchVendorBookingChanges(ref: string): Promise<BookingChangeProposal[]> {
  return request(`/vendor/bookings/${encodeURIComponent(ref)}/changes`);
}
export function withdrawVendorBookingChange(ref: string, id: number): Promise<{ ok: boolean }> {
  return request(`/vendor/bookings/${encodeURIComponent(ref)}/changes/${id}/withdraw`, { method: "POST" });
}

// --- OG-20 — Customers ------------------------------------------------------

export interface VendorCustomer {
  email: string;
  name: string;
  phone: string | null;
  orders: number;
  upcoming: number;
  cancelled: number;
  spentCents: number;
  lastActivity: string;
  listings: string[];
}
export function fetchVendorCustomers(q?: string): Promise<VendorCustomer[]> {
  return request(`/vendor/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}
export interface VendorCustomerRecord {
  email: string;
  name: string;
  phone: string | null;
  attended: number;
  noShows: number;
  orders: { type: string; ref: string; listingName: string; date: string | null; time: string | null; status: string; paymentStatus: string; totalCents: number; createdAt: string; attendance: string | null }[];
}
export function fetchVendorCustomer(email: string): Promise<VendorCustomerRecord> {
  return request(`/vendor/customers/${encodeURIComponent(email)}`);
}

// --- OG-17 — complaints about this organisation (text + outcome, never who) --
export interface ComplaintAboutYou {
  id: number;
  kind: string;
  subjectType: string;
  subjectRef: string | null;
  body: string;
  status: "open" | "in_review" | "closed";
  decision: string | null;
  statementOfReasons: string | null;
  decidedAt: string | null;
  createdAt: string;
  response: string | null;
  respondedAt: string | null;
}
export function fetchVendorComplaints(): Promise<ComplaintAboutYou[]> {
  return request(`/vendor/complaints`);
}
export function respondToVendorComplaint(id: number, response: string): Promise<{ ok: boolean }> {
  return request(`/vendor/complaints/${id}/response`, { method: "POST", body: JSON.stringify({ response }) });
}

// --- OG-25 — monthly statement of recorded orders (not a VAT invoice) --------
export interface VendorStatement {
  month: string;
  lines: { type: string; ref: string; listingName: string; customerName: string; createdAt: string; totalCents: number; paymentStatus: string; status: string; customerFeeCents: number | null; platformFeeCents: number | null; partnerShareCents: number | null }[];
  refunds: { type: string; ref: string; amountCents: number; createdAt: string }[];
  payouts: { id: string; amountCents: number; status: string; arrivalDate: string | null; createdAt: string }[];
  totals: { orders: number; orderTotalCents: number; refunds: number; refundedCents: number; recordedFeeCents: number; recordedPartnerShareCents: number; payouts: number; paidOutCents: number };
}

export function fetchVendorStatement(month: string): Promise<VendorStatement> {
  return request(`/vendor/statements/${month}`);
}

export function downloadVendorStatement(month: string): Promise<void> {
  return downloadJson(`/vendor/statements/${month}?format=csv`, `hellocircle-statement-${month}.csv`);
}
