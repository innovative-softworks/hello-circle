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
  /** "Would you do this again?" percentage from activity_feedback, joined
   * through this listing's bookings — null when nobody's answered yet. */
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
  claimed: boolean;
  /** Provider public profile (IA spec §5) — null for an unclaimed listing. */
  vendorId: string | null;
  lat: number | null;
  lng: number | null;
  phone: string;
  accessibility: string[];
  /** Bounded "featured" flag (IA spec §16) — admin-toggled promotion. */
  featured: boolean;
  /** Feature flags (implementation backlog #5) — whether this centre's org
   * has Open Booking enabled. */
  openBookingEnabled: boolean;
  /** Slugs (master-prompt punch list #1) — null until backfilled/generated. */
  slug: string | null;
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
  /** "Would you do this again?" percentage from activity_feedback, joined
   * through this listing's registrations — null when nobody's answered yet. */
  wouldRepeatPercent: number | null;
  wouldRepeatCount: number;
  paymentMethod: PaymentMethod;
  mapUrl: string;
  claimed: boolean;
  vendorId: string | null;
  /** Nullable = unlimited (every club's behaviour before this existed). */
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

export interface Review {
  id: number;
  /** Host & Activity reviews (master-prompt punch list #3) — kept separate
   * per listing_type, matching the different trust signal each represents. */
  listingType: "centre" | "club" | "game" | "host" | "experience";
  listingId: string;
  name: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface Registration {
  id: number;
  ref: string;
  clientId: string;
  clubId: string;
  clubName: string;
  sport: string;
  team: string;
  childFirst: string;
  childLast: string;
  dob: string;
  gFirst: string;
  gLast: string;
  email: string;
  phone: string;
  address: string;
  ecName: string;
  ecPhone: string;
  ecRel: string;
  medical: string;
  consent: boolean;
  trial: boolean;
  totalCents: number;
  createdAt: string;
}
