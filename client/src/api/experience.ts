import type { DiscoverItem } from "../types";
import { request } from "./core";

// Experience 3.0 — wrappers for server/src/routes/experienceHub.ts,
// spotAlerts.ts, discover.ts's /collections and the Circle-to-Circle routes
// in circleExperience.ts. Each answers 404 while its switch is off; the
// client hides entry points with useExperienceFeatures()/useCircleFeatures().

export interface DiscoveryCollection {
  key: string;
  title: string;
  description: string;
  items: DiscoverItem[];
}

export function fetchCollections(county?: string): Promise<{ collections: DiscoveryCollection[] }> {
  return request(`/discover/collections${county ? `?county=${encodeURIComponent(county)}` : ""}`);
}

// --- Spot alerts ---
export interface SpotAlert {
  sessionId: string;
  experienceId: string;
  slug: string | null;
  title: string;
  date: string;
  time: string;
  notifiedAt: string | null;
}

export function fetchMySpotAlerts(): Promise<SpotAlert[]> {
  return request(`/experiences/spot-alerts/mine`);
}

export function createSpotAlert(experienceId: string, sessionId: string): Promise<{ ok: boolean }> {
  return request(`/experiences/${encodeURIComponent(experienceId)}/sessions/${encodeURIComponent(sessionId)}/spot-alert`, { method: "POST" });
}

export function cancelSpotAlert(experienceId: string, sessionId: string): Promise<{ ok: boolean }> {
  return request(`/experiences/${encodeURIComponent(experienceId)}/sessions/${encodeURIComponent(sessionId)}/spot-alert`, { method: "DELETE" });
}

// --- Activity Passport ---
export interface PassportEntry {
  kind: "activity" | "adventure" | "experience" | "volunteering" | "programme" | "hall" | "club" | "circle";
  title: string;
  date: string;
  href: string | null;
  evidence: "organiser" | "you" | "joined";
}

export interface Passport {
  entries: PassportEntry[];
  milestones: { key: string; label: string; date: string; title: string }[];
  memoriesShared: number;
}

export function fetchPassport(): Promise<Passport> {
  return request(`/experience/passport`);
}

// --- Programme journey ---
export type JourneyState = "attended" | "missed" | "not_recorded" | "upcoming" | "cancelled";
export interface ProgrammeJourney {
  title: string;
  sessions: { id: string; date: string; time: string; state: JourneyState }[];
  totals: { attended: number; missed: number; notRecorded: number; upcoming: number };
}

export function fetchProgrammeJourney(ref: string): Promise<ProgrammeJourney> {
  return request(`/experience/programmes/${encodeURIComponent(ref)}/journey`);
}

// --- Plan My Day ---
export interface DayStop {
  kind: DiscoverItem["kind"];
  id: string;
  title: string;
  date: string;
  time: string;
  durationMinutes: number;
  href: string;
  priceCents: number | null;
  spotsLeft?: number | null;
  place: string | null;
  imageUrl?: string | null;
  start?: string;
  end?: string;
  travelMinutes?: number | null;
}

export interface DayPlanSuggestion {
  date: string;
  stops: DayStop[];
  totalPriceCents: number;
  assumptions: { travel: string; skippedUnknownLength: number; maxStops: number };
  bookable: false;
}

export function planMyDay(input: { date: string; startTime: string; endTime: string; maxPriceCents?: number | null; county?: string; mood?: string; origin?: { lat: number; lng: number } | null; exclude?: string[] }): Promise<DayPlanSuggestion> {
  return request(`/experience/plan-my-day`, { method: "POST", body: JSON.stringify(input) });
}

export interface SavedDayPlan {
  id: string;
  title: string;
  date: string;
  items: (DayStop & { current: "listed" | "full" | "changed" | "gone" | "past"; currentTime?: string | null })[];
  createdAt: string;
  updatedAt: string;
}

export function fetchSavedPlans(): Promise<SavedDayPlan[]> {
  return request(`/experience/plans`);
}

export function saveDayPlan(input: { title: string; date: string; items: DayStop[] }): Promise<{ id: string }> {
  return request(`/experience/plans`, { method: "POST", body: JSON.stringify(input) });
}

export function updateDayPlan(id: string, input: { title?: string; items?: DayStop[] }): Promise<{ ok: boolean }> {
  return request(`/experience/plans/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteDayPlan(id: string): Promise<{ ok: boolean }> {
  return request(`/experience/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Circle-to-Circle activities ---
export interface CircleCollaboration {
  id: string;
  direction: "sent" | "received";
  proposer: { id: string; slug: string | null; name: string } | null;
  partner: { id: string; slug: string | null; name: string } | null;
  title: string;
  note: string | null;
  proposedDate: string | null;
  proposedTime: string | null;
  locationText: string | null;
  status: "proposed" | "accepted" | "declined" | "withdrawn" | "activity_created";
  declineReason: string | null;
  gameId: string | null;
  /** Circles 3.0 — set when the invitation shares one of the proposer's plans. */
  planId?: string | null;
  createdAt: string;
}

export function fetchCollaborations(circleId: string): Promise<CircleCollaboration[]> {
  return request(`/circles/${encodeURIComponent(circleId)}/collaborations`);
}

export function proposeCollaboration(circleId: string, input: { partnerCircleId: string; title: string; note?: string; proposedDate?: string; proposedTime?: string; locationText?: string; planId?: string }): Promise<{ id: string }> {
  return request(`/circles/${encodeURIComponent(circleId)}/collaborations`, { method: "POST", body: JSON.stringify(input) });
}

export function respondToCollaboration(circleId: string, id: string, accept: boolean, reason?: string): Promise<{ ok: boolean }> {
  return request(`/circles/${encodeURIComponent(circleId)}/collaborations/${encodeURIComponent(id)}/respond`, { method: "POST", body: JSON.stringify({ accept, reason }) });
}

export function withdrawCollaboration(circleId: string, id: string): Promise<{ ok: boolean }> {
  return request(`/circles/${encodeURIComponent(circleId)}/collaborations/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}
