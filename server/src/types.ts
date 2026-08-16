export type PaymentMethod = "online" | "cash";

export interface Room {
  id: string;
  centreId: string;
  name: string;
  cap: number;
  rate: number;
  desc: string;
  paymentMethod: PaymentMethod;
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
  claimed: boolean;
  lat: number | null;
  lng: number | null;
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
  /** Nullable = unlimited (every club's behaviour before this existed). */
  capacity: number | null;
  lat: number | null;
  lng: number | null;
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
