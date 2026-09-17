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
  status: "draft" | "pending" | "approved" | "rejected" | "deleted";
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
  status: "draft" | "pending" | "approved" | "rejected" | "deleted";
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
}

export interface VendorNotification {
  id: number;
  kind: "booking" | "registration";
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
  /** HelloCircle Manage (Phase 1) — set once this vendor links the resident
   * (magic-link) account of the same person. Null for every vendor until
   * they deliberately do that (see api/manage.ts). */
  residentId: string | null;
}

export interface Review {
  id: number;
  /** Host & Activity reviews (master-prompt punch list #3) — kept separate
   * per listing_type, matching the different trust signal each represents. */
  listingType: "centre" | "club" | "game" | "host";
  listingId: string;
  name: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface VendorListingSummary {
  id: string;
  name: string;
  status: "draft" | "pending" | "approved" | "rejected" | "deleted";
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
  listingType: "centre" | "club" | "game" | "program_session" | "club_session" | "experience";
  listingId: string;
  status: FavouriteStatus;
  /** Best-effort listing display details — null if the listing was since removed. */
  name: string | null;
  imageUrl: string | null;
  subtitle: string | null;
}

export interface ResidentNotification {
  id: number;
  kind: "booking" | "registration" | "waitlist" | "game" | "intent_match" | "circle";
  title: string;
  body: string;
  listingType: "centre" | "club" | "game" | "intent" | "circle";
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
   * tinted placeholder, same convention as Game.imageUrl above. */
  imageUrl: string | null;
  /** Circle discovery redesign — the soonest open game matching this
   * Circle's activity label (Circles have no first-class plan relationship
   * — see routes/circles.ts's own comment on nextPlanFor). Null when
   * nothing's currently scheduled; the client never fakes one. */
  nextPlan: { id: string; date: string; time: string; joined: number; capacity: number; spotsLeft: number } | null;
  /** Loose calendar-month count of open games matching this activity —
   * a participation-health signal, not a stored/cached counter. */
  plansThisMonth: number;
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

/** "Recently in this Circle" row (§20) — a completed game matching this
 * Circle's activity, with a real confirmed-attendance count. */
export interface CircleRecentActivity {
  id: string;
  activityLabel: string;
  date: string;
  attended: number;
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
  createdAt: string;
  options: CirclePollOption[];
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

export interface DiscoverFeed {
  today: DiscoverItem[];
  weekend: DiscoverItem[];
}

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
  policies: { cancellationHours: number; bookingWindowDays: number };
  staff: { id: string; name: string; email: string; platformRole: string | null; status: string }[];
  pendingInvites: { token: string; email: string; platformRole: string; createdAt: string }[];
  locations: { id: string; name: string; type: "centre" | "club" }[];
  isOwner: boolean;
  flags: FeatureFlags;
  /** The org owner's own uploaded business logo — shown on the public
   * provider profile hero. null until they upload one. */
  logo: string | null;
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
}

export interface VendorPayments {
  transactions: { ref: string; kind: "booking" | "registration"; listingName: string; totalCents: number; createdAt: string; paymentStatus: string }[];
  totalPaidCents: number;
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
