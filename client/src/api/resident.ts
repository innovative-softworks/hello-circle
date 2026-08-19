import type {
  Circle,
  ClubSession,
  Favourite,
  Game,
  HouseholdMember,
  ParticipationEntry,
  Pass,
  Receipt,
  Resident,
  ResidentFull,
  ResidentNotification,
  WaitlistOfferStatus,
  WaitlistPosition,
} from "../types";
import { request } from "./core";

// Resident/guest-facing account features — magic-link session, identity,
// household, favourites, club waitlist, games, circles, club-session
// reads, passes, onboarding/preferences/receipts/feedback. Split out of the
// original single api.ts (see CLAUDE.md).

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

/** Everything this person has done or is doing — bookings, registrations,
 * program enrollments, games, circles — in one normalized list. Guest-
 * friendly like fetchMyBookings/fetchMyRegistrations (games/circles just
 * come back empty when signed out). */
export function fetchMyParticipation(): Promise<ParticipationEntry[]> {
  return request(`/residents/me/participation`);
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

/** Every game this resident is hosting or has joined — distinct from
 * fetchGames(), the public "what's open" list. */
export function fetchMyGames(): Promise<Game[]> {
  return request(`/games/mine`);
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
  soloFriendly?: boolean;
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

/** Every circle this resident belongs to — distinct from fetchCircles(),
 * the public browse list. */
export function fetchMyCircles(): Promise<Circle[]> {
  return request(`/circles/mine`);
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

// --- recurring club sessions (NEXT), read side ------------------------------

export function fetchClubSessions(clubId: string): Promise<ClubSession[]> {
  return request(`/club-sessions?clubId=${encodeURIComponent(clubId)}`);
}

// --- passes (NEXT) -----------------------------------------------------

export function fetchMyPasses(): Promise<Pass[]> {
  return request(`/passes/me`);
}

export function createPassCheckout(input: { listingId: string; creditsTotal: number }): Promise<{ ref: string; url?: string; totalEuro: number }> {
  return request(`/passes/checkout`, { method: "POST", body: JSON.stringify({ listingType: "club", ...input }) });
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
