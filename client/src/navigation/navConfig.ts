import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BadgeCheck,
  Building2,
  Calendar,
  GraduationCap,
  CalendarPlus,
  Heart,
  Lightbulb,
  MapPin,
  Mountain,
  Search,
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
  /** Shown with a "Soon" badge (gated destinations). */
  soon?: boolean;
  visible?: (ctx: NavContext) => boolean;
}

export const visibleItems = (items: NavItem[], ctx: NavContext) => items.filter((i) => !i.visible || i.visible(ctx));

// ── Explore ───────────────────────────────────────────────────────────────
// Navigation audit 2026-10-22 (owner lifted the 2026-10-12 freeze). One entry
// per destination, grouped by intent:
//   • "All activities" → "Explore everything" (it is the search page; it sat
//     next to "Activities", which is the activities list).
//   • Circles left Explore — it is its own top-level item (and phone tab).
//   • The "This weekend" tile (/games?when=weekend) duplicated Events
//     (/explore?when=weekend) with different results; Events stays.
//   • "Become a host" left Explore — it is under Start.
//   • The photo tile linked to /explore a second time; removed.
// Every destination is unchanged.

export const EXPLORE_THINGS: NavItem[] = [
  { key: "all", label: "Explore everything", desc: "All activities, places and more", to: "/explore", icon: Search },
  { key: "activities", label: "Activities & games", desc: "Sports, fitness and social games", to: "/games", icon: Activity },
  { key: "adventures", label: "Adventures", desc: "Outdoor trips and experiences", to: "/adventures", icon: Mountain },
  { key: "experiences", label: "Experiences", desc: "Workshops, classes and unique outings", to: "/experiences", icon: Sparkles },
  { key: "events", label: "Events this weekend", desc: "What's on near you", to: "/explore?when=weekend", icon: Calendar },
];

/** Longer commitments and giving back (navigation audit 2026-10-22). */
export const EXPLORE_LEARN: NavItem[] = [
  { key: "programmes", label: "Programmes", desc: "Multi-week courses and series", to: "/programs", icon: GraduationCap },
  { key: "volunteer", label: "Volunteer", desc: "Clean-ups, gardens and local causes", to: "/volunteer", icon: Heart },
];

/** While venue pages are gated, the same two places point at the existing
 * "coming soon" page with a "Soon" badge (owner, 2026-10-22: "keep coming
 * soon pages"). Never links to the gated venue routes themselves. */
export const EXPLORE_PLACES_SOON: NavItem[] = [
  { key: "centres-soon", label: "Community centres", desc: "Halls and rooms to hire", to: "/coming-soon", icon: Building2, soon: true, visible: (c) => !c.venuesPublic },
  { key: "clubs-soon", label: "Sports clubs", desc: "Clubs and seasons", to: "/coming-soon", icon: Trophy, soon: true, visible: (c) => !c.venuesPublic },
];

export const EXPLORE_PLACES: NavItem[] = [
  { key: "centres", label: "Community centres", desc: "Book a hall or room, real-time", to: "/browse/centres", icon: Building2, visible: (c) => c.venuesPublic },
  { key: "clubs", label: "Sports clubs", desc: "Register a child, join a season", to: "/browse/clubs", icon: Trophy, visible: (c) => c.venuesPublic },
];

/** The one featured item in Explore: a destination nothing else links to. */
export const FREE_TIME_ITEM: NavItem = { key: "free-time", label: "Free Time Mode", desc: "Not sure what to do? Tell us how long you've got.", to: "/free-time", icon: Lightbulb };

/** Path prefixes that light up "Explore" as the current section. */
export const EXPLORE_PATHS = ["/explore", "/games", "/adventures", "/experiences", "/programs", "/volunteer", "/browse/centres", "/centres/", "/browse/clubs", "/clubs/", "/free-time"];

// ── Start ─────────────────────────────────────────────────────────────────
// Only creation flows that exist. Each page asks a guest to sign in and the
// server requires a resident to create (games.ts / circles.ts requireResident).

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

/** Start, grouped by intent (navigation audit 2026-10-22). */
export const START_GROUPS: NavGroup[] = [
  {
    key: "organise",
    label: "Organise something",
    items: [
      { key: "host-activity", label: "Create an activity", desc: "Post a game, class or meetup", to: "/games/host", icon: CalendarPlus },
      { key: "make-it-happen", label: "Make It Happen", desc: "Pitch an idea and gather people", to: "/make-it-happen", icon: Lightbulb, visible: (c) => c.openBooking === true },
    ],
  },
  {
    key: "community",
    label: "Build a community",
    items: [{ key: "start-circle", label: "Start a Circle", desc: "A regular group around something you love", to: "/circles/start", icon: UsersRound }],
  },
  {
    key: "host",
    label: "Host or list with us",
    items: [
      { key: "become-host", label: "Become a host", desc: "Host sessions and earn the Verified Host badge", to: "/become-a-host", icon: BadgeCheck },
      { key: "list-venue", label: "List your venue", desc: "Put your hall, club or space on HelloCircle", to: "/for-venues", icon: Store, visible: (c) => !c.isVendor },
    ],
  },
];

/** Every Start item, in menu order (kept for callers that want a flat list). */
export const START_ITEMS: NavItem[] = START_GROUPS.flatMap((g) => g.items);

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
  | "manage-hosting"
  | "manage-circles"
  | "become-host"
  | "settings"
  | "payments"
  | "help"
  | "switch-to-vendor"
  | "vendor-pending"
  | "vendor-dashboard"
  | "vendor-listings"
  | "switch-to-personal"
  | "admin-dashboard"
  | "admin-pending";

// Account menu 2026-10-24 (sidebar merge): You → My Life → Hosting/Manage →
// Settings. "My bookings" / "My Circles" open those My Life tabs, and
// "Settings" opens the same seven-item sidebar. Owner (same day) asked for
// every earlier row back, so nothing is hidden behind the header icons.
export function accountItemKeys(c: AccountContext): AccountItemKey[] {
  const keys: AccountItemKey[] = [];
  if (c.resident) keys.push("profile", "my-life", "my-bookings", "my-circles", "saved", "notifications");
  if (c.resident || c.role === "vendor") keys.push("messages");
  if (c.resident) keys.push(c.hasHosted || c.organisedCircles > 0 ? "manage-hosting" : "become-host");
  if (c.resident && c.organisedCircles > 0) keys.push("manage-circles");
  if (c.resident && c.role !== "vendor" && c.linkedVendor === "approved") keys.push("switch-to-vendor");
  if (c.resident && c.role !== "vendor" && c.linkedVendor === "pending") keys.push("vendor-pending");
  if (c.role === "vendor") {
    keys.push("vendor-dashboard");
    if (c.vendorApproved) keys.push("vendor-listings");
    if (c.vendorLinkedResident && !c.resident) keys.push("switch-to-personal");
  }
  if (c.role === "admin") keys.push("admin-dashboard", "admin-pending");
  if (c.resident) keys.push("settings", "payments", "help");
  return keys;
}
