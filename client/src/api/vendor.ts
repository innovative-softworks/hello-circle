import type {
  AttendanceStatus,
  Centre,
  CentreHoursRow,
  Club,
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
  VendorStats,
  VendorToday,
  WaitlistEntry,
} from "../types";
import { request } from "./core";

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

export interface BlockInput {
  date: string;
  reason?: string;
  /** Omit = whole-centre block; set = only that one room. */
  roomId?: string;
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

export function createClubSession(
  input: { clubId: string; dayOfWeek: number; time: string; capacity?: number; label?: string; instructorName?: string }
): Promise<{ id: string }> {
  return request(`/club-sessions`, { method: "POST", body: JSON.stringify(input) });
}

export function deleteClubSession(id: string): Promise<{ ok: boolean }> {
  return request(`/club-sessions/${id}`, { method: "DELETE" });
}

export function fetchVendorClubWaitlist(clubId: string): Promise<WaitlistEntry[]> {
  return request(`/vendor/clubs/${clubId}/waitlist`);
}

export function fetchVendorBookings(): Promise<VendorBookingRow[]> {
  return request(`/vendor/bookings`);
}

export function cancelVendorBooking(ref: string): Promise<{ ok: boolean }> {
  return request(`/vendor/bookings/${encodeURIComponent(ref)}/cancel`, { method: "POST" });
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

// --- vendor: messages / demand / check-in (NEXT / FUTURE) ------------------

export function sendVendorMessage(input: { listingType: "centre" | "club"; listingId: string; subject: string; body: string }): Promise<{ ok: boolean; recipientCount: number }> {
  return request(`/vendor/messages`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchVendorMessages(): Promise<{ id: number; listingType: string; listingId: string; subject: string; body: string; createdAt: string }[]> {
  return request(`/vendor/messages`);
}

export function fetchVendorDemand(scope: "own" | "all" = "own"): Promise<DemandRow[]> {
  return request(`/vendor/demand${scope === "all" ? "?scope=all" : ""}`);
}

export function checkInBooking(kind: "booking" | "registration", ref: string): Promise<{ ok: boolean }> {
  return request(`/vendor/checkin/${kind}/${encodeURIComponent(ref)}`, { method: "POST" });
}

export function fetchCheckInStatus(kind: "booking" | "registration", ref: string): Promise<{ checkedIn: boolean; checkedInAt: string | null }> {
  return request(`/vendor/checkin/${kind}/${encodeURIComponent(ref)}`);
}

// --- Phase B: Programs / Sessions (vendor side) -----------------------------

export function fetchVendorPrograms(): Promise<VendorProgramSummary[]> {
  return request(`/vendor/programs`);
}

/** Unlike fetchProgram (public.ts, published-only), returns a program in
 * any status — needed to open a draft program's manage view. */
export function fetchVendorProgram(id: string): Promise<Program> {
  return request(`/vendor/programs/${id}`);
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

export function fetchVendorToday(): Promise<VendorToday> {
  return request(`/vendor/today`);
}

// --- Adventures & Experiences (vendor side) --------------------------------

export interface ExperienceInput {
  kind?: ExperienceKind;
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

export function addExperienceSession(experienceId: string, input: { date: string; time: string; capacity?: number }): Promise<{ id: string }> {
  return request(`/vendor/experiences/${experienceId}/sessions`, { method: "POST", body: JSON.stringify(input) });
}

export function removeExperienceSession(experienceId: string, sessionId: string): Promise<{ ok: boolean }> {
  return request(`/vendor/experiences/${experienceId}/sessions/${sessionId}`, { method: "DELETE" });
}

export function fetchVendorExperienceBookings(experienceId: string): Promise<VendorExperienceBooking[]> {
  return request(`/vendor/experiences/${experienceId}/bookings`);
}

// --- Phase C: Organisation / Staff / RBAC / Insights ------------------

export function fetchOrgProfile(): Promise<OrgProfile> {
  return request(`/vendor/org`);
}

export function updateOrgProfile(input: { name?: string; kind?: string }): Promise<{ ok: boolean }> {
  return request(`/vendor/org`, { method: "PUT", body: JSON.stringify(input) });
}

export function updateVendorLogo(logo: string | null): Promise<{ ok: boolean }> {
  return request(`/vendor/org/logo`, { method: "PUT", body: JSON.stringify({ logo }) });
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
