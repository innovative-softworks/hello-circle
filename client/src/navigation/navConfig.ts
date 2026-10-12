import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BadgeCheck,
  Building2,
  Calendar,
  CalendarDays,
  CalendarPlus,
  HandHeart,
  Lightbulb,
  MapPin,
  Mountain,
  Sparkles,
  Store,
  Trophy,
  Users,
  UsersRound,
} from "lucide-react";

// Shared navigation config (header/navigation audit 2026-10-12, §F). One
// list per menu, read by the desktop header, the mobile tab-bar sheets and
// the mobile Account & More sheet, so the three can't drift apart again.
// Visibility here is presentation only: every destination still enforces
// its own sign-in/permission rules (page + server), so hiding an item is
// never the access control.

// Icons: lucide-react only, for the whole navigation system (header,
// dropdowns, mobile sheets, tab bar) — 2026-10-12 icon standardisation.
type IconComponent = LucideIcon;

export interface NavContext {
  /** VITE_VENUE_PAGES_PUBLIC — venue pages otherwise redirect to /coming-soon. */
  venuesPublic: boolean;
  /** The Make It Happen commerce switch (null/undefined while it loads). */
  openBooking: boolean | null | undefined;
  /** A vendor/admin session is active (vendor accounts don't need "List your venue"). */
  isVendor: boolean;
}

export interface NavItem {
  key: string;
  label: string;
  desc: string;
  to: string;
  icon: IconComponent;
  visible?: (ctx: NavContext) => boolean;
}

export const visibleItems = (items: NavItem[], ctx: NavContext) => items.filter((i) => !i.visible || i.visible(ctx));

// ── Explore ───────────────────────────────────────────────────────────────
// The existing Explore menu, unchanged (owner, 2026-10-12: "don't change the
// existing ones, you can add"). Additions are marked.

export const EXPLORE_THINGS: NavItem[] = [
  // Added 2026-10-12 — the search page with everything on it.
  { key: "all", label: "All activities", desc: "Search everything that's on near you", to: "/explore", icon: CalendarDays },
  { key: "activities", label: "Activities", desc: "Ad-hoc pickup sessions & one-off classes", to: "/games", icon: Activity },
  { key: "adventures", label: "Adventures", desc: "Guided hikes, kayaking & outdoor trips", to: "/adventures", icon: Mountain },
  { key: "experiences", label: "Experiences", desc: "Workshops, classes & one-off outings", to: "/experiences", icon: Sparkles },
  // Added 2026-10-12.
  { key: "events", label: "Events", desc: "What's on this weekend", to: "/explore?when=weekend", icon: Calendar },
  { key: "programmes", label: "Programmes", desc: "Multi-week courses & series", to: "/programs", icon: Users },
  { key: "volunteer", label: "Volunteer", desc: "Clean-ups, gardens & local causes", to: "/volunteer", icon: HandHeart },
  // Added 2026-10-12.
  { key: "circles", label: "Circles", desc: "Regular groups around a shared activity", to: "/circles", icon: UsersRound },
];

export const EXPLORE_PLACES: NavItem[] = [
  { key: "centres", label: "Community centres", desc: "Book a hall or room, real-time", to: "/browse/centres", icon: Building2, visible: (c) => c.venuesPublic },
  { key: "clubs", label: "Sports clubs", desc: "Register a child, join a season", to: "/browse/clubs", icon: Trophy, visible: (c) => c.venuesPublic },
];

export const EXPLORE_FEATURED: NavItem[] = [
  { key: "weekend", label: "This weekend", desc: "See what's on nearby.", to: "/games?when=weekend", icon: CalendarDays },
  { key: "become-host", label: "Become a host", desc: "Run a session or Circle, free.", to: "/become-a-host", icon: BadgeCheck },
];

/** Added 2026-10-12 — moved out of the header's icon row. */
export const FREE_TIME_ITEM: NavItem = { key: "free-time", label: "Free Time Mode", desc: "Not sure what to do? Tell us how long you've got.", to: "/free-time", icon: Lightbulb };

/** Path prefixes that light up "Explore" as the current section. */
export const EXPLORE_PATHS = ["/explore", "/games", "/adventures", "/experiences", "/programs", "/volunteer", "/browse/centres", "/centres/", "/browse/clubs", "/clubs/", "/free-time"];

// ── Start ─────────────────────────────────────────────────────────────────
// Only creation flows that exist. Each page asks a guest to sign in and the
// server requires a resident to create (games.ts / circles.ts requireResident).

export const START_ITEMS: NavItem[] = [
  { key: "host-activity", label: "Create an activity", desc: "Post a game, class or meetup", to: "/games/host", icon: CalendarPlus },
  { key: "start-circle", label: "Start a Circle", desc: "A regular group around something you love", to: "/circles/start", icon: UsersRound },
  { key: "make-it-happen", label: "Make It Happen", desc: "Pitch an idea and gather people", to: "/make-it-happen", icon: Lightbulb, visible: (c) => c.openBooking === true },
  { key: "become-host", label: "Become a host", desc: "Host sessions and earn the Verified Host badge", to: "/become-a-host", icon: BadgeCheck },
  { key: "list-venue", label: "List your venue", desc: "Put your hall, club or space on HelloCircle", to: "/for-venues", icon: Store, visible: (c) => !c.isVendor },
];

/** Create flows live under /games and /circles, but they belong to Start. */
export const START_PATHS = ["/games/host", "/circles/start", "/make-it-happen", "/suggest-place", "/become-a-host"];

/** Moved from Start to the Account & More sheet and the footer (2026-10-12). */
export const SUGGEST_PLACE_ITEM: NavItem = { key: "suggest-place", label: "Suggest a place", desc: "Tell us about a place we're missing", to: "/suggest-place", icon: MapPin };

export const isUnder = (pathname: string, prefixes: string[]) => prefixes.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));

// ── Account ───────────────────────────────────────────────────────────────
// Which account-menu items a session gets. Mirrors what the server lets each
// identity do (CLAUDE.md "Who uses this"): resident items need a resident
// session; dashboards need the matching vendor/admin session; Manage items
// need hosted games or organised Circles. Admins get no resident-only items
// unless a resident session is also active.

export interface AccountContext {
  /** A resident (magic-link) session that belongs to this person. */
  resident: boolean;
  role: "vendor" | "admin" | null;
  /** Vendor account status (pending vendors see an "awaiting approval" row). */
  vendorApproved: boolean;
  /** This vendor account is linked to a resident (Personal switch). */
  vendorLinkedResident: boolean;
  /** Resident side: a linked vendor workspace exists. */
  linkedVendor: "approved" | "pending" | null;
  hasHosted: boolean;
  organisedCircles: number;
}

export type AccountItemKey =
  | "profile"
  | "my-life"
  | "my-bookings"
  | "my-circles"
  | "saved"
  | "notifications"
  | "messages"
  | "settings"
  | "manage-hosting"
  | "manage-circles"
  | "switch-to-vendor"
  | "vendor-pending"
  | "vendor-dashboard"
  | "vendor-listings"
  | "switch-to-personal"
  | "admin-dashboard"
  | "admin-pending";

export function accountItemKeys(c: AccountContext): AccountItemKey[] {
  const keys: AccountItemKey[] = [];
  if (c.resident) keys.push("profile", "my-life", "my-bookings", "my-circles", "saved", "notifications");
  if (c.resident || c.role === "vendor") keys.push("messages");
  if (c.resident) keys.push("settings");
  if (c.resident && (c.hasHosted || c.organisedCircles > 0)) keys.push("manage-hosting");
  if (c.resident && c.organisedCircles > 0) keys.push("manage-circles");
  if (c.resident && c.role !== "vendor" && c.linkedVendor === "approved") keys.push("switch-to-vendor");
  if (c.resident && c.role !== "vendor" && c.linkedVendor === "pending") keys.push("vendor-pending");
  if (c.role === "vendor") {
    keys.push("vendor-dashboard");
    if (c.vendorApproved) keys.push("vendor-listings");
    if (c.vendorLinkedResident && !c.resident) keys.push("switch-to-personal");
  }
  if (c.role === "admin") keys.push("admin-dashboard", "admin-pending");
  return keys;
}
