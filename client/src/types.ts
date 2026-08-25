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
  status: "pending" | "approved" | "rejected" | "deleted";
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
  createdAt: string;
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
  listingType: "centre" | "club" | "game" | "program_session" | "club_session";
  listingId: string;
  status: FavouriteStatus;
}

export interface ResidentNotification {
  id: number;
  kind: "booking" | "registration" | "waitlist" | "game";
  title: string;
  body: string;
  listingType: "centre" | "club" | "game";
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

export interface ProviderProfile {
  id: string;
  name: string;
  description: string;
  verified: boolean;
  providerTier: string;
  county: string;
  centres: ProviderProfileListing[];
  clubs: (ProviderProfileListing & { sport: string })[];
  experiences: (ProviderProfileListing & { kind: "adventure" | "experience"; title: string })[];
  policies: { cancellationHours: number; bookingWindowDays: number };
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
  kind: "booking" | "registration" | "game" | "pass";
  label: string;
  totalCents: number;
  createdAt: string;
  paymentStatus: string;
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
