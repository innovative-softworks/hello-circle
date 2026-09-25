export type PaymentMethod = "online" | "cash";

export interface Room {
  id: string;
  centreId: string;
  name: string;
  cap: number;
  rate: number;
  desc: string;
  paymentMethod: PaymentMethod;
  active: boolean;
}

export interface Centre {
  id: string;
  name: string;
  area: string;
  county: string;
  rating: number;
  reviews: number;
  /** "Would you do this again?" — null when nobody's answered yet. */
  wouldRepeatPercent: number | null;
  wouldRepeatCount: number;
  capacity: number;
  from: number;
  managedBy: string;
  ph: string;
  image: string;
  images: string[];
  blurb: string;
  amenities: string[];
  rooms: Room[];
  opensAt: string;
  closesAt: string;
  paymentMethod: PaymentMethod;
  isOpen: boolean;
  mapUrl: string;
  lat: number | null;
  lng: number | null;
  /** Coordinate provenance (Maps cost-control follow-up pass) — 'confirmed'
   * (a vendor picked/adjusted a real address), 'approximate' (this server
   * generated it from a county centroid because none was supplied), or
   * 'unknown' (a pre-existing row from before this field existed — real
   * provenance genuinely can't be recovered after the fact). Detail pages
   * label anything other than 'confirmed' as an approximate area rather
   * than showing it as a precise pin. */
  locationSource: "confirmed" | "approximate" | "unknown";
  claimed: boolean;
  /** Provider public profile (IA spec §5) — null for an unclaimed listing. */
  vendorId: string | null;
  phone: string;
  accessibility: string[];
  /** Bounded "featured" flag (IA spec §16) — admin-toggled promotion. */
  featured: boolean;
  /** Feature flags (implementation backlog #5) — whether this centre's org
   * has Open Booking enabled; gates BookingFlow.tsx's checkbox client-side
   * (createBookingInternal() is the real server-side enforcement). */
  openBookingEnabled: boolean;
  /** Slugs (master-prompt punch list #1) — null until backfilled/generated;
   * link-construction call sites use <code>slug ?? id</code>. */
  slug: string | null;
  /** Only meaningful to a vendor/admin fetching their own listing — public
   * fetches (getApprovedCentre) are always "approved" here in practice.
   * "draft" (Form System Audit, Phase 5) means the Guided Flow creation
   * wizard hasn't been completed/published yet. */
  status: "draft" | "pending" | "approved" | "rejected" | "paused" | "deleted";
  /** Venue-level Follow (Follow feature) — only present on the resident-
   * facing GET /:id response (centres.ts attaches it there, not inside the
   * shared getApprovedCentre query other callers — browse lists, the vendor
   * editor, admin — also use, so optional rather than assumed-present). */
  followerCount?: number;
  isFollowing?: boolean;
  followNotificationLevel?: "highlights" | "everything";
}

export interface RoomBlock {
  id: number;
  date: string;
  reason: string;
  createdAt: string;
  /** null/undefined = whole-centre block (every room); set = only that room. */
  roomId: string | null;
}

export interface Club {
  id: string;
  name: string;
  sport: string;
  area: string;
  county: string;
  ages: string;
  price: number;
  unit: string;
  trial: boolean;
  ph: string;
  image: string;
  images: string[];
  blurb: string;
  includes: string[];
  rating: number;
  reviews: number;
  /** "Would you do this again?" — null when nobody's answered yet. */
  wouldRepeatPercent: number | null;
  wouldRepeatCount: number;
  paymentMethod: PaymentMethod;
  mapUrl: string;
  claimed: boolean;
  vendorId: string | null;
  capacity: number | null;
  lat: number | null;
  lng: number | null;
  /** See Centre.locationSource — same provenance/approximation semantics. */
  locationSource: "confirmed" | "approximate" | "unknown";
  phone: string;
  accessibility: string[];
  category: string;
  /** Bounded "featured" flag (IA spec §16) — admin-toggled promotion. */
  featured: boolean;
  /** Slugs (master-prompt punch list #1) — null until backfilled/generated. */
  slug: string | null;
  /** Who this club registers — drives which shape RegistrationFlow.tsx
   * renders (guardian/DOB for 'kids', self-registration for 'adults', a
   * picker for 'all'). Defaults to 'kids' for every club that existed
   * before this field. */
  audience: "kids" | "adults" | "all";
  /** See Centre's identical field. */
  status: "draft" | "pending" | "approved" | "rejected" | "paused" | "deleted";
}

export type BookingStatus = "confirmed" | "cancelled";

export interface MyBooking {
  ref: string;
  date: string;
  time: string;
  totalCents: number;
  createdAt: string;
  centreName: string;
  roomName: string | null;
  ph: string;
  image: string;
  status: BookingStatus;
  vendorId: string;
}

// Resident Experience Polish — Changeset 5. PaymentSuccess.tsx's six
// GET .../status/:ref polling endpoints used to return only
// {ref, paymentStatus, totalCents} — enough to know payment succeeded, not
// enough to answer "what did I just book?" These are what each now returns
// once paid, enriched in place (no second fetch — the terminal poll
// response already has everything). Fields genuinely don't exist for some
// types (e.g. no date/time on a registration or program enrollment, which
// have no single dated occurrence) — left absent rather than fabricated.
export interface BookingConfirmation {
  ref: string;
  paymentStatus: string;
  totalCents: number;
  centreId: string;
  centreName: string;
  roomName: string | null;
  date: string;
  time: string;
  duration: number;
  guests: number;
}

export interface RegistrationConfirmation {
  ref: string;
  paymentStatus: string;
  totalCents: number;
  clubId: string;
  clubName: string;
  childFirst: string;
  childLast: string;
  team: string;
}

export interface GameJoinConfirmation {
  ref: string;
  paymentStatus: string;
  totalCents: number;
  gameId: string;
  activityLabel: string;
  date: string;
  time: string;
  centreName: string | null;
  locationText: string;
}

export interface ExperienceBookingConfirmation {
  ref: string;
  paymentStatus: string;
  totalCents: number;
  experienceId: string;
  title: string;
  meetingPoint: string;
  date: string;
  time: string;
  partySize: number;
}

export interface ProgramEnrollmentConfirmation {
  ref: string;
  paymentStatus: string;
  totalCents: number;
  programId: string;
  title: string;
  listingName: string | null;
}

export interface PassConfirmation {
  ref: string;
  paymentStatus: string;
  totalCents: number;
  clubId: string | null;
  clubName: string | null;
  creditsTotal: number;
}

/** Vendor's own view of a hall booking (VendorBookings.tsx) — a superset of
 * MyBooking's fields (guest identity + the operational detail a venue manager
 * needs, not just what the guest who made it needs to see). */
export interface VendorBookingRow extends MyBooking {
  name: string;
  email: string;
  phone: string;
  duration: number;
  eventType: string;
  guests: number;
  notes: string | null;
  paymentStatus: string;
  centreId: string;
  /** Whether this booking has a real Stripe charge to refund — false for a
   * cash booking, which was never charged online. */
  hasStripePayment: boolean;
}

export interface ClubParticipant {
  childFirst: string;
  childLast: string;
  teams: string[];
  registrations: number;
  active: boolean;
  lastRegisteredAt: string;
}

export interface MyRegistration {
  ref: string;
  team: string;
  childFirst: string;
  childLast: string;
  trial: number;
  totalCents: number;
  createdAt: string;
  clubId: string;
  clubName: string;
  sport: string;
  status: BookingStatus;
  vendorId: string;
  /** Only ever present on the vendor's own view (vendorOperations.ts's
   * GET /registrations) — not selected on the resident-facing MyRegistration
   * fetch. */
  paymentStatus?: string;
  hasStripePayment?: boolean;
}

export interface ParticipationEntry {
  kind: "booking" | "registration" | "program_enrollment" | "game" | "circle";
  ref: string;
  title: string;
  subtitle: string;
  date: string;
  status: string;
  href: string;
}

// My Life V2's "Needs You" (Phase 1 "Connect", extended Phase 2 "Circles
// V2" with the two plan_* action types) — matches
// server/src/routes/residents.ts's NeedsAttentionItem. Computed, not
// stored; ordered by the server into a deterministic priority already — the
// client renders in the order it arrives rather than re-sorting.
export interface NeedsAttentionItem {
  id: string;
  actionType: "payment_incomplete" | "waitlist_offered" | "join_request" | "circle_invitation" | "plan_activity_creation" | "plan_confirmation" | "open_poll";
  sourceType: "booking" | "registration" | "waitlist_entry" | "circle_invite" | "circle_plan" | "circle_poll";
  sourceId: string;
  title: string;
  description: string;
  dueAt: string | null;
  actionLabel: string;
  actionUrl: string;
  createdAt: string;
}

export interface MyProgramEnrollment {
  ref: string;
  programId: string;
  participantName: string;
  totalCents: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
  title: string;
  imageUrl: string;
  listingType: "centre" | "club";
  listingName: string;
  vendorId: string | null;
  /** Resident Experience Polish — the program's own real next occurrence
   * (program_sessions), never pe.createdAt. Both null when no future,
   * non-cancelled session exists — never fabricated. */
  nextSessionDate: string | null;
  nextSessionTime: string | null;
  /** True once at least one real, non-cancelled session has actually
   * happened — the "meaningful participation" gate for showing post-
   * activity feedback/reviews, same weight as isPast for a dated booking. */
  hasPastSession: boolean;
}

export interface VendorNotification {
  id: number;
  kind: "booking" | "registration" | "program" | "experience";
  title: string;
  body: string;
  listingType: "centre" | "club";
  listingId: string;
  ref: string;
  read: number;
  createdAt: string;
}

export type Role = "vendor" | "admin";

export type VendorType = "community" | "sports";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  status: "pending" | "approved" | "suspended";
  name: string;
  vendorType: VendorType | null;
  businessName: string;
  address: string;
  county: string;
  mobile: string;
  landline: string;
  description: string;
  orgId: string | null;
  platformRole: string | null;
  invitedStaff: boolean;
  providerTier: "standard" | "verified" | "featured";
  createdAt: string;
  /** Onboarding audit E1 — set by GET /auth/me; null = no Terms acceptance on file. */
  termsAcceptedAt?: string | null;
  /** HelloCircle Manage (Phase 1) — set once this vendor links the resident
   * (magic-link) account of the same person. Null for every vendor until
   * they deliberately do that (see api/manage.ts). */
  residentId: string | null;
}

export interface Review {
  id: number;
  /** Host & Activity reviews (master-prompt punch list #3) — kept separate
   * per listing_type, matching the different trust signal each represents.
   * "program" added in Resident Experience Polish; "experience" was already
   * reviewable server-side but missing from this type — added alongside. */
  listingType: "centre" | "club" | "game" | "host" | "experience" | "program";
  listingId: string;
  name: string;
  rating: number;
  comment: string;
  createdAt: string;
  /** Host Manage spec §16 — only ever set for centre/club reviews. */
  vendorReply: string | null;
  vendorRepliedAt: string | null;
}

export interface VendorListingSummary {
  id: string;
  name: string;
  status: "draft" | "pending" | "approved" | "rejected" | "paused" | "deleted";
  area: string;
  county: string;
  views: number;
  createdAt: string;
  bookingsCount: number;
  image: string;
  blurb: string;
  rating: number;
  reviews: number;
  /** Centres only. */
  capacity: number | null;
  /** Centres only, plain euros (not cents). */
  fromPrice: number | null;
  /** Clubs only. */
  ages: string | null;
  /** Clubs only, plain euros (not cents). */
  price: number | null;
  /** Clubs only. */
  unit: string | null;
}

export interface VendorStats {
  centresLive: number;
  clubsLive: number;
  totalBookings: number;
  totalViews: number;
}

export interface AdminStats {
  centresPending: number;
  clubsPending: number;
  vendorCount: number;
  totalListings: number;
  reviewCount: number;
  bookingsToday: number;
  paymentFailures: number;
  openReports: number;
}

// --- resident identity / household / favourites (MVP) ---------------------

export interface Resident {
  id: string;
  email: string;
  name: string;
  homeCounty: string;
  /** Optional precise point (mobile onboarding redesign) — set when the
   * resident searched/geocoded an address or used GPS, rather than just
   * picking a county from the chip list. Null for residents who never did
   * either; home_county remains authoritative for county-scoped queries. */
  homeLat: number | null;
  homeLng: number | null;
  createdAt: string;
  /** An /uploads/<uuid>.<ext> path (same multer pipeline listing photos use),
   * or null — Avatar (client/src/components/ui.tsx) falls back to initials. */
  avatarUrl: string | null;
}

export interface HouseholdMember {
  id: number;
  firstName: string;
  lastName: string;
  dob: string;
  notes: string;
  /** IA spec §13 — guardian consent on file for this household member. */
  guardianConsentGiven: boolean;
  createdAt: string;
}

export type FavouriteStatus = "interested" | "planning" | "joined";

export interface Favourite {
  listingType: "centre" | "club" | "game" | "program_session" | "club_session" | "experience" | "circle";
  listingId: string;
  status: FavouriteStatus;
  /** Best-effort listing display details — null if the listing was since removed. */
  name: string | null;
  imageUrl: string | null;
  subtitle: string | null;
  /** Resident Experience Polish — set only for program_session/club_session,
   * whose own id has no detail route: the parent program/club id to link
   * to instead. Undefined for every other listing type, or if the parent
   * listing was itself since removed. */
  parentId?: string;
  /** Resident Experience Polish — set only for circle, matching CircleRow's
   * own slug-preferred, id-fallback link convention. */
  slug?: string;
}

export interface ResidentNotification {
  id: number;
  kind: "booking" | "registration" | "program" | "experience" | "waitlist" | "game" | "intent_match" | "circle";
  title: string;
  body: string;
  /** Platform Pre-Launch Polish — Changeset 2. Widened to match the
   * server's actual NotifyResidentParams["listingType"] union
   * (notifications.ts) — 'vendor' and 'host' were missing here even though
   * the server has sent notifications carrying them since the Follow
   * feature shipped; the in-app notification list's own type didn't
   * represent that, on top of notificationLink.ts's separate route-map gap. */
  listingType: "centre" | "club" | "game" | "intent" | "circle" | "vendor" | "host" | "experience" | "program";
  listingId: string;
  ref: string;
  read: number;
  createdAt: string;
}

export interface WaitlistPosition {
  onWaitlist: boolean;
  position?: number;
  total?: number;
}

// --- Participation Intent (demand capture, participation-intent plan Phase 1) ---

export interface IntentCount {
  count: number;
  residentCount: number;
}

export interface MyIntent {
  id: string;
  activityLabel: string;
  county: string;
  preferredDate: string;
  preferredTimeWindow: string;
  notes: string | null;
  status: "active" | "matched" | "converted" | "expired" | "cancelled";
  createdAt: string;
}

// --- Join a Game (MVP) / paid games (NEXT) ---------------------------------

export interface Game {
  id: string;
  hostResidentId: string;
  /** "Host" trust tier (IA spec five-layer audit) — badge-only, never a
   * gate on creating a game. hostVerified is true only once an admin has
   * approved this resident's host application. */
  hostName: string;
  hostAvatarUrl: string | null;
  hostVerified: boolean;
  activityLabel: string;
  centreId: string | null;
  centreName: string | null;
  area: string | null;
  county: string | null;
  locationText: string;
  date: string;
  time: string;
  skillLevel: string;
  capacity: number;
  joined: number;
  spotsLeft: number;
  priceCents: number | null;
  visibility: string;
  status: string;
  createdAt: string;
  /** Set by the host at creation — signals the game welcomes someone
   * without an existing partner/group (implementation plan Phase 2). */
  soloFriendly: boolean;
  /** Open Booking (Phase 3) — set when this game exists because someone
   * opened spots on their own room booking. */
  bookingRef: string | null;
  /** Minimum Participation Booking (Phase 4) — total players needed
   * (including the host) before the game leaves 'pending_participants'
   * and becomes 'open'. Null means no threshold. */
  minParticipants: number | null;
  /** Only present on the single-game detail fetch, not the list. */
  joinedByMe?: boolean;
  waitlistedByMe?: boolean;
  /** Contextual familiarity (implementation plan Phase 8) — how many
   * currently-joined participants the signed-in resident has previously
   * shared a different game with. 0 for a signed-out visitor. */
  familiarCount?: number;
  /** Open game detail (IA spec §5) — display-only, never enforced server-side. */
  confirmationDeadline: string | null;
  /** Self-serve check-in + attendance confirmation (IA spec §11) — only
   * meaningful for the signed-in resident's own participation; both null
   * for a signed-out visitor or a game the resident hasn't joined. */
  checkedInAt?: string | null;
  attended?: boolean | null;
  /** Real photo when set (huge-data seed pass); null falls back to
   * GameCard's existing tinted placeholder — never a fabricated stock photo
   * per-activity, since there's no real per-game photography. */
  imageUrl: string | null;
  /** Game Detail redesign — optional plan content a host can fill in at
   * creation. Every field is nullable/empty-string when unset; the client
   * omits the section it feeds rather than showing a placeholder. */
  description: string | null;
  durationMinutes: number | null;
  equipmentNeeded: string | null;
  minAge: number | null;
  surfaceType: string | null;
  indoorOutdoor: string | null;
  cancellationPolicy: string | null;
  /** Only present on the single-game detail fetch, and only populated for
   * the host or a joined participant — see server routes/games.ts's GET /:id. */
  meetingInstructions?: string | null;
  /** Set only when this game was created as a specific Circle's plan
   * (HelloCircle Manage Phase 4's "Create plan" deep-link). */
  circleId: string | null;
  /** HelloCircle Manage Phase 5 — the circle's own name/slug, so
   * /manage/activities can show which rows are a Circle's Plan and link
   * back to it. Both null whenever circleId is null. */
  circleName: string | null;
  circleSlug: string | null;
  /** Universal Publishing, Lifecycle & Availability System — `lifecycle` is
   * the host's own last explicit publishing choice; `effectiveLifecycle`/
   * `effectiveAvailability`/`publicLifecycleLabel` are what a viewer sees
   * right now once any schedule + the existing status/date fields are
   * accounted for (server/src/lifecycle.ts + routes/games.ts's
   * getEffectiveGameLifecycle). The client renders off the effective
   * values, never re-deriving the policy itself. */
  lifecycle: "draft" | "coming_soon" | "active" | "paused" | "archived";
  publishAt: string | null;
  bookingOpenAt: string | null;
  bookingCloseAt: string | null;
  effectiveLifecycle: "draft" | "coming_soon" | "active" | "paused" | "completed" | "cancelled" | "archived";
  effectiveAvailability: "not_open" | "open" | "limited" | "full" | "waitlist" | "closed";
  publicLifecycleLabel: string;
}

/** "Who's going" preview (Game Detail redesign §13) — name only, never
 * email/phone/exact address. `total` lets the client render "+N" beyond
 * the preview list without fetching every participant. */
export interface GameParticipantSummary {
  participants: { residentId: string; name: string }[];
  total: number;
}

/** Host-only, uncapped participant view (HelloCircle Manage /manage/activities)
 * — distinct from GameParticipantSummary's public names-only preview. */
export interface ManageParticipant {
  residentId: string;
  name: string;
  status: string;
  paymentStatus: string;
  joinedAt: string;
  checkedInAt: string | null;
  attended: boolean | null;
}

/** Host-posted announcement for a game ("Latest update" module, §25). */
export interface GameUpdate {
  id: number;
  message: string;
  createdAt: string;
}

// --- Circles (NEXT) --------------------------------------------------------

export interface CircleSuggestion {
  activityLabel: string;
  familiarCount: number;
}

export interface Circle {
  id: string;
  name: string;
  activityLabel: string;
  area: string;
  county: string;
  about: string;
  centreId: string | null;
  members: number;
  createdAt: string;
  createdByResidentId: string;
  /** "Host" trust tier — same badge-only convention as Game above. */
  hostName: string;
  hostVerified: boolean;
  /** Close Circle (IA spec §10) — a closed circle drops out of public browse. */
  status: "active" | "closed";
  /** Slugs (master-prompt punch list #1) — null until backfilled/generated. */
  slug: string | null;
  /** Real photo when set (huge-data seed pass) — null falls back to a
   * tinted placeholder, same convention as Game.imageUrl above. For a
   * non-open (approval/invite) Circle, this is ALWAYS null regardless of
   * whether a cover is actually set — the raw permanent R2/custom-domain
   * URL is never exposed via the API response for a restricted Circle
   * (Media plan Task 2). Check `hasImage` for whether one exists, and
   * build the protected delivery URL (`/api/media/circles/:id/cover`)
   * client-side — see client/src/media.ts's getCircleCoverUrl(). */
  imageUrl: string | null;
  /** Whether this Circle has a cover image set at all, independent of
   * whether `imageUrl` above is populated (it's null for any non-open
   * Circle even when a cover exists). */
  hasImage?: boolean;
  /** Circle discovery redesign — the soonest upcoming activity for this
   * Circle. Circle Experience Polish — Changeset 2A: nextPlanFor() now
   * prefers a real games.circle_id-owned game first (source: 'circle'),
   * only falling back to an activity-label match (source: 'nearby') when
   * the Circle has no real upcoming activity of its own. Null when
   * nothing's currently scheduled either way; the client never fakes one. */
  nextPlan: { id: string; date: string; time: string; joined: number; capacity: number; spotsLeft: number; source: "circle" | "nearby" } | null;
  /** Loose calendar-month count of open games matching this activity —
   * a participation-health signal, not a stored/cached counter. */
  plansThisMonth: number;
  /** Phase 2 "Circles V2" — this Circle's own most-recent not-yet-converted
   * plan-idea, found via an explicit circle_plans.circle_id relationship
   * (never the fuzzy activity-label match nextPlan above uses). Null when
   * nothing's currently being planned. */
  activePlan: { id: string; title: string; status: "idea" | "confirmed"; proposedDate: string | null; proposedTime: string | null } | null;
  /** Join modes (Follow/Notify/Stats gap audit §6) — 'open' is the original
   * instant-join behaviour every pre-existing Circle keeps by default. */
  joinMode: "open" | "approval" | "invite";
  /** Only present on the single-circle detail fetch (see routes/circles.ts's
   * detailStatsFor) — too expensive to compute per row on the browse list. */
  participantsThisMonth?: number;
  repeatParticipants?: number;
  newMembersThisMonth?: number;
  /** Real show-up rate — % of confirmed (not just joined) participation
   * across games matching this activity that were actually attended. Null
   * when nobody's confirmed attendance yet (not enough signal to show a
   * rate) rather than defaulting to a fabricated number. */
  showUpRate?: number | null;
  /** "X people you've played with before are members" — only present when
   * a signed-in resident requested this circle; 0 for a signed-out visitor. */
  familiarMembers?: number;
  /** Structured "About our community" content (Circle Detail redesign) —
   * each genuinely optional/organiser-provided; null renders no column. */
  whatWeDo: string | null;
  whoCanJoin: string | null;
  values: string | null;
  /** My Life redesign — the viewer's own role in this circle. Only present
   * on GET /circles/mine; role is relative to whoever's asking, not a
   * property of the circle itself, so every other fetch omits it. */
  myRole?: "member" | "organiser";
  /** Circle Experience Polish — Changeset 1B. True when GET /:id returned
   * the reduced non-member teaser shape (an 'approval'/'invite' Circle the
   * viewer isn't a member of) instead of the full object above — every
   * other field on a restricted response still conforms to this interface,
   * just with honest empty/neutral values rather than real content. */
  restricted?: boolean;
  /** Only meaningful on a restricted response — true when the viewer has an
   * outstanding organiser-sent invite they can still accept. */
  hasPendingInvite?: boolean;
  /** Only meaningful on a restricted response for an 'approval' Circle —
   * true when the viewer already has a pending join request in. */
  requested?: boolean;
}

/** A real photo from a recent game matching this Circle's activity (§18) —
 * not an uploaded gallery, see routes/circles.ts's GET /:id/moments. */
export interface CircleMoment {
  id: string;
  imageUrl: string;
}

/** Circle members preview (Circle discovery/detail redesign) — name only,
 * never email/phone/exact address, same privacy stance as
 * GameParticipantSummary. `total` lets the client render "+N". */
export interface CircleMemberSummary {
  members: { residentId: string; name: string; role: string }[];
  total: number;
}

/** Upcoming-plan preview for a Circle (Circle Detail redesign §10/§11) —
 * enough for CirclePlanCard without a full Game fetch per plan. */
export interface CirclePlanPreview {
  id: string;
  activityLabel: string;
  date: string;
  time: string;
  locationText: string;
  centreName: string | null;
  capacity: number;
  joined: number;
  spotsLeft: number;
  priceCents: number | null;
  /** Circle Experience Polish — Changeset 2A. 'circle' = a real
   * games.circle_id-owned activity; 'nearby' = a platform-wide
   * activity-label match with no real relationship to this Circle. Never
   * presented as the same thing — see CircleDetail.tsx's "From this
   * Circle"/"You might also like" split. */
  source: "circle" | "nearby";
}

/** Organiser-only, real plans linked via games.circle_id (HelloCircle Manage
 * Phase 4) — distinct from CirclePlanPreview's public activity-label match. */
export interface ManageCirclePlan {
  id: string;
  activityLabel: string;
  date: string;
  time: string;
  status: string;
  capacity: number;
  centreName: string | null;
  joined: number;
}

/** Organiser-only, uncapped member view (HelloCircle Manage Phase 4) —
 * distinct from CircleMemberSummary's public names-only preview, same
 * reasoning as ManageParticipant vs. GameParticipantSummary. */
export interface ManageCircleMember {
  residentId: string;
  name: string;
  role: string;
}

/** "Recently in this Circle" row (§20) — a completed game with a real
 * confirmed-attendance count. Circle Experience Polish — Changeset 2C:
 * `source` distinguishes a real games.circle_id-owned completion from a
 * platform-wide activity-label fallback, same convention as
 * CirclePlanPreview above. */
export interface CircleRecentActivity {
  id: string;
  activityLabel: string;
  date: string;
  attended: number;
  source: "circle" | "nearby";
}

/** "Circle activity" card (§26-28) — real, period-scoped participation
 * signals (see routes/circles.ts's GET /:id/activity). Deliberately no
 * "photos shared" field — nothing in this app tracks that. */
export interface CircleActivityStats {
  period: "week" | "month";
  newMembers: number;
  plansCreated: number;
  participants: number;
}

// --- Circle invitations & planning polls (IA spec §10) ---------------------

export interface CircleInvitation {
  id: string;
  circleId: string;
  circleName: string;
  activityLabel: string;
  invitedByName: string;
  createdAt: string;
}

export interface CirclePollOption {
  id: number;
  date: string;
  time: string;
  voteCount: number;
  votedByMe: boolean;
}

export interface CirclePoll {
  id: string;
  question: string;
  createdByResidentId: string;
  status: "open" | "closed";
  /** Phase 2 "Circles V2" — set when this poll was created attached to a
   * plan-idea ("which day works for {planTitle}?"); null for a standalone
   * poll, which keeps working exactly as before. */
  planId: string | null;
  createdAt: string;
  options: CirclePollOption[];
}

// --- Circle plan-ideas (Phase 2 "Circles V2") -------------------------------
// Named "plan-ideas" (not "plans") to avoid colliding with the pre-existing
// ManageCirclePlan concept above (real games.circle_id rows) — see the
// Phase 2 plan doc's naming-collision note. A CirclePlanIdea is the new,
// explicit "what should this Circle do next" object: a member proposes one,
// an organiser can confirm it and then convert it into a real Game (at
// which point `activity` below becomes the source of truth for date/time/
// status — this object never re-syncs a stale copy after that).
export interface CirclePlanIdea {
  id: string;
  circleId: string;
  createdByResidentId: string;
  createdByName: string;
  title: string;
  note: string;
  /** 'completed' is derived (the linked activity's date has passed), never
   * a stored transition. */
  status: "idea" | "confirmed" | "activity_created" | "completed" | "cancelled";
  proposedDate: string | null;
  proposedTime: string | null;
  locationText: string | null;
  activitySourceType: "game" | null;
  activitySourceId: string | null;
  /** Populated once activitySourceId is set — the live Game's own state,
   * always read fresh, never cached on this object. */
  activity: { id: string; date: string; time: string; status: string; spotsLeft: number | null; joined: number | null } | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
}

export type HostStatus = "none" | "pending" | "verified" | "rejected";

// --- Saved-search alerts (master-prompt punch list #5) ---------------------

export type SearchAlertMood = "active" | "chill" | "social" | "creative" | "learn";

export interface SearchAlert {
  id: string;
  county: string;
  keywords: string | null;
  mood: SearchAlertMood | null;
  active: number;
  createdAt: string;
}

// --- Provider / Host public profiles (IA spec §5) --------------------------

export interface ProviderProfileListing {
  id: string;
  name: string;
  area: string;
  county: string;
  image: string;
  blurb: string;
  /** Slugs (master-prompt punch list #1) — null until backfilled/generated. */
  slug: string | null;
}

export interface ProviderUpcomingItem {
  kind: "experience" | "program_session" | "club_session";
  id: string;
  title: string;
  date: string;
  time: string;
  href: string;
  imageUrl: string | null;
  priceCents: number | null;
  capacity: number | null;
  spotsLeft: number | null;
}

export interface ProviderReviewsSummary {
  average: number | null;
  count: number;
  recent: { name: string; rating: number; comment: string; listingType: string; listingId: string; listingName: string | null; createdAt: string }[];
}

export interface SimilarProvider {
  id: string;
  name: string;
  area: string | null;
  image: string | null;
  listingCount: number;
  type: "place" | "experience" | "open-plan";
}

export interface ProviderAmenities {
  items: string[];
  accessibility: string | null;
}

export interface ProviderProfile {
  id: string;
  name: string;
  description: string;
  verified: boolean;
  providerTier: string;
  county: string;
  logo: string | null;
  /** Host Manage spec §25/§26 — previously no field/editor existed for
   * either. */
  website: string | null;
  socials: { instagram?: string; facebook?: string; x?: string } | null;
  centres: ProviderProfileListing[];
  clubs: (ProviderProfileListing & { sport: string })[];
  experiences: (ProviderProfileListing & { kind: "adventure" | "experience"; title: string })[];
  policies: { cancellationHours: number; bookingWindowDays: number };
  upcoming: ProviderUpcomingItem[];
  trust: { totalListings: number; participantCount: number; wentAheadPercent: number | null };
  amenities: ProviderAmenities;
  mapLocation: { lat: number; lng: number; label: string } | null;
  reviewsSummary: ProviderReviewsSummary;
  similar: SimilarProvider[];
  followerCount: number;
  isFollowing: boolean;
  followNotificationLevel: "highlights" | "everything";
}

// --- Routines-as-an-object (IA spec §9) -------------------------------------
// A personal planning aid, never an automatic booking. dayOfWeek follows
// MySQL's DAYOFWEEK() convention: 1=Sunday..7=Saturday.

export interface Routine {
  id: string;
  activityLabel: string;
  centreId: string | null;
  centreName: string | null;
  dayOfWeek: number;
  time: string;
  status: "active" | "paused" | "cancelled";
  createdAt: string;
}

export interface RoutineSuggestion {
  activityLabel: string;
  dayOfWeek: number;
  time: string;
  centreId: string | null;
  sessionCount: number;
}

export interface HostProfile {
  id: string;
  name: string;
  bio: string;
  avatarUrl: string | null;
  upcomingGames: { id: string; activityLabel: string; date: string; time: string }[];
  circles: { id: string; name: string; activityLabel: string; slug: string | null }[];
  gamesHostedTotal: number;
  /** Host reviews (master-prompt punch list #3). */
  rating: number;
  reviews: number;
  followerCount: number;
  isFollowing: boolean;
  followNotificationLevel: "highlights" | "everything";
}

// --- Participation Chat (implementation plan Phase 11) ----------------------

export type ChatScopeType = "game" | "circle";

export interface ChatMessage {
  id: number;
  residentId: string;
  residentName: string;
  body: string;
  createdAt: string;
}

export interface ChatFeed {
  messages: ChatMessage[];
  canPost: boolean;
  postBlockedReason?: string;
  opensAt?: string;
  archivesAt?: string;
}

// --- recurring club sessions (NEXT) -----------------------------------------

export interface ClubSession {
  id: string;
  clubId: string;
  dayOfWeek: number;
  time: string;
  capacity: number | null;
  label: string;
  active: boolean;
  instructorName: string;
  /** Resolved for display — the session's own photo if one was uploaded,
   * otherwise the parent club's cover (Image Upload Coverage spec §"Club
   * Sessions": "Without an override, inherit the Club cover"). Null only
   * when the club itself has no cover either. */
  imageUrl: string | null;
  /** True only when this session has its own uploaded photo (distinct from
   * imageUrl being non-null, which is also true when inheriting the club's
   * cover) — lets the editor UI show "Uses the club photo" vs "Custom
   * photo" and know whether Remove has anything of its own to clear. */
  hasCustomImage: boolean;
}

// --- passes (NEXT) ----------------------------------------------------------

export interface Pass {
  id: number;
  listingType: "club";
  listingId: string;
  listingName: string;
  creditsTotal: number;
  creditsUsed: number;
  purchasedCents: number;
  expiresAt: string | null;
}

// --- search (FUTURE, best-effort) -------------------------------------------

export interface SearchParsed {
  raw: string;
  county: string | null;
  free: boolean;
  keywords: string[];
  maxPriceEuro: number | null;
  timeOfDay: "morning" | "afternoon" | "evening" | null;
}

export interface ExperienceSearchResult {
  id: string;
  kind: ExperienceKind;
  title: string;
  area: string;
  county: string;
  blurb: string;
  priceCents: number;
  imageUrl: string;
}

export interface SearchResult {
  parsed: SearchParsed | null;
  centres: Centre[];
  clubs: Club[];
  /** Games/program sessions/club sessions matching the query (Phase 6) —
   * same shape as the homepage discovery feed's DiscoverItem below. */
  activities: DiscoverItem[];
  /** Filtered the same simple way centres/clubs are, not ranked alongside
   * activities — see server/src/routes/search.ts's comment. */
  experiences: ExperienceSearchResult[];
}

// --- homepage discovery feeds (Phase 5) ---------------------------------

export interface DiscoverItem {
  kind: "game" | "program_session" | "club_session";
  id: string;
  title: string;
  date: string;
  time: string;
  centreName: string | null;
  clubName: string | null;
  area: string | null;
  county: string | null;
  priceCents: number | null;
  href: string;
  /** Games only — lets the card offer an inline "Join" instead of only a
   * link through to the detail page. null for program/club sessions. */
  spotsLeft: number | null;
  /** Games only, and only real data — how many residents have joined.
   * Deliberately not populated for program/club sessions, neither of which
   * tracks a real per-session attendee count. */
  joined: number | null;
  /** Only program sessions can have a real photo (via the parent Program).
   * null means the card falls back to a kind-tinted placeholder. */
  imageUrl: string | null;
  /** Best-effort "happening right now" — see server/src/routes/discover.ts. */
  isLive: boolean;
  /** Real for program sessions; a documented assumption for games/club
   * sessions (implementation plan Phase 9's Free Time Mode duration filter). */
  durationMinutes: number;
  /** From the hosting centre/club — null if it has no coordinates set. */
  lat: number | null;
  lng: number | null;
  /** "Why this fits" (implementation plan Phase 12) — empty for a signed-
   * out visitor, or when nothing about this item matched the resident's
   * own signals (interests/home county/familiar co-players). */
  matchReasons: string[];
}

// Phase 1 "Connect" — a normalized presentation contract spanning Games,
// Program sessions, Club sessions, and Experience sessions, matching
// server/src/activitySummary.ts's ActivitySummary shape. Hand-synced with
// the server's own definition, same convention as every other type in this
// file (see CLAUDE.md: "no shared/generated types package between client
// and server"). Not a database table, not a replacement for Game/Centre/
// Club/Experience — every transactional action still routes through its
// own source page/flow; this only unifies what a shared card can render.
// The 5 new fields are optional, not just nullable, so an existing
// DiscoverItem (today/weekend feeds, search results) already satisfies
// this type without every call site needing to start setting them.
export interface ActivitySummary extends Omit<DiscoverItem, "kind" | "matchReasons"> {
  kind: DiscoverItem["kind"] | "experience_session";
  matchReasons?: string[];
  /** Same value as href today — exposed under a name a future sharing
   * feature can use without callers needing to know that. */
  canonicalUrl?: string;
  /** The resident host's display name — Games only; null for every
   * vendor-run source. */
  host?: string | null;
  /** Whichever organiser applies (Resident host or Vendor) is trust-
   * verified. Null where the source doesn't cheaply carry this yet. */
  hostVerified?: boolean | null;
  /** The vendor's own display name, where resolved — null otherwise. */
  vendorName?: string | null;
  /** A linked Circle's id, where one exists — always null today (Circle
   * Plans is a later phase); field exists now so that phase doesn't need
   * another type change to add it. */
  circleId?: string | null;
}

export interface DiscoverFeed {
  today: DiscoverItem[];
  weekend: DiscoverItem[];
}

// --- Map discovery (Maps & Geographic Discovery, Phase E) -------------------
// Minimal marker payload for the bounds-scoped GET /api/discover/map — see
// server/src/db/queries.ts's listMapMarkers for the query side.

export type MapMarkerType = "centre" | "club" | "experience";

export type MapMarker =
  | { id: string; type: "centre"; lat: number; lng: number; title: string; area: string; county: string; image: string | null; href: string; from: number; locationSource: string }
  | { id: string; type: "club"; lat: number; lng: number; title: string; area: string; county: string; image: string | null; href: string; price: number; unit: string; locationSource: string }
  | { id: string; type: "experience"; lat: number; lng: number; title: string; area: string; county: string; image: string | null; href: string; priceCents: number; locationSource: string };

// --- Local Momentum (implementation plan Phase 7) --------------------------

export interface LocalMomentumSignal {
  label: string;
  county: string;
  recentSpots: number;
  priorSpots: number;
  growth: number;
}

// --- demand intelligence (NEXT) ---------------------------------------------

export interface WaitlistEntry {
  id: number;
  name: string;
  email: string;
  status: "waiting" | "offered";
  createdAt: string;
  offerExpiresAt: string | null;
}

export interface DemandRow {
  queryText: string;
  county: string;
  count: number;
  /** Same row, just the last 7 days — a lightweight trend signal. */
  recentCount: number;
  lastSeenAt: string;
}

/** An explicit unmet-demand cluster from participation_intents — unlike
 * DemandRow above, these are resident-linkable and actionable (admin can
 * notify the people behind one). See db/queries.ts's getIntentClusters. */
export interface IntentCluster {
  activityLabel: string;
  county: string;
  count: number;
  residentCount: number;
  sampleNames: string[];
  latestAt: string;
}

// --- Marketplace health / liquidity (admin-only) -----------------------

export interface SupplyOverview {
  upcomingGames: number;
  openSpots: number;
  activeCircles: number;
  activeHosts: number;
}

export interface ParticipationStats {
  joined: number;
  attended: number;
  noShow: number;
  totalResidents: number;
  repeatResidents: number;
  repeatRate: number;
}

export type LiquidityLabel = "LOW" | "DEVELOPING" | "HEALTHY" | "HIGH";

export interface LiquidityScore {
  activityLabel: string;
  county: string;
  demandCount: number;
  matchRate: number;
  openSpots: number;
  upcomingPlans: number;
  label: LiquidityLabel;
}

export interface MarketplaceHealth {
  supply: SupplyOverview;
  participation: ParticipationStats;
  liquidity: LiquidityScore[];
}

// --- Referral attribution (admin-only, best-effort) ---------------------

export interface ReferralAttributionRow {
  referrerClientId: string;
  source: string;
  landedAt: string;
  visitorClientId: string;
  converted: boolean;
  convertedKind: "booking" | "registration" | "game" | null;
}

// --- Minimal analytics funnel rollup (post-audit hardening pass) ---------

export interface AnalyticsFunnelRow {
  eventType: string;
  count: number;
}

// --- Market/category launch config -------------------------------------

/** Same values as INTEREST_OPTIONS below — kept as its own type alias since
 * this is specifically what market-category config keys/reads by. */
export type MarketCategoryFlags = Record<string, boolean>;

// --- multi-tenant / RBAC / marketplace scaffolding (FUTURE, best-effort) ---

export interface AdminOrganisation {
  id: string;
  name: string;
  kind: string;
  createdAt: string;
}

// --- resident onboarding / preferences (Phase A) ----------------------

export interface ResidentFull extends Resident {
  interests: string[];
  availability: string[];
  onboardingCompleted: boolean;
  /** Onboarding audit E1/E2 — when (and under which Terms version) this account accepted the Terms. Null = nothing on file (never fabricated for older accounts); termsVersion is also null for acceptances recorded before versions existed. */
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  notificationPrefs: NotificationPrefs | null;
  accessibilityPrefs: string[];
  searchRadiusKm: number;
  /** "Host" trust tier (IA spec five-layer audit) — badge-only. */
  hostStatus: HostStatus;
  hostBio: string;
  hostPhone: string;
  /** Onboarding §2 (IA spec) — goals + participation comfort. Empty string
   * on the pref fields means no preference stated, not unset. */
  goals: string[];
  prefGroupSize: string;
  prefBeginnerFriendly: boolean;
  prefSoloFriendly: boolean;
  prefBudget: string;
  /** Safety Centre (IA spec §13) — opt out of other people's "familiar
   * participants" counts. */
  hideFromFamiliarCount: boolean;
  /** Circle invite picker (implementation backlog #3) — opt IN to being
   * findable by GET /residents/search. Off by default. */
  discoverableByName: boolean;
  /** Optional password login (My Life redesign) — true once this resident
   * has set a password via signup or Profile's "set/change password",
   * whether or not their account also has magic-link history. Never the
   * password/hash itself, just whether one exists. */
  hasPassword: boolean;
  /** Set once, on the first magic-link verify ever (routes/guestAuth.ts's
   * POST /verify) — proof this email's inbox was actually opened. Password-
   * only signup never sets it, since it never requires that. */
  emailVerified: boolean;
}

/** Circle invite picker (implementation backlog #3) — deliberately name-
 * only, never email/phone (same "no PII beyond a name" convention as
 * HostProfile/ProviderProfile). */
export interface ResidentSearchResult {
  id: string;
  name: string;
}

/** Payment-methods screen (implementation backlog #1). Never carries a full
 * card number — Stripe itself never returns one via the API. */
export interface SavedPaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** Notification templates (implementation backlog #2) — an override layer,
 * not the source of truth; a null *Template field means "using the
 * hardcoded fallback," not "empty." */
export interface NotificationTemplateInfo {
  key: string;
  description: string;
  fields: readonly ("subject" | "title" | "body")[];
  vars: readonly string[];
  subjectTemplate: string | null;
  titleTemplate: string | null;
  bodyTemplate: string | null;
  updatedAt: string | null;
}

// --- Safety Centre (IA spec §13) -------------------------------------

export interface BlockedResident {
  id: string;
  name: string;
  createdAt: string;
}

export interface ReportRecord {
  id: number;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: string;
}

// --- Community-contributed places (master-prompt punch list #4) -----------

export interface PlaceSuggestion {
  id: string;
  suggestedName: string;
  category: "centre" | "club";
  area: string;
  county: string;
  description?: string;
  contactInfo?: string;
  status: "pending" | "approved" | "rejected";
  publishedListingId: string | null;
  createdAt: string;
}

export interface NotificationPrefs {
  bookingConfirmations: boolean;
  bookingReminders: boolean;
  waitlistOffers: boolean;
  recommendations: boolean;
  circleAnnouncements: boolean;
  /** IA spec §12 — the 4 categories the spec names that this app didn't
   * have a preference field for yet. Same signal-only convention as the
   * 3 above that aren't wired to real gating logic either (only
   * waitlistOffers currently gates a real send — see notifications.ts's
   * PREF_KEY_BY_KIND) — stored and respected where it's already wired,
   * ready for the rest as those notification types get built out. */
  activityReminders: boolean;
  openSpots: boolean;
  routineReminders: boolean;
  marketing: boolean;
  /** Gates "intent_match" notifications (see notifications.ts's
   * PREF_KEY_BY_KIND) — unlike most other categories here, this one is
   * triggered by a stranger's action (someone else's game creation, or
   * enough other residents wanting the same thing), not something the
   * resident themself just did, so it gets a real opt-out from day one. */
  intentMatches: boolean;
}

export const ACCESSIBILITY_OPTIONS = ["Wheelchair access", "Step-free access", "Accessible changing", "Accessible parking", "Hearing loop", "Sensory-friendly"];

export const INTEREST_OPTIONS = ["Badminton", "Football", "Swimming", "Fitness", "Yoga", "Walking", "Kids activities", "Arts", "Learning", "Community events", "Outdoor", "Wellbeing"];

export const AVAILABILITY_OPTIONS = ["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Saturday", "Sunday"];

export const GOAL_OPTIONS = ["Become more active", "Meet new people", "Find a hobby", "Get outdoors", "Try something new", "Do more with family", "Build a routine", "Explore my area"];

export const GROUP_SIZE_OPTIONS = [
  { key: "solo", label: "Just me" },
  { key: "small", label: "Small group" },
  { key: "large", label: "Larger group" },
  { key: "any", label: "No preference" },
];

export const BUDGET_OPTIONS = [
  { key: "free", label: "Free only" },
  { key: "low", label: "€" },
  { key: "medium", label: "€€" },
  { key: "any", label: "No preference" },
];

export interface Receipt {
  ref: string;
  kind: "booking" | "registration" | "game" | "pass" | "program_enrollment";
  label: string;
  totalCents: number;
  createdAt: string;
  paymentStatus: string;
  /** Only populated for kind "booking" — the booked slot + venue, for a
   * richer Booking Detail screen (directions/cancel). Null for every other
   * kind, which has its own live detail screen instead. */
  date: string | null;
  time: string | null;
  centreId: string | null;
}

export interface WaitlistOfferStatus {
  onWaitlist: boolean;
  offered?: boolean;
  offerExpiresAt?: string | null;
  position?: number;
  total?: number;
}

// --- Programs / Sessions (Phase B) -----------------------------------

export interface ProgramSession {
  id: string;
  date: string;
  time: string;
  durationMinutes: number;
  capacity: number | null;
  status: string;
  instructorName: string;
  roomId: string | null;
  roomName: string | null;
}

export type ProgramStatus = "draft" | "published" | "paused" | "archived";

export type AttendanceStatus = "present" | "absent" | "late" | "cancelled" | "no_show";

export interface SessionAttendanceEntry {
  enrollmentId: string;
  status: AttendanceStatus;
}

export interface Program {
  id: string;
  listingType: "centre" | "club";
  listingId: string;
  listingName: string;
  title: string;
  description: string;
  ageRange: string;
  imageUrl: string;
  priceCents: number;
  capacity: number | null;
  enrolled: number;
  spotsLeft: number | null;
  status: ProgramStatus;
  sessions: ProgramSession[];
  createdAt: string;
  category: string;
  skillLevel: string;
  equipment: string[];
  instructorName: string;
  /** Community program detail (IA spec §5) — both optional. */
  guardianRules: string;
  safeguardingInfo: string;
}

export interface VendorProgramSummary {
  id: string;
  listingType: "centre" | "club";
  listingId: string;
  title: string;
  status: string;
  priceCents: number;
  capacity: number | null;
  createdAt: string;
}

// --- Adventures & Experiences ------------------------------------------
// A standalone third listing type alongside centres/clubs (not nested under
// either) — see server/src/db/index.ts's experiences/experience_sessions/
// experience_bookings comments. Booked per-session (a single departure),
// not a multi-session enrollment the way a Program is.

export type ExperienceKind = "adventure" | "experience";

export interface ExperienceSessionSlot {
  id: string;
  date: string;
  time: string;
  capacity: number;
  spotsLeft: number;
}

export interface Experience {
  id: string;
  kind: ExperienceKind;
  title: string;
  area: string;
  county: string;
  lat: number | null;
  lng: number | null;
  /** See Centre.locationSource — same provenance semantics, except an
   * Experience has no county-centroid fallback, so this is only ever
   * 'confirmed' or 'unknown' (never 'approximate') in practice. */
  locationSource: "confirmed" | "approximate" | "unknown";
  meetingPoint: string;
  blurb: string;
  description: string;
  difficulty: string;
  durationMinutes: number;
  fitnessRequirements: string;
  itinerary: string;
  equipmentProvided: string;
  equipmentRequired: string;
  transportInfo: string;
  safetyInfo: string;
  weatherPolicy: string;
  eligibility: string;
  cancellationTerms: string;
  priceCents: number;
  capacity: number;
  paymentMethod: "online" | "cash";
  imageUrl: string;
  images: string[];
  sessions: ExperienceSessionSlot[];
  /** Bounded "featured" flag (IA spec §16) — admin-toggled promotion. */
  featured: boolean;
  /** Slugs (master-prompt punch list #1) — null until backfilled/generated. */
  slug: string | null;
  createdAt: string;
  /** Adventure-relevant, optional — null unless the vendor set them. Not
   * shown for "experience" kind (a pottery class has no meaningful distance). */
  distanceKm: number | null;
  elevationGainM: number | null;
  terrainType: string;
  /** Vendor identity ("Hosted by") — businessName-or-name, and a verified
   * flag derived from provider_tier, same as ProviderProfile's own. */
  vendorId: string;
  vendorName: string;
  vendorVerified: boolean;
  /** See Centre's identical field. Only present on the vendor's own fetch
   * (GET /vendor/experiences/:id) — the public fetch only ever returns
   * 'approved' rows anyway, so this is never a meaningful discriminator there. */
  status?: "draft" | "pending" | "approved" | "rejected" | "deleted";
}

export interface VendorExperienceSummary {
  id: string;
  kind: ExperienceKind;
  title: string;
  status: string;
  area: string;
  county: string;
  priceCents: number;
  capacity: number;
  views: number;
  createdAt: string;
  imageUrl: string;
}

export interface ExperienceSessionRow {
  id: string;
  date: string;
  time: string;
  capacity: number | null;
  status: string;
}

export interface MyExperienceBooking {
  ref: string;
  experienceId: string;
  participantName: string;
  partySize: number;
  totalCents: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
  title: string;
  imageUrl: string;
  kind: ExperienceKind;
  vendorId: string | null;
  date: string;
  time: string;
}

export interface VendorExperienceBooking {
  id: number;
  ref: string;
  participantName: string;
  email: string;
  phone: string;
  partySize: number;
  totalCents: number;
  status: string;
  createdAt: string;
  date: string;
  time: string;
}

export interface ScheduleEntry {
  id: string;
  date: string;
  time: string;
  durationMinutes: number;
  capacity: number | null;
  title: string;
  programId: string;
  enrolled: number;
}

export interface VendorToday {
  bookings: { ref: string; time: string; duration: number; guests: number; name: string; centreName: string }[];
  clubSessions: { id: string; time: string; label: string; capacity: number | null; instructorName: string; clubName: string }[];
}

export interface CentreHoursRow {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  closed: boolean;
}

// --- Organisation / Staff / RBAC (Phase C) -----------------------------

export interface OrgProfile {
  org: { id: string; name: string; kind: string } | null;
  policies: { cancellationHours: number; bookingWindowDays: number; refundPolicyText: string | null; taxNumber: string | null; businessRegistrationNumber: string | null };
  staff: { id: string; name: string; email: string; platformRole: string | null; status: string }[];
  pendingInvites: { token: string; email: string; platformRole: string; createdAt: string }[];
  locations: { id: string; name: string; type: "centre" | "club" }[];
  isOwner: boolean;
  flags: FeatureFlags;
  /** The org owner's own uploaded business logo — shown on the public
   * provider profile hero. null until they upload one. */
  logo: string | null;
  /** Host Manage spec §26 — previously had no edit route anywhere despite
   * being shown publicly. */
  description: string | null;
  website: string | null;
  socials: { instagram?: string; facebook?: string; x?: string };
}

/** Feature flags (implementation backlog #5) — real per-org capability
 * toggles, admin-controlled. Read-only for a vendor (routes/org.ts's GET);
 * admin toggles them in AdminDashboard.tsx's Organisations tab. */
export const FEATURE_FLAG_KEYS = ["open_booking", "programs", "experiences"] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];
export type FeatureFlags = Record<FeatureFlagKey, boolean>;
export const FEATURE_FLAG_LABELS: Record<FeatureFlagKey, string> = {
  open_booking: "Open Booking",
  programs: "Programs",
  experiences: "Adventures & Experiences",
};

export const PLATFORM_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"] as const;

/** Host Manage spec §27/§28 — display labels only, keeping the 5 real
 * `platform_role` values (and every requirePlatformRole/assertPlatformRole
 * check across the app) completely unchanged. Remapping the values
 * themselves would be a real RBAC/authorization change, not a copy fix —
 * see the plan doc's own note on why that's out of scope here. */
export const PLATFORM_ROLE_LABELS: Record<(typeof PLATFORM_ROLES)[number], string> = {
  centre_manager: "Bookings & Venue",
  facility_manager: "Clubs & Registrations",
  finance: "Finance",
  communications: "Communications",
  read_only_analyst: "Read-only Analyst",
};

export interface Participant {
  name: string;
  email: string;
  phone: string;
  kind: "booking" | "registration";
  listingName: string;
  lastActivity: string;
}

export interface VendorInsights {
  totals: {
    totalBookings: number;
    cancelledBookings: number;
    totalRegistrations: number;
    cancelledRegistrations: number;
    uniqueBookers: number;
  };
  utilisation: { dayOfWeek: number; hour: string; n: number }[];
  /** Host Manage spec §15 — a real sentence computed from `utilisation`
   * above, null when there isn't enough data yet for a meaningful one. */
  narrative: string | null;
  trend: { thisMonth: number; lastMonth: number; deltaPercent: number | null };
}

/** Vendor Experience Polish — one normalized row per bookable
 * occurrence across all four Vendor-ownable listing types (Centre
 * bookings, Club sessions, Program sessions, Experience sessions), shared
 * by the Overview "Next Up" section and the unified Schedule tab. Fields a
 * given `sourceType` genuinely has no data for stay `null` rather than
 * being approximated — see `GET /vendor/schedule-items`'s own comment for
 * exactly which fields are null for which source. */
export interface VendorScheduleItem {
  id: string;
  sourceType: "centre" | "club" | "program" | "experience";
  sourceId: string;
  listingId: string;
  listingName: string;
  spaceName: string | null;
  title: string;
  startDateTime: string;
  endDateTime: string | null;
  status: string;
  participantCount: number | null;
  bookingCount: number | null;
  location: string | null;
}

export interface VendorPayments {
  transactions: { ref: string; kind: "booking" | "registration" | "program" | "experience"; listingName: string; totalCents: number; createdAt: string; paymentStatus: string }[];
  /** A true SUM across ALL paid rows for every Vendor-ownable listing type
   * (Centre bookings, Club registrations, Program enrollments, Experience
   * bookings) — not derived from `transactions` above, which is capped at
   * 150 rows for display. See vendorInsights.ts's `/payments` route comment. */
  totalPaidCents: number;
}

/** Host Experience Polish — the Host-side mirror of VendorInsights above,
 * same "decisions, not decorative charts" convention. `repeatParticipantPercent`/
 * `attendanceRatePercent` are Host-specific (Games carry attendance/repeat-
 * join data Bookings don't) — both null when there isn't enough confirmed
 * data yet, never a guessed/fabricated number. */
export interface HostInsights {
  totals: { totalSessions: number; cancelledSessions: number; uniqueParticipants: number };
  utilisation: { dayOfWeek: number; hour: string; n: number }[];
  narrative: string | null;
  trend: { thisMonth: number; lastMonth: number; deltaPercent: number | null };
  repeatParticipantPercent: number | null;
  attendanceRatePercent: number | null;
}

// --- Admin: moderation reports, audit log, support search (folded into
// AdminDashboard.tsx from the former Platform Admin page) ----------------

export interface ModerationReport {
  id: number;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  /** Trust & Safety investigation notes (IA spec §16). */
  adminNotes: string | null;
  createdAt: string;
}

export interface ReportCase {
  report: ModerationReport & { reporterClientId: string };
  target: Record<string, unknown> | null;
  relatedReports: { id: number; reason: string; status: string; createdAt: string }[];
}

export interface AuditEntry {
  id: number;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  objectType: string;
  objectId: string;
  previousValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface SupportBooking {
  ref: string;
  name: string;
  email: string;
  date: string;
  time: string;
  status: string;
  paymentStatus: string;
}

export interface SupportRegistration {
  ref: string;
  gFirst: string;
  gLast: string;
  email: string;
  status: string;
  paymentStatus: string;
}

export interface SupportUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}

export interface SupportGame {
  id: string;
  activityLabel: string;
  date: string;
  time: string;
  status: string;
  bookingRef: string | null;
}

export interface SupportCircle {
  id: string;
  name: string;
  activityLabel: string;
  status: string;
  createdAt: string;
}

// --- admin activity overview: Open Bookings & Circle activity (IA spec
// §16) ----------------------------------------------------------------

export interface OpenBookingActivity {
  id: string;
  activityLabel: string;
  date: string;
  time: string;
  status: string;
  bookingRef: string;
  bookingRefFull: string;
  bookingName: string;
  centreName: string | null;
}

export interface CircleActivity {
  id: string;
  name: string;
  activityLabel: string;
  status: string;
  createdAt: string;
  memberCount: number;
}
