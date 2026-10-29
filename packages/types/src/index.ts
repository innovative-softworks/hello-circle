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
  /** Trust & Retention — who meets newcomers on arrival; null = not provided. */
  newcomerWelcome?: string | null;
  /** Category system (2026-10-22) — present on public detail responses. */
  taxonomy?: ListingTaxonomy | null;
  tags?: string[];
  /** DP-07 — the organisation's cancellation window in hours (detail response only). */
  cancellationHours?: number;
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
  /** OG-04 — an hour range ("HH:00", end exclusive); both null = the whole day. */
  startTime?: string | null;
  endTime?: string | null;
  groupId?: string | null;
}

export interface Club {
  /** Trust & Retention — who meets newcomers on arrival; null = not provided. */
  newcomerWelcome?: string | null;
  /** Category system (2026-10-22) — present on public detail responses. */
  taxonomy?: ListingTaxonomy | null;
  tags?: string[];
  /** Release 2 — public detail fetch only. */
  participationAttributes?: string[];
  /** Release 3 — official Circle (public detail fetch only). */
  circleId?: string | null;
  circleName?: string | null;
  circleSlug?: string | null;
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
  /** Trust & Retention batch 1 — the venue, for its review section. */
  centreId?: string;
  /** Front-door check-in (attendance table): "present" once the vendor
   * checked this booking in, null when nobody did — null is "unknown", not
   * "absent" (Release 1). Optional: older servers don't send it. */
  attendance?: string | null;
  /** Booking audit 2026-10-11 (B3) — decided server-side by the same rules
   * the cancel/reschedule routes enforce (server/src/selfCancel.ts); never
   * re-derive them here. Optional: older servers don't send them. */
  paymentStatus?: string;
  paidOnline?: boolean;
  canCancel?: boolean;
  canReschedule?: boolean;
  /** ISO instant after which the booking can't be changed online. */
  cancelDeadline?: string;
  refundState?: "none" | "pending" | "refunded";
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
  /** Booking UX Phase 3 — ISO instant after which it can't be cancelled online (server rule). Optional: older servers don't send it. */
  cancelDeadline?: string;
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
  /** Booking UX Phase 3 — ISO instant after which it can't be cancelled online (server rule). Optional: older servers don't send it. */
  cancelDeadline?: string;
  experienceId: string;
  /** Participation Phase 1 — so the confirmation pass says Event/Adventure correctly. */
  kind?: ExperienceKind;
  title: string;
  meetingPoint: string;
  date: string;
  time: string;
  partySize: number;
  /** Participation Phase 1 — what was bought (empty for a single-price booking). */
  lines?: OrderLine[];
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
  /** Sent by both the vendor view and (since the booking audit, B3) the
   * resident-facing fetch. */
  paymentStatus?: string;
  /** Vendor view only (vendorOperations.ts's GET /registrations). */
  hasStripePayment?: boolean;
  /** Resident-facing fetch only — same meaning as MyBooking.attendance. */
  attendance?: string | null;
  /** Resident-facing fetch only (B3) — see MyBooking's fields of the same
   * names. Registrations have no cut-off, so no cancelDeadline. */
  paidOnline?: boolean;
  canCancel?: boolean;
  refundState?: "none" | "pending" | "refunded";
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
  /** Phase 11B — server-decided: may the booker self-cancel right now? */
  canCancel?: boolean;
  /** Phase 11B — paid through Stripe (refund then issued in HelloCircle); never the provider id. */
  paidOnline?: boolean;
  /** Phase 11B — "pending" = cancelled, paid online, refund not yet issued (Refund Policy A). */
  refundState?: "none" | "pending" | "refunded";
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
  /** From the vendor's session register (Release 1). Both 0 when no
   * register was taken — unknown, not absent. Optional for older servers. */
  sessionsAttended?: number;
  sessionsMissed?: number;
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
  /** Admin sub-role (Revenue & Connect Stage 2a); null for non-admins. */
  adminRole?: "super" | "finance" | "support" | "legal" | null;
  invitedStaff: boolean;
  /** D-01 — the status of the member's organisation ("active" | "suspended"); null without one. */
  orgStatus?: string | null;
  providerTier: "standard" | "verified" | "featured";
  createdAt: string;
  /** Onboarding audit E1 — set by GET /auth/me; null = no Terms acceptance on file. */
  termsAcceptedAt?: string | null;
  /** HelloCircle Manage (Phase 1) — set once this vendor links the resident
   * (magic-link) account of the same person. Null for every vendor until
   * they deliberately do that (see api/manage.ts). */
  residentId: string | null;
  /** OG-07 — an admin session's two-step sign-in state (admins only). */
  mfa?: { required: boolean; enrolled: boolean; verifiedMinutesAgo: number | null };
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
  /** Trust & Retention — "person" while an authorised organiser's record (or
   * an accepted attendance request) confirms this reviewer attended; null for
   * older reviews and any whose confirmation no longer holds. */
  attendanceBasis?: "person" | null;
  /** The date of the occurrence reviewed (older reviews: null). */
  occurrenceDate?: string | null;
  tags?: ("welcoming_host" | "good_organisation" | "accurate_description" | "good_value")[];
  updatedAt?: string | null;
  /** True when the viewer wrote it (they may edit or delete it). */
  mine?: boolean;
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
  /** Profile-completeness inputs (the listing editor's readiness checklist). */
  phone?: string | null;
  /** Centres only. */
  opensAt?: string | null;
  /** Clubs only. */
  sport?: string | null;
  hasAccessibility?: boolean;
  /** Amenities (centre) or "what's included" items (club). */
  extrasCount?: number;
  imagesCount?: number;
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
  experiencesPending: number;
  vendorCount: number;
  totalListings: number;
  reviewCount: number;
  bookingsToday: number;
  paymentFailures: number;
  openReports: number;
  /** Orders of every kind (bookings, registrations, programmes, games,
   * experiences, passes) created today, Irish calendar day. */
  newToday?: number;
  /** Orders of every kind whose payment failed, created in the last 7 days. */
  failedPayments7d?: number;
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
  listingType: "centre" | "club" | "game" | "program" | "program_session" | "club_session" | "experience" | "circle";
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
  kind: "booking" | "registration" | "program" | "experience" | "waitlist" | "game" | "intent_match" | "circle" | "invite" | "invite_withdrawn" | "moderation" | "review_invite";
  title: string;
  body: string;
  /** Platform Pre-Launch Polish — Changeset 2. Widened to match the
   * server's actual NotifyResidentParams["listingType"] union
   * (notifications.ts) — 'vendor' and 'host' were missing here even though
   * the server has sent notifications carrying them since the Follow
   * feature shipped; the in-app notification list's own type didn't
   * represent that, on top of notificationLink.ts's separate route-map gap. */
  listingType: "centre" | "club" | "game" | "intent" | "circle" | "vendor" | "host" | "experience" | "program" | "place_suggestion";
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

/** GET /games/:id/next-steps — "keep the connection going" after a game
 * (Release 1). Aggregate member counts only; never who is in anything. */
export interface NextStepCircle {
  id: string;
  slug: string | null;
  name: string;
  members: number;
  joinMode: string;
  isMember: boolean;
}

/** Release 3 — the same shape for every participation kind (GET /next-steps). */
export type NextSteps = GameNextSteps;
export type NextStepsKind = "game" | "booking" | "registration" | "program" | "experience";

export interface GameNextSteps {
  officialCircle: NextStepCircle | null;
  suggestedCircle: NextStepCircle | null;
  nextSession: { id: string; href: string; title: string; activityLabel: string; date: string; time: string; centreName: string | null; spotsLeft: number | null; sameHost: boolean } | null;
  createCircle: { activityLabel: string; county: string } | null;
}

export interface IntentCount {
  count: number;
  residentCount: number;
  /** The caller's own active intent in this cluster, if any (Release 1's
   * "You're interested" state). Optional: older servers don't send it. */
  myIntentId?: string | null;
  /** Release 6 — the normalised cluster ("badminton") and its display label. */
  clusterKey?: string;
  label?: string;
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
  /** Trust & Retention — who welcomes newcomers (a role or first name, where to find them); null = not provided. */
  newcomerWelcome?: string | null;
  /** Card word source (list endpoints only). See CategoryLabel. */
  categoryLabel?: CategoryLabel | null;
  /** Category system (2026-10-22) — present on public detail responses. */
  taxonomy?: ListingTaxonomy | null;
  tags?: string[];
  /** DP-15 — upcoming dates of the same repeating activity (detail response only). */
  otherDates?: { id: string; date: string; time: string; spotsLeft: number | null }[];
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
  /** Detail fetch only: a paid join's reference (GJ-…) and whether its
   * payment is still being checked. Null for a free join. */
  myJoin?: { ref: string; paymentReview: boolean } | null;
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
  /** Release 2 — what-to-expect gaps; null when the host left them blank. */
  experienceRequired?: string | null;
  accessibilityInfo?: string | null;
  /** Release 2 — single-game detail fetch only. Host-selected, canonical order. */
  participationAttributes?: string[];
  /** Release 2 — joined participants new to this activity; null below 3 (privacy). */
  firstTimerCount?: number | null;
  /** Only present on the single-game detail fetch, and only populated for
   * the host or a joined participant — see server routes/games.ts's GET /:id. */
  meetingInstructions?: string | null;
  /** Set only when this game was created as a specific Circle's plan
   * (HelloCircle Manage Phase 4's "Create plan" deep-link). */
  circleId: string | null;
  /** Experience 3.0 — the partner Circle of a shared Circle-to-Circle activity. */
  partnerCircle?: { id: string; name: string; slug: string | null } | null;
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
  /** OG-27 — "approval": a join is a request the host approves (free activities only). */
  joinMode?: "open" | "approval";
  /** OG-26 — the weekly series this activity belongs to, if any. */
  seriesId?: string | null;
  /** OG-27 — detail fetch only: this resident's own join request, if any. */
  joinRequestByMe?: "requested" | "approved" | "declined" | "withdrawn" | null;
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
  /** Category system (2026-10-22) — present on public detail responses. */
  taxonomy?: ListingTaxonomy | null;
  tags?: string[];
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
  nextPlan: {
    id: string;
    date: string;
    time: string;
    joined: number;
    capacity: number;
    spotsLeft: number;
    source: "circle" | "nearby";
    /** Length in minutes when the host set one. Optional: older servers don't send it. */
    durationMinutes?: number | null;
    /** The viewer has joined this meetup. */
    joinedByMe?: boolean;
    /** The viewer's waitlist place: waiting, or a place offered to them. */
    waitlist?: "waiting" | "offered" | null;
  } | null;
  /** When the viewer can't see any of the Circle's own meetups because they're
   * members-only: just the next one's date and time (never for invite-only). */
  membersOnlyNext?: { date: string; time: string } | null;
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
  /** Booking UX Phase 5 — an approval Circle's questions for people asking to join (up to three). Optional: older servers don't send it. */
  joinQuestions?: string[];
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
  /** Circle Experience 2.0 — this Circle's own past activities that someone
   * confirmed attending. Detail fetch only; verified, never estimated. */
  activitiesTogether?: number;
  /** Circle Experience 4.0 — the organiser's "people often come on their own"; null = not said. */
  soloWelcome?: boolean | null;
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
  /** mutedUntil is only sent to the Circle's organisers (OG-18). */
  members: { residentId: string; name: string; role: string; mutedUntil?: string | null }[];
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
  /** Circle Experience 2.0 — optional, so an older server still type-checks. */
  imageUrl?: string | null;
  /** The host said people come on their own (come_alone). */
  soloFriendly?: boolean;
  /** What experience the host says is needed; null = none stated. */
  experienceRequired?: string | null;
  /** The signed-in viewer's own state (Circle upcoming list). */
  joinedByMe?: boolean;
  waitlistedByMe?: boolean;
  joinRequested?: boolean;
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
  /** OG-18 — set while the member's chat messages are paused (organisers only). */
  mutedUntil?: string | null;
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
  // Circle Experience 2.0, Make It Happen — only sent while that feature is
  // on. `stage` is derived: gathering/ready/expired for an unconfirmed idea.
  interestCount?: number;
  interestedByMe?: boolean;
  targetSize?: number | null;
  expiresAt?: string | null;
  stage?: "gathering" | "ready" | "confirmed" | "activity_created" | "completed" | "cancelled" | "expired";
  sourcePulseKey?: string | null;
  declineReason?: string | null;
  /** Circles 3.0 — the real listing this plan is about, read live for the
   * viewer (server circlePlanListings.ts). Null for a free-text plan. */
  listing?: CirclePlanListing | null;
  /** Circles 3.0 — set when this plan is shared between two Circles. The
   * home Circle owns it (its organisers decide); members are never shared. */
  shared?: { homeCircle: { id: string; slug: string | null; name: string } | null; partnerCircle: { id: string; slug: string | null; name: string } | null } | null;
}

/** Circles 3.0 — a plan's listing. A reference only: booking, price and
 * capacity stay with the listing's own page. */
export type CirclePlanListingType = "game" | "experience" | "program" | "centre" | "club";
export interface CirclePlanListing {
  type: CirclePlanListingType;
  /** activity | adventure | experience | volunteer | programme | venue | club */
  kind: string;
  id: string;
  sessionId: string | null;
  title: string;
  imageUrl: string | null;
  date: string | null;
  time: string | null;
  where: string | null;
  priceCents: number | null;
  /** Null when the page can't be opened (venue pages still "Coming soon"). */
  href: string | null;
  /** no_dates: still listed, nothing scheduled yet (not the same as gone). */
  availability: "available" | "full" | "past" | "cancelled" | "unavailable" | "no_dates";
  spotsLeft: number | null;
  myState: "booked" | "waitlisted" | null;
  bookingNote: string | null;
  restricted: boolean;
}

/** Circles 3.1 — a listing linked to a Circle (GET /api/circles/:id/links).
 * Not a plan: nobody has said they're going. "official" = the partner named
 * this Circle on its own listing (managed by the partner, read-only here). */
export interface CircleLink {
  id: string;
  relationship: "shared" | "created_for" | "official";
  status: "approved" | "pending";
  note: string | null;
  listing: CirclePlanListing;
  linkedByName: string | null;
  linkedByMe: boolean;
  canDecide: boolean;
  canRemove: boolean;
  createdAt: string;
}

/** Circles 3.0 — My Life "Plans you're in" (GET /api/circles/my-plans).
 * One entry per listing+date even when planned in several Circles. */
export interface MyCirclePlan {
  key: string;
  planId: string;
  title: string;
  status: "idea" | "confirmed";
  proposedDate: string | null;
  proposedTime: string | null;
  circles: { id: string; slug: string | null; name: string; planId: string }[];
  listing: CirclePlanListing | null;
}

// --- Circle Experience 2.0 ---------------------------------------------------
// Pulse, Free Time Match, first-time guidance and Memories. Members-only;
// every count is an aggregate with a minimum group size (server
// circlePlanning.ts), and no response lists who wants what or who is free.

export type CircleFeatureKey = "circles.pulse" | "circles.free_time_match" | "circles.make_it_happen" | "circles.first_time_friendly" | "circles.memories" | "circles.collaboration" | "circles.visitor_experience";

/** Circle Experience 4.0 — what someone who isn't a member may see
 * (GET /api/circles/:id/visitor). Never member names, chat, memories,
 * wishes or availability; polls/plans only as counts, open Circles only. */
export interface CircleVisitorView {
  joinMode: "open" | "approval" | "invite";
  members: number;
  organiser: { name: string; verified: boolean; residentId: string | null } | null;
  about: { about: string | null; whatWeDo: string | null; whoCanJoin: string | null; values: string | null };
  coverUrl: string | null;
  upcoming: {
    id: string;
    activityLabel: string;
    date: string;
    time: string;
    place: string | null;
    durationMinutes: number | null;
    priceCents: number | null;
    joined: number;
    spotsLeft: number;
    imageUrl: string | null;
    soloFriendly: boolean;
    experienceRequired: string | null;
  }[];
  past: { id: string; activityLabel: string; date: string; attended: number; imageUrl: string | null }[];
  activitiesTogether: number;
  venuePhotos: string[];
  pattern: { weekday: string; partOfDay: string } | null;
  soloWelcome: { source: "organiser" | "activities" } | null;
  community: { openPolls: number; livePlans: number } | null;
}

export interface CircleMembership {
  member: boolean;
  role: string | null;
  requested: boolean;
  /** Removed by an organiser and not yet lifted (owner decision D5). */
  restricted?: boolean;
  /** Whether the welcome step was seen; null when not a member. */
  welcomed?: boolean | null;
  /** True when they've never taken part in one of this Circle's activities; null when not a member. */
  firstCircleActivity?: boolean | null;
}

export interface CirclePulseGroup {
  key: string;
  interestKey: string;
  interest: string;
  weekStart: string;
  /** null = only you so far (below the visibility threshold). */
  count: number | null;
  mine: boolean;
  topSlot: string | null;
  topSlotCount: number | null;
  status: "active" | "matched" | "proposed" | "converted";
  planId: string | null;
  /** Organisers only: notes members left, without names. */
  organiserNotes?: string[];
}

export interface CirclePulseView {
  weeks: [string, string];
  groups: CirclePulseGroup[];
  mine: { id: string; interest: string; weekStart: string; slots: string[]; note: string | null }[];
  suggestions: string[];
  limits: { maxActive: number; noteMaxLength: number };
  /** "Who's free" chart (2026-10-24): today to the end of next week; count
   * is null below two people. Optional — older servers don't send it. */
  freeByDay?: { date: string; count: number | null }[];
}

export interface CircleFreeTimeMatch {
  weekStart: string;
  slot: string;
  interest: string | null;
  interestKey: string | null;
  count: number;
  includesMe: boolean;
}

/** Circle Home planner (2026-10-24) — members free each day this week and
 * next; `free` is null below `minGroup` people or for a past day. */
export interface CircleFreeDay {
  date: string;
  free: number | null;
  past: boolean;
  best: boolean;
}
export interface CircleFreeDaysView {
  days: CircleFreeDay[];
  minGroup: number;
}

export interface CircleFreeTimeView {
  weeks: [string, string];
  mine: Record<string, string[] | null>;
  sharedCount: Record<string, number | null>;
  matches: CircleFreeTimeMatch[];
  minGroup: number;
}

export interface CircleFirstTimeGuide {
  guidelines: { values: string | null; whoCanJoin: string | null };
  nextActivity: {
    id: string;
    activityLabel: string;
    date: string;
    time: string;
    durationMinutes: number | null;
    where: string | null;
    meetingInstructions: string | null;
    equipmentNeeded: string | null;
    experienceRequired: string | null;
    soloFriendly: boolean;
    accessibilityInfo: string | null;
    organiserName: string | null;
  } | null;
}

export interface CircleMemory {
  id: string;
  kind: "photo" | "reflection";
  imageUrl: string | null;
  caption: string | null;
  body: string | null;
  activity: { id: string; activityLabel: string; date: string };
  contributorName: string;
  mine: boolean;
  canRemove: boolean;
  createdAt: string;
}

export interface CircleMemoriesView {
  activitiesTogether: number;
  canContribute: boolean;
  contributableActivities: { id: string; activityLabel: string; date: string }[];
  items: CircleMemory[];
}

export interface CircleRestriction {
  residentId: string;
  name: string;
  reason: string | null;
  createdAt: string;
  restrictedByName: string;
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
  /** Trust & Retention batch 1 — true only while a business-details check holds (never the commercial tier). */
  verified: boolean;
  providerTier: string;
  checks?: VerificationLabel[];
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
  /** Trust & Retention batch 1. */
  hostingSince?: string | null;
  activitiesOffered?: string[];
  areas?: string[];
  checks?: VerificationLabel[];
  reviewSummary?: ReviewSummary;
}

/** A completed check, shown on a profile only while it holds. */
export interface VerificationLabel {
  key: "email_confirmed" | "host_application_approved" | "business_details_checked" | "identity_checked" | "organiser_identity_checked";
  label: string;
  meaning: string;
  checkedAt: string | null;
  expiresAt?: string | null;
}

export interface ReviewSummary {
  average: number | null;
  count: number;
  /** Index 0 = 1 star … index 4 = 5 stars. */
  distribution: [number, number, number, number, number];
}

// --- Participation Chat (implementation plan Phase 11) ----------------------

export type ChatScopeType = "game" | "circle" | "experience_session" | "program" | "club";

export interface ChatMessage {
  id: number;
  residentId: string;
  residentName: string;
  body: string;
  createdAt: string;
  /** "host" when the provider posted it (experience/program/club chats). */
  authorType?: "resident" | "host";
  /** Whether the viewer wrote it — server-computed, works for hosts too. */
  isMine?: boolean;
  /** OG-03 / OG-18 — removed by HelloCircle ("admin") or an organiser; the body is then empty. */
  hidden?: "admin" | "organiser" | null;
}

export interface ChatFeed {
  messages: ChatMessage[];
  canPost: boolean;
  postBlockedReason?: string;
  opensAt?: string;
  archivesAt?: string;
  viewerRole?: "resident" | "host";
  /** OG-18 — the viewer organises this Circle / hosts this activity and may remove messages. */
  canModerate?: boolean;
}

/** GET /chat/mine — one conversation in the inbox. */
export interface ChatInboxItem {
  scopeType: ChatScopeType;
  scopeId: string;
  listingId: string;
  title: string;
  subtitle: string;
  href: string;
  lastMessage: { body: string; authorName: string; createdAt: string } | null;
  unread: number;
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

/** A listing's category names for the Bold card's word over the photo
 * (search + discover responses, 2026-10-28). null when none is assigned. */
export interface CategoryLabel {
  name: string;
  sub: string | null;
  /** "assigned" = the listing's category; "title" = one live category named
   * in its own title (display only). See server/src/categoryLabels.ts. */
  source?: "assigned" | "title";
}

export interface ExperienceSearchResult {
  category?: CategoryLabel | null;
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
  /** Category system (2026-10-22) — additive; older servers omit them. */
  programmes?: { category?: CategoryLabel | null; id: string; title: string; parentName: string | null; area: string | null; county: string | null; nextSessionDate: string | null; priceCents: number | null; imageUrl: string | null }[];
  circles?: { category?: CategoryLabel | null; id: string; slug: string | null; name: string; activityLabel: string; area: string; county: string; members: number }[];
}

// --- homepage discovery feeds (Phase 5) ---------------------------------

export interface DiscoverItem {
  /** Category names for the Bold card (search + discover responses). */
  category?: CategoryLabel | null;
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
  /** Release 4 — plain-language fit ("Great fit" / "Good fit" / "Worth
   * exploring"), never a percentage; null/absent when there's no real reason. */
  fitLabel?: "Great fit" | "Good fit" | "Worth exploring" | null;
  /** Release 4 — parent listing + official Circle + experience kind. */
  listingType?: "game" | "program" | "club" | "experience";
  listingId?: string;
  experienceKind?: string | null;
  /** Activities only (Home feed and Explore search): what the card label
   * needs beyond the summary, plus the signed-in viewer's own state. */
  card?: {
    capacity: number;
    minParticipants: number | null;
    pending: boolean;
    comingSoon: boolean;
    circleName: string | null;
    createdAt: string | null;
    soloFriendly: boolean;
    joinedByMe: boolean;
    waitlistedByMe: boolean;
    joinRequested: boolean;
  };
}

/** Release 6 — a demand cluster shown to hosts. Aggregate only: a range,
 * typical day/time/budget — never who asked. */
export interface HostOpportunity {
  clusterKey: string;
  label: string;
  category: string;
  county: string;
  interested: string;
  preferredDays: string[];
  preferredTime: string | null;
  budget: { minCents: number | null; maxCents: number | null } | null;
  radiusKm: number | null;
}

/** Release 5 — an open Circle welcoming new members, for "New here?". */
export interface NewHereCircle {
  id: string;
  slug: string | null;
  name: string;
  activityLabel: string;
  members: number;
  imageUrl: string | null;
}

/** Release 4 — GET /discover/for-you and /discover/new-here. */
export interface ForYouSection {
  key: string;
  title: string;
  items: ActivitySummary[];
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
  /** The whole 7-day window, soonest first (Explore's Tomorrow / This week).
   * Optional: older servers don't send it. */
  week?: DiscoverItem[];
  /** A radius found nothing with a confirmed location, so this is the
   * county it was measured from instead (no distance claim). */
  radiusFallback?: { county: string };
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
  /** D-01 — "active" | "suspended". */
  status?: string;
  statusChangedAt?: string | null;
  memberCount?: number;
}

/** D-01 — admin organisation record (GET /api/admin/organisations/:id). */
export interface AdminOrganisationRecord {
  id: string;
  name: string;
  kind: string;
  status: string;
  statusChangedAt: string | null;
  members: { id: string; name: string; email: string; status: string; platformRole: string | null; invitedStaff: boolean }[];
  listings: { type: string; status: string; n: number }[];
  upcoming: { bookings: number; registrations: number; enrolments: number; experienceBookings: number; passes: number; total: number };
}

/** D-01 — a suspended organisation's read-only obligations (GET /api/vendor/obligations). */
export interface VendorObligations {
  orgStatus: string;
  decision: ModerationDecisionPublic | null;
  /** True for roles that see per-booking detail (owner, managers, finance). */
  detail: boolean;
  items: { kind: "booking" | "registration" | "enrolment" | "experience"; listing: string; date: string | null; time: string | null; ref?: string; customerFirstName?: string; paymentState?: string }[];
  summary: { date: string | null; listing: string; count: number }[];
  support: { contact: string; complaints: string };
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
  /** D-03 — why the last host application was declined (category + explanation; never the internal note). Null = not declined, or declined before reasons were recorded. */
  hostDecision?: ModerationDecisionPublic | null;
  hostBio: string;
  hostPhone: string;
  /** Onboarding §2 (IA spec) — goals + participation comfort. Empty string
   * on the pref fields means no preference stated, not unset. */
  goals: string[];
  prefGroupSize: string;
  prefBeginnerFriendly: boolean;
  prefSoloFriendly: boolean;
  prefBudget: string;
  /** Release 2 — "prefer first-timer-friendly" / "family friendly". */
  prefFirstTimer: boolean;
  prefFamily: boolean;
  /** Release 5 — "new" | "settled" | "exploring" | "" (not answered). */
  areaTenure?: string;
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
  /** Trust & Retention batch 1 — "R-000123", what the reporter quotes to support. */
  caseRef?: string;
  category?: "content" | "safety";
  decidedAt?: string | null;
  /** A decided report can be taken to HelloCircle for reconsideration. */
  canAppeal?: boolean;
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
  /** D-03 — the reason a rejected suggestion was declined; null for older decisions. */
  decision?: ModerationDecisionPublic | null;
}

/** D-03 — a moderation decision as the affected partner or applicant sees it. */
export interface ModerationDecisionPublic {
  id: number;
  action: string;
  newState: string;
  category: string | null;
  categoryLabel: string | null;
  explanation: string | null;
  decidedAt: string;
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
  /** My Life 3.0 (D5) — opt-in in-app alerts, read by server/src/myLife.ts's
   * sweep only when === true (the older routineReminders defaulted to on, so
   * it can't stand for consent). Optional: absent means off. */
  savedAvailability?: boolean;
  routineAlerts?: boolean;
  marketing: boolean;
  /** Gates "intent_match" notifications (see notifications.ts's
   * PREF_KEY_BY_KIND) — unlike most other categories here, this one is
   * triggered by a stranger's action (someone else's game creation, or
   * enough other residents wanting the same thing), not something the
   * resident themself just did, so it gets a real opt-out from day one. */
  intentMatches: boolean;
  /** Trust & Retention — one in-app review invitation after the organiser
   * confirms you attended (server: notifications.ts PREF_KEY_BY_KIND
   * review_invite → reviewInvites). Absent means on. */
  reviewInvites?: boolean;
}

export const ACCESSIBILITY_OPTIONS = ["Wheelchair access", "Step-free access", "Accessible changing", "Accessible parking", "Hearing loop", "Sensory-friendly"];

export const INTEREST_OPTIONS = ["Badminton", "Football", "Swimming", "Fitness", "Yoga", "Walking", "Kids activities", "Arts", "Learning", "Community events", "Outdoor", "Wellbeing"];

// Release 2 — availability is now "day:slot" tokens and goals are a new
// 8-value list (max 3); both live with their helpers in
// client/src/participationVocab.ts (mirrored server-side in
// server/src/participationVocab.ts). The server still accepts the old
// values for one release.

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
  kind: "booking" | "registration" | "game" | "pass" | "program_enrollment" | "experience";
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

/** GET /programs (no venue) — one card on the /programs browse page. Only
 * published programs at approved venues with an upcoming session. */
export interface ProgramSummary {
  /** Card word source (list endpoints only). See CategoryLabel. */
  categoryLabel?: CategoryLabel | null;
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  priceCents: number;
  capacity: number | null;
  category: string;
  skillLevel: string;
  ageRange: string;
  listingType: "centre" | "club";
  listingId: string;
  listingName: string;
  area: string;
  county: string;
  /** The venue's coordinates (for the map view); null when not set. */
  lat: number | null;
  lng: number | null;
  locationSource: string | null;
  nextSessionDate: string;
  nextSessionTime: string;
  upcomingSessions: number;
  enrolled: number;
  spotsLeft: number | null;
}

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
  /** Trust & Retention — who welcomes newcomers (a role or first name, where to find them); null = not provided. */
  newcomerWelcome?: string | null;
  /** Category system (2026-10-22) — present on public detail responses. */
  taxonomy?: ListingTaxonomy | null;
  tags?: string[];
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
  /** Release 2 — what-to-expect gaps, null when blank. */
  arrivalInstructions?: string | null;
  accessibilityInfo?: string | null;
  /** Release 2 — public detail fetch only. */
  participationAttributes?: string[];
  /** Release 3 — official Circle (public detail fetch only). */
  circleId?: string | null;
  circleName?: string | null;
  circleSlug?: string | null;
  /** Public detail fetch only — the venue it runs at, and who runs it. */
  venueArea?: string;
  venueCounty?: string;
  venueLat?: number | null;
  venueLng?: number | null;
  venueLocationSource?: string | null;
  venueSlug?: string | null;
  vendorId?: string;
  vendorName?: string | null;
  vendorVerified?: boolean;
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

/** Release 5 — "volunteer" is an experience kind, not a separate module.
 * Participation Phase 1 — "event" (community events) is one too. */
export type ExperienceKind = "adventure" | "experience" | "volunteer" | "event";

export interface ExperienceSessionSlot {
  id: string;
  date: string;
  time: string;
  capacity: number;
  spotsLeft: number;
  /** Participation Phase 1 — places left per option with its own limit (null = no own limit). */
  optionsLeft?: Record<string, number | null>;
}

// --- Participation Phase 1: registration options and purchased lines ----------

export type OptionKind = "option" | "addon" | "bundle";
export type PriceBasis = "per_person" | "per_booking";
export type AgeBand = "adult" | "child" | "infant" | "senior" | "any";

/** One option as the public booking box sees it. */
export interface RegistrationOption {
  id: string;
  kind: OptionKind;
  label: string;
  description: string;
  priceMinor: number;
  priceBasis: PriceBasis;
  /** People one unit includes (a family Pooja = 5); 0 for an add-on. */
  headsPerUnit: number;
  ageBand: AgeBand | null;
  maxPerOrder: number | null;
  onSale: boolean;
  saleEndsAt: string | null;
}

/** "single" = one price × party (as always); "options" = choose options. `open`
 * is false while registration is paused (the options switch is off). */
export interface ExperienceRegistration {
  mode: "single" | "options";
  open: boolean;
  options: RegistrationOption[];
  /** Participation Phase 2 — null while attendee details are switched off. */
  attendeeDetails?: { questions: RegistrationQuestion[]; questionsVersion: number } | null;
}

// --- Participation Phase 2: attendees, questions, check-in -------------------

export type QuestionInputType = "text" | "number" | "date" | "select" | "checkbox";
export type QuestionCategory = "general" | "logistics" | "dietary_preference" | "health" | "religion" | "ethnicity" | "other_special";

/** A registration question as the person booking sees it. */
export interface RegistrationQuestion {
  key: string;
  scope: "booking" | "attendee";
  inputType: QuestionInputType;
  label: string;
  help: string;
  /** "Why we ask" — shown before answering. */
  purpose: string;
  required: boolean;
  choices: string[];
  min: number | null;
  max: number | null;
  appliesTo: "all" | "adult" | "child";
  /** Door staff see this answer at check-in. */
  doorVisible: boolean;
}

/** A question as the partner edits it. */
export interface VendorRegistrationQuestion extends RegistrationQuestion {
  id?: string;
  category: QuestionCategory;
}

export type AnswerValue = string | number | boolean;
export interface RegistrationAnswersInput {
  booking: Record<string, AnswerValue>;
  attendees: Record<string, AnswerValue>[];
}

export interface AttendeeInput {
  name: string;
  personType?: "adult" | "child";
  /** For a child: "contact" (the booker) or the attendee number of an adult in the booking. */
  guardian?: "contact" | number;
}

export interface BookingAttendee {
  attendeeNo: number;
  lineNo: number | null;
  lineLabel: string | null;
  personType: "adult" | "child";
  name: string;
  guardianKind: "contact" | "attendee" | null;
  guardianAttendeeNo: number | null;
  guardianName: string | null;
  status: "active" | "removed";
  /** false = from the party size and seat names (bookings before attendee details). */
  recorded: boolean;
  checkedInAt: string | null;
}

export interface StoredAnswer {
  attendeeNo: number;
  key: string;
  label: string;
  inputType: QuestionInputType;
  value: string;
  version: number;
  doorVisible: boolean;
  updatedAt: string;
}

/** GET /experiences/bookings/:ref/details — the booker's own view. */
export interface BookingPeopleDetails {
  ref: string;
  title: string;
  kind: string;
  date: string;
  time: string;
  status: string;
  paymentStatus: string;
  contactName: string;
  partySize: number;
  attendees: BookingAttendee[];
  answers: StoredAnswer[];
  questions: RegistrationQuestion[];
  questionsVersion: number;
  canEditAnswers: boolean;
  missingAnswers: string[];
}

/** One booking on the partner attendee list. */
export interface VendorAttendeeBooking {
  ref: string;
  sessionId: string;
  participantName: string;
  email: string;
  phone: string;
  partySize: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
  date: string;
  time: string;
  lines: { lineNo: number; kind: "option" | "addon"; label: string; quantity: number; heads: number }[];
  attendees: (BookingAttendee & { checkinMethod: string | null })[];
  answers: StoredAnswer[];
  issues: string[];
}

export interface AttendanceSummaryRow {
  sessionId: string;
  date: string;
  time: string;
  status: string;
  bookings: number;
  people: number;
  adults: number;
  children: number;
  checkedIn: number;
}

export interface CheckinStaffAssignment {
  id: number;
  userId: string;
  name: string;
  email: string;
  sessionId: string | null;
  date: string | null;
  time: string | null;
  createdAt: string;
}

export type AdmitReason = "ok" | "cancelled" | "not_paid" | "refunded" | "session_cancelled" | "wrong_date" | "other_session";

export interface DoorPerson {
  attendeeNo: number;
  name: string;
  personType: "adult" | "child";
  lineLabel: string | null;
  guardianName: string | null;
  checkedInAt: string | null;
  answers: { label: string; value: string }[];
}

/** A booking as the door sees it — no amounts, email or phone. */
export interface DoorBooking {
  ref: string;
  contactName: string;
  partySize: number;
  admit: { ok: boolean; reason: AdmitReason; message: string };
  people: DoorPerson[];
  bookingAnswers: { label: string; value: string }[];
  checkedIn: number;
}

export interface DoorSessionInfo {
  sessionId: string;
  experienceId: string;
  title: string;
  kind: string;
  date: string;
  time: string;
  status: string;
  isToday: boolean;
}

/** An option as the partner edits it (GET/PUT /vendor/experiences/:id/options). */
export interface VendorOfferingOption {
  id?: string;
  kind: OptionKind;
  label: string;
  description: string;
  priceMinor: number;
  priceBasis: PriceBasis;
  headsPerUnit: number;
  ageBand: AgeBand | null;
  capacity: number | null;
  maxPerOrder: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  taxTreatment?: "standard";
  sortOrder?: number;
  active: boolean;
}

/** What a booking bought, frozen at purchase. */
export interface OrderLine {
  lineNo: number;
  kind: "option" | "addon";
  label: string;
  description: string;
  priceBasis: string;
  ageBand: string | null;
  unitMinor: number;
  quantity: number;
  quantityPurchased: number;
  heads: number;
  totalMinor: number;
  refundedQuantity: number;
  refundedMinor: number;
}

/** A priced line in a quote (server amounts). */
export interface QuotedLine {
  optionId: string;
  label: string;
  kind: OptionKind;
  priceBasis: PriceBasis;
  quantity: number;
  heads: number;
  unitMinor: number;
  totalMinor: number;
}

export interface Experience {
  /** Trust & Retention — who welcomes newcomers (a role or first name, where to find them); null = not provided. */
  newcomerWelcome?: string | null;
  /** Card word source (list endpoints only). See CategoryLabel. */
  categoryLabel?: CategoryLabel | null;
  /** Category system (2026-10-22) — present on public detail responses. */
  taxonomy?: ListingTaxonomy | null;
  tags?: string[];
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
  /** Release 2 — null when blank. */
  accessibilityInfo?: string | null;
  /** Release 2 — public detail fetch only. */
  participationAttributes?: string[];
  /** Release 3 — official Circle (public detail fetch only). */
  circleId?: string | null;
  circleName?: string | null;
  circleSlug?: string | null;
  /** Release 5 — volunteer listings only. */
  skillsRequired?: string | null;
  cause?: string | null;
  minAge?: number | null;
  weatherPolicy: string;
  eligibility: string;
  cancellationTerms: string;
  priceCents: number;
  capacity: number;
  paymentMethod: "online" | "cash";
  imageUrl: string;
  images: string[];
  sessions: ExperienceSessionSlot[];
  /** Participation Phase 1 — public detail/list responses only. */
  registration?: ExperienceRegistration;
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
  /** OG-19 — bookings close at this instant (UTC), null = open until the start. */
  salesCloseAt?: string | null;
  /** OG-19 — shared by departures created together as a weekly repeat. */
  seriesId?: string | null;
}

export interface MyExperienceBooking {
  ref: string;
  experienceId: string;
  participantName: string;
  partySize: number;
  totalCents: number;
  status: string;
  paymentStatus: string;
  /** Phase 11B — server-decided: may the booker self-cancel right now? */
  canCancel?: boolean;
  /** Phase 11B — paid through Stripe (refund then issued in HelloCircle); never the provider id. */
  paidOnline?: boolean;
  /** Phase 11B — "pending" = cancelled, paid online, refund not yet issued (Refund Policy A). */
  refundState?: "none" | "pending" | "refunded";
  createdAt: string;
  title: string;
  imageUrl: string;
  kind: ExperienceKind;
  vendorId: string | null;
  date: string;
  time: string;
  /** Release 3 — host-recorded attendance ("present"/"no_show"), null when none. */
  attendance?: string | null;
  /** Participation Phase 1 — what was bought (empty for a single-price booking). */
  lines?: OrderLine[];
  linesSummary?: string | null;
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
  /** Release 3 — "present"/"no_show", null when not recorded yet. */
  attendance?: string | null;
  /** OG-19 — the departure this booking is on. */
  sessionId?: string;
  /** Participation Phase 1 — what was bought (empty for a single-price booking). */
  lines?: OrderLine[];
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
  /** D-08 — invitedStaff false = the owner; rowVersion guards role changes and removal against stale screens. */
  staff: { id: string; name: string; email: string; platformRole: string | null; status: string; invitedStaff: boolean; rowVersion: number; joinedAt: string }[];
  pendingInvites: { id: string; email: string; platformRole: string; status: string; createdAt: string; expiresAt: string }[];
  locations: { id: string; name: string; type: "centre" | "club" }[];
  isOwner: boolean;
  flags: FeatureFlags;
  /** Configuration framework — effective capabilities (docs/participation-expansion/14). */
  capabilities?: Record<string, boolean>;
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

export const PLATFORM_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst", "checkin_staff"] as const;

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
  // Participation Phase 2 — check people in at the door, only for the events
  // or dates the organisation assigns; nothing else in the workspace.
  checkin_staff: "Check-in only",
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
  /** Trust & Retention batch 1 — "safety" reports are listed first. */
  category?: "content" | "safety";
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
  /** Why the change was made, when the action records one (coupons, roles, …). */
  reason?: string | null;
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

/** Category system (2026-10-22): a listing's primary category and optional
 * subcategory, as returned on public detail responses. `active` is false when
 * the category was retired after it was chosen. */
export interface ListingTaxonomy {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  subcategoryId: string | null;
  subcategoryName: string | null;
  subcategorySlug: string | null;
  active: boolean;
}

// --- Configuration framework (docs/participation-expansion/13, 14) -----------------

export type CapabilityGroup = "listing" | "operations" | "commercial";
export interface CapabilityDefinition {
  key: string;
  label: string;
  description: string;
  group: CapabilityGroup;
  status: "available" | "unavailable";
  unavailableReason?: string;
  dependsOn: string[];
  operatedBy: string[];
  platformSwitch?: { key: string; kind: "feature" | "commerce"; label: string };
  limits?: { key: string; label: string; max: number }[];
  whenOff: string;
}
export interface CapabilityState {
  key: string;
  orgEnabled: boolean;
  platformOn: boolean;
  dependenciesOn: boolean;
  effective: boolean;
  limits: Record<string, number>;
}
export interface OrgTemplateDefinition {
  key: string;
  label: string;
  description: string;
  capabilities: string[];
}
export interface OrgCapabilityView {
  template: string | null;
  configVersion: number;
  capabilities: CapabilityDefinition[];
  templates: OrgTemplateDefinition[];
  states: CapabilityState[];
  usage: Record<string, number>;
}
export interface CapabilityChangeInput {
  template?: string | null;
  enabled?: Record<string, boolean>;
  limits?: Record<string, number>;
}
export interface CapabilityPreview {
  ok: boolean;
  error?: string;
  states?: CapabilityState[];
  impact?: { key: string; label: string; existing: number; whenOff: string }[];
}

