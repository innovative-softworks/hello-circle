export interface Room {
  id: string;
  centreId: string;
  name: string;
  cap: number;
  rate: number;
  desc: string;
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
}

export interface RoomBlock {
  id: number;
  roomId: string | null;
  roomName: string | null;
  date: string;
  time: string | null;
  reason: string;
  createdAt: string;
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
}

export interface MyBooking {
  ref: string;
  date: string;
  time: string;
  totalCents: number;
  createdAt: string;
  centreName: string;
  ph: string;
  image: string;
  roomName: string;
}

export interface MyRegistration {
  ref: string;
  team: string;
  childFirst: string;
  childLast: string;
  trial: number;
  totalCents: number;
  createdAt: string;
  clubName: string;
  sport: string;
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

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  status: "pending" | "approved" | "suspended";
  name: string;
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
}
