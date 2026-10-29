import { request } from "./core";
import type { Review, ReviewSummary } from "../types";
import type { DecisionReasonInput } from "./admin";

// Trust & Retention batch 1 (docs/trust-retention/) — reviews by their
// author, attendance corrections and verification checks. Server rules live
// in reviewEligibility.ts, routes/attendanceCorrections.ts and
// routes/verificationChecks.ts.

// --- reviews ------------------------------------------------------------------

export function fetchReviewSummary(listingType: string, listingId: string): Promise<ReviewSummary> {
  return request(`/reviews/summary?listingType=${listingType}&listingId=${encodeURIComponent(listingId)}`);
}

export function updateMyReview(id: number, input: { rating?: number; comment?: string; name?: string; tags?: string[] }): Promise<Review> {
  return request(`/reviews/mine/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteMyReview(id: number): Promise<{ ok: boolean }> {
  return request(`/reviews/mine/${id}`, { method: "DELETE" });
}

// --- attendance corrections ------------------------------------------------------

export type CorrectionKind = "booking" | "registration" | "experience" | "program_session" | "game";

export interface AttendanceCorrection {
  id: number;
  kind: string;
  ref: string;
  note: string | null;
  status: "open" | "accepted" | "declined";
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  ownerVendorId?: string | null;
  ownerHostResidentId?: string | null;
  /** Organiser view only: what the request is about. */
  placeLabel?: string | null;
  placeDate?: string | null;
  bookedBy?: string | null;
}

export function requestAttendanceCorrection(input: { kind: CorrectionKind; ref: string; note?: string }): Promise<{ id: number; status: string }> {
  return request(`/attendance/corrections`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchMyAttendanceCorrections(): Promise<AttendanceCorrection[]> {
  return request(`/attendance/corrections/mine`);
}

/** The organiser's queue. `asHost` picks the resident-host side for someone signed in as both. */
export function fetchOwnedAttendanceCorrections(asHost = false): Promise<AttendanceCorrection[]> {
  return request(`/attendance/corrections/owned${asHost ? "?as=host" : ""}`);
}

export function decideAttendanceCorrection(id: number, decision: "accept" | "decline", note?: string, asHost = false): Promise<{ ok: boolean; status: string }> {
  return request(`/attendance/corrections/${id}${asHost ? "?as=host" : ""}`, { method: "PUT", body: JSON.stringify({ decision, note }) });
}

export function markGameAttendance(gameId: string, residentId: string, status: "present" | "no_show"): Promise<{ ok: boolean }> {
  return request(`/attendance/games/${encodeURIComponent(gameId)}/participants/${encodeURIComponent(residentId)}`, { method: "POST", body: JSON.stringify({ status }) });
}

export function fetchAdminAttendanceCorrections(status?: "open" | "accepted" | "declined"): Promise<AttendanceCorrection[]> {
  return request(`/admin/attendance/corrections${status ? `?status=${status}` : ""}`);
}

export function decideAdminAttendanceCorrection(id: number, decision: "accept" | "decline", note: string): Promise<{ ok: boolean }> {
  return request(`/admin/attendance/corrections/${id}`, { method: "PUT", body: JSON.stringify({ decision, note }) });
}

// --- verification checks -----------------------------------------------------------

export type CheckType = "business_details" | "identity" | "organiser_identity";
export type CheckStatus = "pending" | "more_info" | "approved" | "rejected" | "revoked" | "expired";
export type CheckAvailability = Record<CheckType, { available: boolean; why?: string }>;

export interface VerificationCheck {
  id: number;
  subjectType: "vendor" | "resident";
  subjectId: string;
  checkType: CheckType;
  status: CheckStatus;
  submittedDetails: string | null;
  infoRequest: string | null;
  /** Admin only, and only for roles allowed to read internal notes. */
  evidenceNote?: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationListRow {
  id: number;
  subjectType: "vendor" | "resident";
  subjectId: string;
  subjectName: string | null;
  checkType: CheckType;
  status: CheckStatus;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
}

export function fetchMyBusinessChecks(): Promise<{ checks: VerificationCheck[]; availability: CheckAvailability; canRequest: boolean }> {
  return request(`/vendor/verification`);
}

export function requestBusinessCheck(details: string): Promise<{ id: number; status: string }> {
  return request(`/vendor/verification`, { method: "POST", body: JSON.stringify({ checkType: "business_details", details }) });
}

export function answerBusinessCheck(id: number, details: string): Promise<{ ok: boolean }> {
  return request(`/vendor/verification/${id}/respond`, { method: "PUT", body: JSON.stringify({ details }) });
}

export function fetchVerificationQueue(status: "open" | "all" | CheckStatus = "open"): Promise<{ checks: VerificationListRow[]; availability: CheckAvailability }> {
  return request(`/admin/verification?status=${status}`);
}

export interface VerificationCase {
  check: VerificationCheck;
  evidenceRestricted: boolean;
  subject: { id: string; name: string; email: string; county?: string; status?: string; hostStatus?: string } | null;
  availability: { available: boolean; why?: string };
  history: { id: number; action: string; previousState: string | null; newState: string; category: string | null; explanation: string | null; decidedAt: string }[];
}

export function fetchVerificationCase(id: number | string): Promise<VerificationCase> {
  return request(`/admin/verification/${id}`);
}

export function requestVerificationInfo(id: number, rowVersion: number, message: string): Promise<{ ok: boolean }> {
  return request(`/admin/verification/${id}/request-info`, { method: "PUT", body: JSON.stringify({ rowVersion, message }) });
}

export function approveVerification(id: number, rowVersion: number, evidenceNote: string, expiresAt: string | null): Promise<{ ok: boolean }> {
  return request(`/admin/verification/${id}/approve`, { method: "PUT", body: JSON.stringify({ rowVersion, evidenceNote, expiresAt }) });
}

export function declineVerification(id: number, rowVersion: number, kind: "reject" | "revoke", reason: DecisionReasonInput): Promise<{ ok: boolean }> {
  return request(`/admin/verification/${id}/${kind}`, { method: "PUT", body: JSON.stringify({ rowVersion, ...reason }) });
}

/** One past place the caller holds, and where its attendance confirmation stands. */
export interface AttendancePlace {
  /** A child's club registration: attendance is the child's, never the account holder's own. */
  forSomeoneElse?: boolean;
  correctionKind: CorrectionKind;
  /** The ref to send with requestAttendanceCorrection. */
  requestRef: string;
  label: string;
  date: string;
  /** What the organiser recorded for the place itself (null = nothing). */
  recorded: string | null;
  /** The organiser has confirmed this person attended — reviews open on this. */
  confirmed: boolean;
  request: { id: number; status: "open" | "accepted" | "declined" | "withdrawn"; decisionNote: string | null; decidedAt: string | null; createdAt: string } | null;
  canRequest: boolean;
}

/** kind: booking | registration | experience | game | program (the enrolment ref → one item per past session). */
export function fetchAttendancePlaces(kind: "booking" | "registration" | "experience" | "game" | "program", ref: string): Promise<{ items: AttendancePlace[] }> {
  return request(`/attendance/places/${kind}/${encodeURIComponent(ref)}`);
}

// --- organisers confirm named attendees ---------------------------------------

/** A past place the organisation can confirm: only its holder, never their guests. */
export interface AttendeeToConfirm {
  kind: "booking" | "registration" | "experience" | "program_session";
  ref: string;
  label: string;
  date: string;
  holderName: string | null;
  partySize: number;
  /** The booking-level door record — shown, never treated as a person confirmation. */
  doorStatus: string | null;
  confirmationId: number | null;
  confirmedBy: "organiser" | "participant" | null;
  requestOpen: boolean;
  reviewSubmitted: boolean;
}

export function fetchAttendeesToConfirm(): Promise<AttendeeToConfirm[]> {
  return request(`/attendance/to-confirm`);
}

export function confirmAttendee(kind: AttendeeToConfirm["kind"], ref: string): Promise<{ id: number; status: string }> {
  return request(`/attendance/confirm`, { method: "POST", body: JSON.stringify({ kind, ref }) });
}

export function withdrawAttendeeConfirmation(id: number, note: string): Promise<{ ok: boolean }> {
  return request(`/attendance/confirm/${id}/withdraw`, { method: "POST", body: JSON.stringify({ note }) });
}

// --- My Life: your next plan ------------------------------------------------------

export type PlanStatus = "confirmed" | "rsvp" | "pending_payment" | "pending_approval" | "waitlist" | "interest" | "cancelled";
export type PlanPhase = "before" | "today" | "after";
export type VisitState = "review_submitted" | "review_available" | "request_pending" | "declined" | "missed" | "not_confirmed";

export interface MyPlan {
  key: string;
  placeKind: "booking" | "experience" | "program" | "game" | "interest";
  ref: string;
  title: string;
  date: string;
  time: string | null;
  durationMinutes: number | null;
  durationKnown: boolean;
  startsAt: string;
  endsAt: string;
  phase: PlanPhase;
  status: PlanStatus;
  statusLabel: string;
  location: string | null;
  organiser: string | null;
  href: string;
  listingHref: string | null;
  circleName: string | null;
  imageUrl: string | null;
  activityLabel: string;
  prep: { meeting: string | null; arrival: string | null; welcome: string | null; bring: string | null };
  contact: { label: string; href: string } | null;
  followTarget: { type: "host" | "vendor" | "centre"; id: string; name: string | null } | null;
  following?: boolean;
}

export interface MyRecentVisit extends MyPlan {
  visit: VisitState;
  goAgain: { kind: "occurrence" | "venue"; title: string; date: string | null; time: string | null; href: string; priceCents: number | null; spotsLeft: number | null } | null;
}

export function fetchMyPlans(): Promise<{ next: MyPlan | null; upcoming: MyPlan[]; recent: MyRecentVisit[] }> {
  return request(`/my-life/plans`);
}
