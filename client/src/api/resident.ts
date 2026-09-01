import type {
  BlockedResident,
  ChatFeed,
  ChatMessage,
  ChatScopeType,
  Circle,
  CircleActivityStats,
  CircleInvitation,
  CircleMemberSummary,
  CircleMoment,
  CirclePlanPreview,
  CirclePoll,
  CircleRecentActivity,
  CircleSuggestion,
  ClubSession,
  Favourite,
  FavouriteStatus,
  Game,
  GameParticipantSummary,
  GameUpdate,
  ManageCirclePlan,
  ManageParticipant,
  HostProfile,
  HouseholdMember,
  Routine,
  RoutineSuggestion,
  ParticipationEntry,
  Pass,
  PlaceSuggestion,
  Receipt,
  ReportRecord,
  Resident,
  ResidentSearchResult,
  SavedPaymentMethod,
  ResidentFull,
  ResidentNotification,
  SearchAlert,
  WaitlistOfferStatus,
  WaitlistPosition,
} from "../types";
import { downloadIcs, request } from "./core";

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

/** Optional password signup — a second, opt-in way into the same resident
 * identity requestGuestLink/verifyGuestLink above already create/use. If an
 * account already exists for that email with no password set yet (e.g.
 * created earlier via magic link), this attaches the password to it rather
 * than creating a duplicate — same account either way. */
export function signupWithPassword(input: { name: string; email: string; password: string }): Promise<{ email: string }> {
  return request(`/guest/signup`, { method: "POST", body: JSON.stringify(input) });
}

export function loginWithPassword(input: { email: string; password: string }): Promise<{ email: string }> {
  return request(`/guest/login`, { method: "POST", body: JSON.stringify(input) });
}

/** Always resolves the same way regardless of whether that email has a
 * password-login account — same no-existence-leak principle as
 * requestGuestLink above. */
export function requestResidentPasswordReset(email: string): Promise<{ ok: boolean }> {
  return request(`/guest/request-password-reset`, { method: "POST", body: JSON.stringify({ email }) });
}

export function resetResidentPassword(input: { token: string; password: string }): Promise<{ email: string }> {
  return request(`/guest/reset-password`, { method: "POST", body: JSON.stringify(input) });
}

/** Set a password on the currently signed-in resident (any sign-in method),
 * or change an existing one — see routes/residents.ts's own comment on why
 * currentPassword is only required when one's already set. */
export function changeResidentPassword(input: { currentPassword?: string; newPassword: string }): Promise<{ ok: boolean; hasPassword: boolean }> {
  return request(`/residents/me/password`, { method: "PUT", body: JSON.stringify(input) });
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

// --- native push (Capacitor migration Phase 5) ------------------------------

export function registerPushToken(input: { token: string; platform: string }): Promise<{ ok: boolean }> {
  return request(`/residents/me/push-token`, { method: "POST", body: JSON.stringify(input) });
}

export function unregisterPushToken(token: string): Promise<{ ok: boolean }> {
  return request(`/residents/me/push-token`, { method: "DELETE", body: JSON.stringify({ token }) });
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

export function addHouseholdMember(input: { firstName: string; lastName: string; dob?: string; notes?: string; guardianConsentGiven?: boolean }): Promise<{ id: number }> {
  return request(`/household`, { method: "POST", body: JSON.stringify(input) });
}

export function updateHouseholdMember(
  id: number,
  input: Partial<{ firstName: string; lastName: string; dob: string; notes: string; guardianConsentGiven: boolean }>
): Promise<{ ok: boolean }> {
  return request(`/household/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteHouseholdMember(id: number): Promise<{ ok: boolean }> {
  return request(`/household/${id}`, { method: "DELETE" });
}

// --- Safety Centre (IA spec §13) ---------------------------------------

export function fetchBlockedResidents(): Promise<BlockedResident[]> {
  return request(`/residents/me/blocked`);
}

export function blockResident(residentId: string): Promise<{ ok: boolean }> {
  return request(`/residents/me/blocked/${residentId}`, { method: "POST" });
}

export function unblockResident(residentId: string): Promise<{ ok: boolean }> {
  return request(`/residents/me/blocked/${residentId}`, { method: "DELETE" });
}

export function fetchMyReports(): Promise<ReportRecord[]> {
  return request(`/reports/mine`);
}

export function updatePrivacyPrefs(input: { hideFromFamiliarCount?: boolean; discoverableByName?: boolean }): Promise<{ ok: boolean }> {
  return request(`/residents/me/privacy-prefs`, { method: "PUT", body: JSON.stringify(input) });
}

export function downloadGameIcs(id: string): Promise<void> {
  return downloadIcs(`/games/${id}/ics`, `game-${id}.ics`);
}

// Circle invite picker (implementation backlog #3) — only ever matches
// residents who've opted in via discoverableByName.
export function searchResidents(q: string): Promise<ResidentSearchResult[]> {
  return request(`/residents/search?q=${encodeURIComponent(q)}`);
}

// --- Payment methods (implementation backlog #1) -------------------------
// No "add a card" call here on purpose — cards get saved via Stripe
// Checkout's own "Save my payment details" checkbox during a real
// purchase, not a separate form. This is list/set-default/remove only.

export function fetchPaymentMethods(): Promise<{ methods: SavedPaymentMethod[]; defaultMethodId: string | null }> {
  return request(`/residents/me/payment-methods`);
}

export function setDefaultPaymentMethod(id: string): Promise<{ ok: boolean }> {
  return request(`/residents/me/payment-methods/${id}/default`, { method: "PUT" });
}

export function removePaymentMethod(id: string): Promise<{ ok: boolean }> {
  return request(`/residents/me/payment-methods/${id}`, { method: "DELETE" });
}

// --- favourites (MVP) ---------------------------------------------------

export function fetchFavourites(): Promise<Favourite[]> {
  return request(`/favourites`);
}

export function addFavourite(listingType: Favourite["listingType"], listingId: string, status?: FavouriteStatus): Promise<{ ok: boolean }> {
  return request(`/favourites`, { method: "POST", body: JSON.stringify({ listingType, listingId, status }) });
}

export function removeFavourite(listingType: Favourite["listingType"], listingId: string): Promise<{ ok: boolean }> {
  return request(`/favourites`, { method: "DELETE", body: JSON.stringify({ listingType, listingId }) });
}

/** Moves a favourite between Interested/Planning/Joined — 'joined' is
 * normally set automatically by a real booking/registration/game-join (see
 * server/src/routes/favourites.ts's upgradeFavouriteStatus), this is for a
 * resident manually signalling stronger intent (e.g. "Planning to go"). */
export function updateFavouriteStatus(listingType: Favourite["listingType"], listingId: string, status: FavouriteStatus): Promise<{ ok: boolean }> {
  return request(`/favourites/status`, { method: "PUT", body: JSON.stringify({ listingType, listingId, status }) });
}

// --- follows ---------------------------------------------------------------
// "Keep me in the loop" on a vendor Provider or a resident Host — see
// server/src/db/index.ts's `follows` table comment for why this is
// deliberately separate from favourites above (a standing relationship
// with an account, not a per-listing interest/status progression).

export type FollowedType = "vendor" | "host" | "centre";
export type NotificationLevel = "highlights" | "everything";

export function followEntity(followedType: FollowedType, followedId: string): Promise<{ ok: boolean }> {
  return request(`/follows`, { method: "POST", body: JSON.stringify({ followedType, followedId }) });
}

export function unfollowEntity(followedType: FollowedType, followedId: string): Promise<{ ok: boolean }> {
  return request(`/follows`, { method: "DELETE", body: JSON.stringify({ followedType, followedId }) });
}

export function setFollowNotificationLevel(followedType: FollowedType, followedId: string, level: NotificationLevel): Promise<{ ok: boolean }> {
  return request(`/follows/notification-level`, { method: "PUT", body: JSON.stringify({ followedType, followedId, level }) });
}

export interface FollowFeedItem {
  kind: string;
  id: string;
  title: string;
  date: string;
  time: string;
  href: string;
  imageUrl: string | null;
}

export function fetchFollowFeed(): Promise<FollowFeedItem[]> {
  return request(`/follows/feed`);
}

export interface FollowedEntity {
  followedType: FollowedType;
  followedId: string;
  notificationLevel: NotificationLevel;
  name: string | null;
  imageUrl: string | null;
  href: string;
}

export function fetchMyFollows(): Promise<FollowedEntity[]> {
  return request(`/follows`);
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
 * fetchGames(), the public "what's open" list. Pass `hostedOnly` (HelloCircle
 * Manage's /manage/activities) to narrow it to games this resident hosts. */
export function fetchMyGames(opts?: { hostedOnly?: boolean }): Promise<Game[]> {
  return request(`/games/mine${opts?.hostedOnly ? "?hostedOnly=1" : ""}`);
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
  minParticipants?: number;
  confirmationDeadline?: string;
  description?: string;
  durationMinutes?: number;
  equipmentNeeded?: string;
  minAge?: number;
  surfaceType?: string;
  indoorOutdoor?: "indoor" | "outdoor" | "mixed";
  meetingInstructions?: string;
  cancellationPolicy?: string;
  /** Set when this game is created as a specific Circle's plan (HelloCircle
   * Manage Phase 4's "Create plan" deep-link). */
  circleId?: string;
}

export function createGame(input: CreateGameInput): Promise<Game> {
  return request(`/games`, { method: "POST", body: JSON.stringify(input) });
}

/** Host-only edit — same field set as createGame's input. Price is silently
 * frozen server-side once anyone besides the host has joined. */
export function updateGame(id: string, input: CreateGameInput): Promise<Game> {
  return request(`/games/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

/** "Who's going" preview — public, name-only (see GameParticipantSummary's
 * own comment in types.ts for the privacy reasoning). */
export function fetchGameParticipants(id: string): Promise<GameParticipantSummary> {
  return request(`/games/${id}/participants`);
}

/** Host-only, uncapped participant view (HelloCircle Manage /manage/activities). */
export function fetchGameParticipantsForManage(id: string): Promise<ManageParticipant[]> {
  return request(`/games/${id}/participants/manage`);
}

/** Host removes one participant (e.g. a no-show) — frees their capacity slot. */
export function removeGameParticipant(id: string, residentId: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/participants/${residentId}/remove`, { method: "POST" });
}

/** Host-posted announcements — public read. */
export function fetchGameUpdates(id: string): Promise<GameUpdate[]> {
  return request(`/games/${id}/updates`);
}

/** Host-only — posting an update also notifies every joined participant. */
export function postGameUpdate(id: string, message: string): Promise<GameUpdate> {
  return request(`/games/${id}/updates`, { method: "POST", body: JSON.stringify({ message }) });
}

/** Free/cash games resolve `{ ok: true }` immediately; a priced game
 * (NEXT) instead returns a Stripe `url` to redirect to. */
export function joinGame(id: string): Promise<{ ok?: boolean; ref?: string; url?: string; totalEuro?: number }> {
  return request(`/games/${id}/join`, { method: "POST" });
}

/** Polled by PaymentSuccess.tsx after a paid game join's Stripe redirect —
 * mirrors fetchBookingStatus/fetchRegistrationStatus. */
export function fetchGameJoinStatus(ref: string): Promise<{ ref: string; paymentStatus: string; totalCents: number }> {
  return request(`/games/status/${encodeURIComponent(ref)}`);
}

export function leaveGame(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/join`, { method: "DELETE" });
}

export function cancelGame(id: string, reason?: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function joinGameWaitlist(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/waitlist`, { method: "POST" });
}

export function leaveGameWaitlist(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/waitlist`, { method: "DELETE" });
}

// --- Self-serve check-in + attendance confirmation (IA spec §11) -----------

export function checkInGame(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/check-in`, { method: "POST" });
}

export function confirmGameAttendance(id: string, attended: boolean): Promise<{ ok: boolean }> {
  return request(`/games/${id}/confirm-attendance`, { method: "POST", body: JSON.stringify({ attended }) });
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

export function fetchCircleUpcoming(id: string): Promise<CirclePlanPreview[]> {
  return request(`/circles/${id}/upcoming`);
}

/** Members preview — public, name-only (see CircleMemberSummary's own
 * comment in types.ts for the privacy reasoning). Pass full:true for
 * "See all" (every member, not just the preview cap). */
export function fetchCircleMembers(id: string, full?: boolean): Promise<CircleMemberSummary> {
  return request(`/circles/${id}/members${full ? "?full=1" : ""}`);
}

export function fetchCircleRecentActivity(id: string): Promise<CircleRecentActivity[]> {
  return request(`/circles/${id}/recent-activity`);
}

export function fetchCircleMoments(id: string): Promise<CircleMoment[]> {
  return request(`/circles/${id}/moments`);
}

export function fetchCircleActivity(id: string, period: "week" | "month"): Promise<CircleActivityStats> {
  return request(`/circles/${id}/activity?period=${period}`);
}

/** Repetition-detection → "Make this a Circle?" (implementation plan Phase
 * 8) — activities where this resident keeps playing with the same people. */
export function fetchCircleSuggestions(): Promise<CircleSuggestion[]> {
  return request(`/circles/suggestions`);
}

export type CircleJoinMode = "open" | "approval" | "invite";

interface CircleInput {
  name: string;
  activityLabel?: string;
  area?: string;
  county?: string;
  about?: string;
  centreId?: string;
  whatWeDo?: string;
  whoCanJoin?: string;
  values?: string;
  joinMode?: CircleJoinMode;
}

export function createCircle(input: CircleInput): Promise<{ id: string; slug: string }> {
  return request(`/circles`, { method: "POST", body: JSON.stringify(input) });
}

/** Organiser-only edit of the circle's own fields (HelloCircle Manage Phase 4)
 * — same field set as createCircle's input, plus imageUrl. */
export function updateCircle(id: string, input: CircleInput & { imageUrl?: string }): Promise<Circle> {
  return request(`/circles/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

/** `requested: true` means an 'approval' Circle filed a pending join
 * request instead of joining outright — see routes/circles.ts's own
 * join-mode comment for the full state machine (an outstanding organiser
 * invite always joins outright regardless of mode). */
export function joinCircle(id: string): Promise<{ ok: boolean; requested?: boolean }> {
  return request(`/circles/${id}/join`, { method: "POST" });
}

/** Also withdraws a still-pending join request, not just membership. */
export function leaveCircle(id: string): Promise<{ ok: boolean }> {
  return request(`/circles/${id}/join`, { method: "DELETE" });
}

export function fetchCircleMembership(id: string): Promise<{ member: boolean; role: string | null; requested: boolean }> {
  return request(`/circles/${id}/membership`);
}

export interface CircleJoinRequest {
  id: string;
  residentId: string;
  name: string;
  createdAt: string;
}

/** Organiser-only pending join-requests inbox for an 'approval' Circle. */
export function fetchCircleJoinRequests(circleId: string): Promise<CircleJoinRequest[]> {
  return request(`/circles/${circleId}/join-requests`);
}

export function respondToCircleJoinRequest(circleId: string, requestId: string, accept: boolean): Promise<{ ok: boolean }> {
  return request(`/circles/${circleId}/join-requests/${requestId}/respond`, { method: "POST", body: JSON.stringify({ accept }) });
}

/** Organiser-only, real plans linked via games.circle_id (HelloCircle Manage
 * Phase 4) — distinct from fetchCircleUpcoming's public activity-label match,
 * which stays a "similar activity nearby" discovery preview, not an
 * ownership claim. */
export function fetchCirclePlansForManage(id: string): Promise<ManageCirclePlan[]> {
  return request(`/circles/${id}/plans`);
}

/** Organiser removes a non-organiser member. */
export function removeCircleMember(id: string, residentId: string): Promise<{ ok: boolean }> {
  return request(`/circles/${id}/members/${residentId}/remove`, { method: "POST" });
}

// --- Circle settings, invitations & planning polls (IA spec §10) -----------

export function setCircleStatus(id: string, status: "active" | "closed"): Promise<{ ok: boolean }> {
  return request(`/circles/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function inviteToCircle(circleId: string, residentId: string): Promise<{ ok: boolean }> {
  return request(`/circles/${circleId}/invite`, { method: "POST", body: JSON.stringify({ residentId }) });
}

export function fetchMyCircleInvitations(): Promise<CircleInvitation[]> {
  return request(`/circles/invitations/mine`);
}

export function respondToCircleInvitation(id: string, accept: boolean): Promise<{ ok: boolean }> {
  return request(`/circles/invitations/${id}/respond`, { method: "POST", body: JSON.stringify({ accept }) });
}

export function fetchCirclePolls(circleId: string): Promise<CirclePoll[]> {
  return request(`/circles/${circleId}/polls`);
}

export function createCirclePoll(circleId: string, input: { question: string; options: { date: string; time?: string }[] }): Promise<{ id: string }> {
  return request(`/circles/${circleId}/polls`, { method: "POST", body: JSON.stringify(input) });
}

export function voteOnCirclePollOption(circleId: string, pollId: string, optionId: number): Promise<{ ok: boolean }> {
  return request(`/circles/${circleId}/polls/${pollId}/options/${optionId}/vote`, { method: "POST" });
}

export function closeCirclePoll(circleId: string, pollId: string): Promise<{ ok: boolean }> {
  return request(`/circles/${circleId}/polls/${pollId}/close`, { method: "POST" });
}

// --- Participation Chat (implementation plan Phase 11) ----------------------
// Polling, not WebSocket (see server/src/routes/chat.ts). 'game' scope is
// temporary (opens 24h before, archives some hours after); 'circle' scope
// is persistent. `after` fetches only messages newer than that id.

export function fetchChatMessages(scopeType: ChatScopeType, scopeId: string, after?: number): Promise<ChatFeed> {
  return request(`/chat/${scopeType}/${scopeId}/messages${after ? `?after=${after}` : ""}`);
}

export function postChatMessage(scopeType: ChatScopeType, scopeId: string, body: string): Promise<ChatMessage> {
  return request(`/chat/${scopeType}/${scopeId}/messages`, { method: "POST", body: JSON.stringify({ body }) });
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

/** Polled by PaymentSuccess.tsx after a pass purchase's Stripe redirect —
 * mirrors fetchBookingStatus/fetchRegistrationStatus. */
export function fetchPassStatus(ref: string): Promise<{ ref: string; paymentStatus: string; totalCents: number }> {
  return request(`/passes/status/${encodeURIComponent(ref)}`);
}

// --- Phase A: onboarding, preferences, receipts, feedback -----------------

export function fetchResidentFull(): Promise<{ resident: ResidentFull | null }> {
  return request(`/residents/me`);
}

export function saveOnboarding(input: {
  homeCounty?: string;
  searchRadiusKm?: number;
  interests?: string[];
  availability?: string[];
  goals?: string[];
  prefGroupSize?: string;
  prefBeginnerFriendly?: boolean;
  prefSoloFriendly?: boolean;
  prefBudget?: string;
}): Promise<{ ok: boolean }> {
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

// --- "Host" trust tier (IA spec five-layer audit) --------------------------
// Badge-only — see server/src/routes/residents.ts's own comment. Submitting
// this is also the guidelines acceptance for v1.
export function applyToBecomeHost(input: { bio: string; phone?: string }): Promise<{ ok: boolean }> {
  return request(`/residents/me/host-application`, { method: "POST", body: JSON.stringify(input) });
}

/** Public — no auth required, resolves only for a verified host. */
export function fetchHostProfile(residentId: string): Promise<HostProfile> {
  return request(`/residents/${residentId}/host-profile`);
}

// --- Routines-as-an-object (IA spec §9) -------------------------------------

export function fetchRoutineSuggestions(): Promise<RoutineSuggestion[]> {
  return request(`/residents/me/routine-suggestions`);
}

export function fetchMyRoutines(): Promise<Routine[]> {
  return request(`/residents/me/routines`);
}

export function createRoutine(input: { activityLabel: string; centreId?: string | null; dayOfWeek: number; time?: string }): Promise<{ id: string }> {
  return request(`/residents/me/routines`, { method: "POST", body: JSON.stringify(input) });
}

export function updateRoutine(id: string, input: { status?: "active" | "paused" | "cancelled"; time?: string }): Promise<{ ok: boolean }> {
  return request(`/residents/me/routines/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

type FeedbackAnswer = "yes" | "maybe" | "no";

/** Fuller post-activity feedback (IA spec §11) — the 4 extra questions are
 * all optional, same as server-side; pass only the ones you're collecting. */
export function submitFeedback(
  kind: string,
  ref: string,
  response: FeedbackAnswer,
  extra?: { beginnerFriendly?: FeedbackAnswer; soloFriendly?: FeedbackAnswer; descriptionAccurate?: FeedbackAnswer; welcoming?: FeedbackAnswer }
): Promise<{ ok: boolean }> {
  return request(`/feedback`, { method: "POST", body: JSON.stringify({ kind, ref, response, ...extra }) });
}

export interface FeedbackStatus {
  response: FeedbackAnswer | null;
  beginnerFriendly: FeedbackAnswer | null;
  soloFriendly: FeedbackAnswer | null;
  descriptionAccurate: FeedbackAnswer | null;
  welcoming: FeedbackAnswer | null;
}

export function fetchFeedbackStatus(kind: string, ref: string): Promise<FeedbackStatus> {
  return request(`/feedback/status?kind=${kind}&ref=${encodeURIComponent(ref)}`);
}

export function submitReport(targetType: string, targetId: string, reason: string): Promise<{ ok: boolean }> {
  return request(`/reports`, { method: "POST", body: JSON.stringify({ targetType, targetId, reason }) });
}

// --- Community-contributed places (master-prompt punch list #4) -----------

export function submitPlaceSuggestion(input: {
  suggestedName: string;
  category: "centre" | "club";
  area?: string;
  county?: string;
  description?: string;
  contactInfo?: string;
}): Promise<{ id: string }> {
  return request(`/place-suggestions`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchMyPlaceSuggestions(): Promise<PlaceSuggestion[]> {
  return request(`/place-suggestions/mine`);
}

// --- Saved-search alerts (master-prompt punch list #5) -----------------

export function fetchSearchAlerts(): Promise<SearchAlert[]> {
  return request(`/residents/me/search-alerts`);
}

export function createSearchAlert(input: { county?: string; keywords?: string; mood?: string }): Promise<{ id: string }> {
  return request(`/residents/me/search-alerts`, { method: "POST", body: JSON.stringify(input) });
}

export function setSearchAlertActive(id: string, active: boolean): Promise<{ ok: boolean }> {
  return request(`/residents/me/search-alerts/${id}`, { method: "PUT", body: JSON.stringify({ active }) });
}

export function deleteSearchAlert(id: string): Promise<{ ok: boolean }> {
  return request(`/residents/me/search-alerts/${id}`, { method: "DELETE" });
}
