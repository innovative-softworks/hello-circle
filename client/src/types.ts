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
  phone: string;
  accessibility: string[];
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
  paymentMethod: PaymentMethod;
  mapUrl: string;
  claimed: boolean;
  capacity: number | null;
  lat: number | null;
  lng: number | null;
  phone: string;
  accessibility: string[];
  category: string;
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
  listingType: "centre" | "club";
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
  createdAt: string;
}

export interface Favourite {
  listingType: "centre" | "club";
  listingId: string;
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
  /** Only present on the single-game detail fetch, not the list. */
  joinedByMe?: boolean;
  waitlistedByMe?: boolean;
}

// --- Circles (NEXT) --------------------------------------------------------

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

export interface SearchResult {
  parsed: SearchParsed | null;
  centres: Centre[];
  clubs: Club[];
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
}

export interface NotificationPrefs {
  bookingConfirmations: boolean;
  bookingReminders: boolean;
  waitlistOffers: boolean;
  recommendations: boolean;
  circleAnnouncements: boolean;
}

export const ACCESSIBILITY_OPTIONS = ["Wheelchair access", "Step-free access", "Accessible changing", "Accessible parking", "Hearing loop", "Sensory-friendly"];

export const INTEREST_OPTIONS = ["Badminton", "Football", "Swimming", "Fitness", "Yoga", "Walking", "Kids activities", "Arts", "Learning", "Community events", "Outdoor", "Wellbeing"];

export const AVAILABILITY_OPTIONS = ["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Saturday", "Sunday"];

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
}

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
  createdAt: string;
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
