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
  CirclePlanIdea,
  CirclePlanPreview,
  CirclePoll,
  CircleRecentActivity,
  CircleSuggestion,
  ClubSession,
  Favourite,
  FavouriteStatus,
  Game,
  GameJoinConfirmation,
  GameParticipantSummary,
  GameUpdate,
  ManageCirclePlan,
  ManageParticipant,
  HostInsights,
  HostProfile,
  HouseholdMember,
  NeedsAttentionItem,
  Routine,
  RoutineSuggestion,
  ParticipationEntry,
  Pass,
  PassConfirmation,
  PlaceSuggestion,
  Receipt,
  ReportRecord,
  Resident,
  ResidentSearchResult,
  SavedPaymentMethod,
  ResidentFull,
  ResidentNotification,
  SearchAlert,
  WaitlistEntry,
  WaitlistOfferStatus,
  WaitlistPosition,
} from "../types";
import { getClientId } from "../clientId";
import { downloadIcs, downloadJson, request } from "./core";
import { authorizeAndFinalize } from "./media";

// Resident/guest-facing account features — magic-link session, identity,
// household, favourites, club waitlist, games, circles, club-session
// reads, passes, onboarding/preferences/receipts/feedback. Split out of the
// original single api.ts (see CLAUDE.md).

// --- guest magic-link session ---------------------------------------------

/** Always resolves the same way regardless of whether that email has any
 * bookings — see server/src/routes/guestAuth.ts. `returnTo` (onboarding audit
 * F-1) lets the emailed link carry the visitor back to whatever they were
 * doing — the server re-validates it (same-origin, not an auth page) before
 * embedding it, so passing an unsafe value here just falls back silently. */
export function requestGuestLink(email: string, returnTo?: string): Promise<{ ok: boolean }> {
  return request(`/guest/request-link`, { method: "POST", body: JSON.stringify({ email, returnTo }) });
}

/** Onboarding audit (consent pass) — two outcomes, mirroring googleSignIn()'s
 * own shape below: an existing resident's link signs straight in
 * ("signed_in"); a brand-new email gets "needs_completion" with no account
 * created yet — the caller shows an inline "Complete your account" panel
 * (name + Terms, required; marketing, optional) and calls
 * completeMagicLinkSignup() below. Closing the tab at that point leaves
 * nothing behind — no resident row exists until completion succeeds. */
export type VerifyGuestLinkResult =
  | { status: "signed_in"; email: string }
  | { status: "needs_completion"; email: string; completionToken: string };

export function verifyGuestLink(token: string): Promise<VerifyGuestLinkResult> {
  return request(`/guest/verify`, { method: "POST", body: JSON.stringify({ token }) });
}

/** Completes a brand-new magic-link signup after "needs_completion" above —
 * this is the call that actually creates the resident row + session, once
 * Terms are genuinely accepted (never inferred from opening the email). */
export function completeMagicLinkSignup(
  completionToken: string,
  input: { name: string; termsAccepted: boolean; marketingConsent: boolean }
): Promise<{ email: string }> {
  return request(`/guest/verify/complete`, { method: "POST", body: JSON.stringify({ completionToken, ...input }) });
}

export function guestLogout(): Promise<{ ok: boolean }> {
  return request(`/guest/logout`, { method: "POST" });
}

/** Optional password signup — a second, opt-in way into the same resident
 * identity requestGuestLink/verifyGuestLink above already create/use. If an
 * account already exists for that email with no password set yet (e.g.
 * created earlier via magic link), this attaches the password to it rather
 * than creating a duplicate — same account either way. termsAccepted is
 * enforced server-side too (see routes/guestAuth.ts) — this is the one
 * signup path that didn't collect it until the auth UX audit's C8 finding
 * (Google-completion and vendor signup always did). */
export function signupWithPassword(input: { name: string; email: string; password: string; termsAccepted: boolean; marketingConsent: boolean }): Promise<{ email: string }> {
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

/** Google sign-in — a third, opt-in way into the same resident identity as
 * the two above. Three outcomes (see server/src/routes/guestAuth.ts's POST
 * /google): an existing linked account signs straight in ("signed_in"); a
 * brand-new Google identity gets "needs_completion" with no account created
 * yet — the caller shows the "Complete your HelloCircle account" screen and
 * calls completeGoogleSignup() below; an existing account with a matching
 * but unlinked email throws (ApiError, `accountExists: true` in its body —
 * NOT auto-linked, see the account-linking audit note server-side). */
export type GoogleSignInResult = { status: "signed_in"; email: string } | { status: "needs_completion"; email: string; name: string | null; picture: string | null };

export function googleSignIn(idToken: string): Promise<GoogleSignInResult> {
  return request(`/guest/google`, { method: "POST", body: JSON.stringify({ idToken }) });
}

/** Finishes a "needs_completion" Google sign-in — actually creates the
 * resident row, only after the person has seen and confirmed the
 * "Complete your HelloCircle account" screen. Re-sends the same idToken
 * (still valid; Firebase ID tokens last ~1 hour) rather than anything
 * cached from the earlier googleSignIn() call. */
export function completeGoogleSignup(idToken: string, input: { name: string; termsAccepted: boolean; marketingConsent: boolean }): Promise<{ email: string }> {
  return request(`/guest/google/complete`, { method: "POST", body: JSON.stringify({ idToken, ...input }) });
}

/** Explicit "link my Google account" from an already-authenticated session —
 * see server/src/routes/residents.ts's POST /me/google. The replacement for
 * silently auto-linking on a matching email during sign-in. */
export function linkGoogleAccount(idToken: string): Promise<{ ok: boolean; googleEmail: string }> {
  return request(`/residents/me/google`, { method: "POST", body: JSON.stringify({ idToken }) });
}

/** Onboarding audit E1 — confirms the Terms for an account with none on
 * file. Only ever fills a NULL server-side; requires the explicit flag. */
export function acceptResidentTerms(): Promise<{ ok: boolean }> {
  return request(`/residents/me/accept-terms`, { method: "POST", body: JSON.stringify({ termsAccepted: true }) });
}

/** Onboarding audit §7 — re-sends the same email-confirmation link
 * POST /guest/signup already sends once at signup, for a resident whose
 * email still isn't verified (password-signup accounts, or magic-link
 * accounts that verified before this pass existed). No-op (alreadyVerified:
 * true, no email sent) if they're already verified, so a stray click can't
 * spam an inbox that doesn't need it. */
export function resendVerificationEmail(): Promise<{ ok: boolean; alreadyVerified: boolean }> {
  return request(`/residents/me/resend-verification`, { method: "POST" });
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

/** Tries the R2 flow first (entityId must be the caller's own resident id —
 * enforced server-side too); falls back to the legacy dedicated multipart
 * avatar route (POST /api/residents/me/avatar, its own multer pipeline —
 * NOT the generic /api/uploads uploadImage() other media call sites fall
 * back to, since that one is vendor/admin-only and would 401 a resident). */
export async function uploadAvatar(file: File, residentId: string): Promise<{ avatarUrl: string }> {
  const result = await authorizeAndFinalize(file, "resident-avatar", residentId);
  if (result) return request(`/residents/me/avatar-url`, { method: "PUT", body: JSON.stringify({ url: result.url }) });

  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/residents/me/avatar`, {
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

export function removeAvatar(): Promise<{ ok: boolean }> {
  return request(`/residents/me/avatar`, { method: "DELETE" });
}

/** Ends the current session immediately — see server/src/routes/
 * residents.ts's own comment on why (staying "logged in" while deactivated
 * doesn't make sense). Self-reverses on the next successful sign-in. */
export function deactivateAccount(): Promise<{ ok: boolean }> {
  return request(`/residents/me/deactivate`, { method: "POST" });
}

export function exportMyData(): Promise<void> {
  return downloadJson(`/residents/me/export`, "hellocircle-data.json");
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

/** My Life V2's "Needs You" — guest-friendly like fetchMyParticipation
 * (a signed-out guest just gets the payment-incomplete subset). */
export function fetchNeedsAttention(): Promise<NeedsAttentionItem[]> {
  return request(`/residents/me/needs-attention`);
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
 * Manage's /manage Activities tab) to narrow it to games this resident hosts. */
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
  /** Phase 2 "Circles V2" — set when converting a confirmed plan-idea into
   * this activity; server-validated (organiser + confirmed status) and
   * idempotency-guarded, unlike circleId above. */
  planId?: string;
  /** Cover image — only meaningful on updateGame() (needs a real game id
   * first). Omitting it on an unrelated edit leaves the existing cover
   * untouched (COALESCE'd server-side, see games.ts's PUT /:id). */
  imageUrl?: string;
  /** Universal Publishing, Lifecycle & Availability System — §21's create-
   * time publishing choice. Omitted (or 'active') keeps every existing
   * caller's behavior (publish immediately) unchanged. */
  lifecycle?: "draft" | "coming_soon" | "active";
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

/** Host-only, uncapped participant view (HelloCircle Manage's /manage Activities tab). */
export function fetchGameParticipantsForManage(id: string): Promise<ManageParticipant[]> {
  return request(`/games/${id}/participants/manage`);
}

/** Host removes one participant (e.g. a no-show) — frees their capacity slot. */
export function removeGameParticipant(id: string, residentId: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/participants/${residentId}/remove`, { method: "POST" });
}

/** Platform Pre-Launch Polish — Changeset 4C. Host-only, full refund of a
 * paid participant's payment via Stripe — reuses the same issueStripeRefund
 * plumbing bookings/registrations/programs/experiences already refund
 * through server-side. */
export function refundGameParticipant(id: string, residentId: string): Promise<{ ok: boolean; amountCents: number }> {
  return request(`/games/${id}/participants/${residentId}/refund`, { method: "POST" });
}

/** Host-run check-in (Host Manage spec §11) — distinct from a resident's own
 * self-serve check-in (checkInGame above): lets the host check someone else
 * in from a kiosk-style screen at the door. */
export function checkInGameParticipant(id: string, residentId: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/participants/${residentId}/check-in`, { method: "POST" });
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
export function joinGame(id: string, couponCode?: string): Promise<{ ok?: boolean; ref?: string; url?: string; totalEuro?: number }> {
  return request(`/games/${id}/join`, { method: "POST", body: JSON.stringify({ couponCode }) });
}

/** Polled by PaymentSuccess.tsx after a paid game join's Stripe redirect —
 * mirrors fetchBookingStatus/fetchRegistrationStatus. */
export function fetchGameJoinStatus(ref: string): Promise<GameJoinConfirmation> {
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

/** Universal Publishing, Lifecycle & Availability System — the host's
 * manual override (open now / pause / resume / cancel / archive). Returns
 * the updated Game so the caller can re-render off its fresh
 * effectiveLifecycle without a second round trip. */
export function setGameLifecycle(id: string, lifecycle: "draft" | "coming_soon" | "active" | "paused" | "cancelled" | "archived"): Promise<Game> {
  return request(`/games/${id}/lifecycle`, { method: "POST", body: JSON.stringify({ lifecycle }) });
}

/** "Notify me" on a Coming Soon activity. `alreadySubscribed` lets the
 * caller show the same confirmed state whether this was a new subscribe or
 * a harmless repeat click. */
export function subscribeGameNotifyMe(id: string): Promise<{ ok: boolean; alreadySubscribed: boolean }> {
  return request(`/games/${id}/notify-me`, { method: "POST" });
}

export function unsubscribeGameNotifyMe(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/notify-me`, { method: "DELETE" });
}

/** Host-only visibility + targeted invite (Vendor-parity pass) — mirrors
 * fetchVendorClubWaitlist/offerVendorClubWaitlistEntry. */
export function fetchGameWaitlist(id: string): Promise<WaitlistEntry[]> {
  return request(`/games/${id}/waitlist`);
}

export function offerGameWaitlistEntry(id: string, entryId: number): Promise<{ ok: boolean }> {
  return request(`/games/${id}/waitlist/${entryId}/offer`, { method: "POST" });
}

/** Vendor-parity pass, Phase 24 — flat "who paid me for what" list across
 * every paid game this resident hosts. `amountCents` is `games.price_cents`
 * at the time each participant joined (frozen server-side once anyone but
 * the host has joined — see games.ts's updateGame), not a per-participant
 * column, since none exists. */
export interface HostGameEarning {
  gameId: string;
  activityLabel: string;
  date: string;
  amountCents: number | null;
  participantName: string;
  joinedAt: string;
}

export function fetchHostGameEarnings(): Promise<HostGameEarning[]> {
  return request("/games/host/earnings");
}

/** Host Experience Polish — mirrors fetchVendorInsights, see HostInsights's
 * own comment in types.ts. */
export function fetchHostInsights(): Promise<HostInsights> {
  return request("/games/host/insights");
}

/** Vendor-parity pass, Phase 25 — coupons for a host's own paid games.
 * Unlike a vendor coupon, `eligibleListingId` is always required (a
 * specific game, never "any of my games") — see games.ts's `/coupons`
 * routes for why. */
export interface HostGameCoupon {
  id: number;
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  active: boolean;
  eligibleListingId: string;
}

export interface CreateHostGameCouponInput {
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses?: number;
  expiresAt?: string;
  gameId: string;
}

export function fetchHostGameCoupons(): Promise<HostGameCoupon[]> {
  return request("/games/coupons");
}

export function createHostGameCoupon(input: CreateHostGameCouponInput): Promise<{ ok: boolean }> {
  return request("/games/coupons", { method: "POST", body: JSON.stringify(input) });
}

export function setHostGameCouponActive(id: number, active: boolean): Promise<{ ok: boolean }> {
  return request(`/games/coupons/${id}/active`, { method: "PUT", body: JSON.stringify({ active }) });
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

/** Co-organisers (Vendor-parity pass, Phase 26) — no schema change, `role`
 * already supported more than one organiser; only the write path was
 * missing. Demote 409s if the target is the Circle's last organiser. */
export function promoteCircleMember(id: string, residentId: string): Promise<{ ok: boolean }> {
  return request(`/circles/${id}/members/${residentId}/promote`, { method: "POST" });
}

export function demoteCircleMember(id: string, residentId: string): Promise<{ ok: boolean }> {
  return request(`/circles/${id}/members/${residentId}/demote`, { method: "POST" });
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

/** `planId` scopes to polls attached to one plan-idea (Phase 2 "Circles
 * V2"); omitted, this is the unchanged full-circle list. */
export function fetchCirclePolls(circleId: string, planId?: string): Promise<CirclePoll[]> {
  return request(`/circles/${circleId}/polls${planId ? `?planId=${planId}` : ""}`);
}

export function createCirclePoll(circleId: string, input: { question: string; options: { date: string; time?: string }[]; planId?: string }): Promise<{ id: string }> {
  return request(`/circles/${circleId}/polls`, { method: "POST", body: JSON.stringify(input) });
}

export function voteOnCirclePollOption(circleId: string, pollId: string, optionId: number): Promise<{ ok: boolean }> {
  return request(`/circles/${circleId}/polls/${pollId}/options/${optionId}/vote`, { method: "POST" });
}

export function closeCirclePoll(circleId: string, pollId: string): Promise<{ ok: boolean }> {
  return request(`/circles/${circleId}/polls/${pollId}/close`, { method: "POST" });
}

// --- Circle plan-ideas (Phase 2 "Circles V2") -------------------------------
// See CirclePlanIdea's own comment in types.ts for why this is named
// "plan-ideas" and not "plans" (fetchCirclePlansForManage above already
// owns that name for a different, pre-existing concept).

export function fetchCirclePlanIdeas(circleId: string): Promise<CirclePlanIdea[]> {
  return request(`/circles/${circleId}/plan-ideas`);
}

export function fetchCirclePlanIdea(circleId: string, planId: string): Promise<CirclePlanIdea> {
  return request(`/circles/${circleId}/plan-ideas/${planId}`);
}

export function createCirclePlanIdea(
  circleId: string,
  input: { title: string; note?: string; proposedDate?: string; proposedTime?: string; locationText?: string }
): Promise<CirclePlanIdea> {
  return request(`/circles/${circleId}/plan-ideas`, { method: "POST", body: JSON.stringify(input) });
}

export function updateCirclePlanIdea(
  circleId: string,
  planId: string,
  input: Partial<{ title: string; note: string; proposedDate: string; proposedTime: string; locationText: string }>
): Promise<CirclePlanIdea> {
  return request(`/circles/${circleId}/plan-ideas/${planId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function confirmCirclePlanIdea(circleId: string, planId: string): Promise<CirclePlanIdea> {
  return request(`/circles/${circleId}/plan-ideas/${planId}/confirm`, { method: "POST" });
}

export function cancelCirclePlanIdea(circleId: string, planId: string): Promise<{ ok: boolean }> {
  return request(`/circles/${circleId}/plan-ideas/${planId}/cancel`, { method: "POST" });
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
export function fetchPassStatus(ref: string): Promise<PassConfirmation> {
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

/** Vendor-parity pass, Phase 27 — lets an already-verified host edit their
 * bio/phone without re-triggering admin review (the POST above 409s once
 * verified, and would reset host_status if it didn't). */
export function updateHostProfile(input: { bio: string; phone?: string }): Promise<{ ok: boolean }> {
  return request(`/residents/me/host-profile`, { method: "PUT", body: JSON.stringify(input) });
}

/** Public — no auth required, resolves only for a verified host. */
export function fetchHostProfile(residentId: string): Promise<HostProfile> {
  return request(`/residents/${residentId}/host-profile`);
}

export interface HostReview {
  id: number;
  name: string;
  rating: number;
  comment: string;
  createdAt: string;
  hostReply: string | null;
  hostRepliedAt: string | null;
}

export function fetchMyHostReviews(): Promise<HostReview[]> {
  return request(`/residents/me/host-reviews`);
}

export function replyToHostReview(id: number, reply: string): Promise<{ ok: boolean }> {
  return request(`/residents/host-reviews/${id}/reply`, { method: "POST", body: JSON.stringify({ reply }) });
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
